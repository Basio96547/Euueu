import { Body, Controller, Delete, Get, Inject, Injectable, Param, Post } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service.js';
import { FxService } from './fx.module.js';
import { Errors } from '../common/errors.js';
import { cashDue } from '../common/money.js';
import { randomUUID } from 'node:crypto';

const SOFT_HOLD_MINUTES = 15;

@Injectable()
export class CartService {
  constructor(
    @Inject(PrismaService) private prisma: PrismaService,
    @Inject(FxService) private fx: FxService,
  ) {}

  async create() {
    return this.prisma.cart.create({ data: { token: randomUUID() } });
  }

  async get(token: string) {
    const cart = await this.prisma.cart.findUnique({
      where: { token },
      include: { items: { include: { variant: { include: { product: true, levels: true } } } } },
    });
    if (!cart) throw Errors.notFound('السلة');
    return cart;
  }

  /**
   * ضبط كمية صنف في السلة (qty = 0 يحذفه).
   *
   * الحجز المرن ليس صفاً في جدول فحسب: قيمته أنه يخصم من المتاح.
   * صفٌّ بلا خصم حجزٌ اسمه فقط — يظنّ ثلاثة زبائن أن آخر جهاز لهم،
   * فيصل طلب واحد إلى المستودع ويُخذل اثنان بعد أن دفعوا وقتهم.
   * لذلك الصف والعدّاد يتحرّكان معاً في معاملة واحدة أو لا يتحرّكان.
   *
   * ولأن الحجز واحد لكل (سلّة، متغيّر) يُحدَّث في مكانه، فإعادة الضبط
   * تخصم الفرق لا الكمية كلها — وإلا تراكمت الحجوزات على سلّة واحدة.
   */
  async setItem(token: string, sku: string, qty: number) {
    if (!Number.isInteger(qty) || qty < 0 || qty > 20) {
      throw Errors.badRequest('QTY_INVALID', 'الكمية يجب أن تكون بين صفر وعشرين', 'Invalid quantity');
    }

    const cart = await this.get(token);
    const variant = await this.prisma.productVariant.findUnique({
      where: { sku }, include: { product: true, levels: true },
    });
    if (!variant) throw Errors.notFound('المتغيّر');

    const level = variant.levels[0];
    if (!level) throw Errors.outOfStock(variant.publicId, 0);

    await this.prisma.$transaction(async (tx) => {
      const held = await tx.inventoryReservation.findFirst({
        where: { cartId: cart.id, variantId: variant.id, kind: 'SOFT_HOLD' },
      });
      const mine = held?.qty ?? 0;

      // المتاح لهذه السلّة يشمل ما تحجزه هي أصلاً — وإلا مُنعت من زيادة كميتها بنفسها
      const fresh = await tx.inventoryLevel.findFirst({
        where: { variantId: variant.id, warehouseId: level.warehouseId },
      });
      const available = (fresh?.onHand ?? 0) - (fresh?.reserved ?? 0) + mine;
      if (qty > available) throw Errors.outOfStock(variant.publicId, available);

      const delta = qty - mine;
      const expiresAt = new Date(Date.now() + SOFT_HOLD_MINUTES * 60_000);

      if (qty === 0) {
        await tx.cartItem.deleteMany({ where: { cartId: cart.id, variantId: variant.id } });
        if (held) await tx.inventoryReservation.delete({ where: { id: held.id } });
      } else {
        await tx.cartItem.upsert({
          where: { cartId_variantId: { cartId: cart.id, variantId: variant.id } },
          update: { qty },
          create: {
            cartId: cart.id, variantId: variant.id, qty,
            unitPriceSnapshotUsdCents: variant.priceUsdCents,
          },
        });
        // أي تفاعل مع السلة يجدّد المهلة — الزبون الحيّ لا يُسحب من تحته
        if (held) await tx.inventoryReservation.update({ where: { id: held.id }, data: { qty, expiresAt } });
        else {
          await tx.inventoryReservation.create({
            data: {
              variantId: variant.id, warehouseId: level.warehouseId, kind: 'SOFT_HOLD',
              qty, cartId: cart.id, expiresAt,
            },
          });
        }
      }

      if (delta !== 0) {
        await tx.inventoryLevel.updateMany({
          where: { variantId: variant.id, warehouseId: level.warehouseId },
          data: { reserved: { increment: delta }, version: { increment: 1 } },
        });
        await tx.inventoryMovement.create({
          data: {
            variantId: variant.id, warehouseId: level.warehouseId,
            reason: delta > 0 ? 'RESERVE' : 'RELEASE',
            qtyDelta: -delta,                 // سالب يخصم من المتاح، موجب يعيده
            refType: 'cart', refId: cart.id,
          },
        });
      }
    });

    return this.summary(token);
  }

  /** الإضافة ضبطٌ للكمية — أُبقيت باسمها لأن الواجهات تناديها به */
  addItem(token: string, sku: string, qty: number) { return this.setItem(token, sku, qty); }

  removeItem(token: string, sku: string) { return this.setItem(token, sku, 0); }

  /** التحقق قبل إنشاء الطلب: التوفر والسعر وسعر الصرف معاً (الفصل 8 §8.2) */
  async validate(token: string) {
    const cart = await this.get(token);
    const fx = await this.fx.current();
    const conflicts: any[] = [];

    // حجوزات هذه السلّة نفسها مخصومة من reserved — تُردّ قبل المقارنة
    // وإلا رفضت السلّةُ نفسَها: تحجز آخر جهاز ثم تُخبر صاحبها أنه نفد.
    const own = new Map<string, number>();
    for (const r of await this.prisma.inventoryReservation.findMany({
      where: { cartId: cart.id, kind: 'SOFT_HOLD' },
    })) {
      own.set(r.variantId, (own.get(r.variantId) ?? 0) + r.qty);
    }

    for (const it of cart.items) {
      const available = it.variant.levels.reduce((a, l) => a + (l.onHand - l.reserved), 0)
        + (own.get(it.variantId) ?? 0);
      if (available < it.qty) {
        conflicts.push({ code: 'OUT_OF_STOCK', sku: it.variant.sku, requested: it.qty, available, requiresConsent: true });
      }
      const now = Number(it.variant.priceUsdCents);
      const snap = Number(it.unitPriceSnapshotUsdCents);
      if (now !== snap) {
        conflicts.push({ code: 'PRICE_CHANGED', sku: it.variant.sku, oldPriceUsdCents: snap, newPriceUsdCents: now, requiresConsent: true });
      }
      if (it.variant.product.isDemo) {
        conflicts.push({ code: 'DEMO_PRODUCT_NOT_ORDERABLE', sku: it.variant.sku, requiresConsent: false });
      }
    }
    if (fx.health === 'STALE_HALT') conflicts.push({ code: 'FX_STALE_HALT', requiresConsent: false });

    return { ...(await this.summary(token)), valid: conflicts.length === 0, conflicts };
  }

  async summary(token: string) {
    const cart = await this.get(token);
    const fx = await this.fx.current();
    const lines = cart.items.map((it) => ({
      sku: it.variant.sku,
      name: (it.variant.product.name as any).ar,
      qty: it.qty,
      unitPriceUsdCents: Number(it.variant.priceUsdCents),
      lineTotalUsdCents: Number(it.variant.priceUsdCents) * it.qty,
    }));
    const shipping = lines.length ? 200 : 0; // تعريفة دمشق الافتراضية
    const totals = cashDue(lines.map((l) => l.lineTotalUsdCents), shipping, fx.rate);
    return {
      cartToken: cart.token, lines,
      shippingUsdCents: shipping,
      fx: { rate: fx.rate, health: fx.health, validUntil: fx.validUntil },
      totals: {
        ...totals,
        /* المبلغ الملزِم هو المجموع المقرَّب مرة واحدة، لا جمع الأسعار المعروضة */
        note: 'المبلغ يُحسب على المجموع ثم يُقرَّب لأقرب 1000 ليرة',
      },
    };
  }
}

@Controller('carts')
export class CartController {
  constructor(
    @Inject(CartService) private cart: CartService,
  ) {}

  @Post()
  async create() { const c = await this.cart.create(); return { data: { cartToken: c.token } }; }

  @Get(':token')
  async get(@Param('token') token: string) { return { data: await this.cart.summary(token) }; }

  @Post(':token/items')
  async add(@Param('token') token: string, @Body() b: { sku: string; qty?: number }) {
    return { data: await this.cart.addItem(token, b.sku, b.qty ?? 1) };
  }

  /** ضبط الكمية صراحة — والصفر حذف */
  @Post(':token/items/:sku')
  async set(@Param('token') token: string, @Param('sku') sku: string, @Body() b: { qty: number }) {
    return { data: await this.cart.setItem(token, sku, b.qty) };
  }

  @Delete(':token/items/:sku')
  async remove(@Param('token') token: string, @Param('sku') sku: string) {
    return { data: await this.cart.removeItem(token, sku) };
  }

  @Post(':token/validate')
  async validate(@Param('token') token: string) { return { data: await this.cart.validate(token) }; }
}
