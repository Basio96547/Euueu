import { Body, Controller, Get, Inject, Injectable, Param, Post } from '@nestjs/common';
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

  async addItem(token: string, sku: string, qty: number) {
    const cart = await this.get(token);
    const variant = await this.prisma.productVariant.findUnique({
      where: { sku }, include: { product: true, levels: true },
    });
    if (!variant) throw Errors.notFound('المتغيّر');

    // المنتج التجريبي يُضاف للسلة في بيئة الفحص لكنه يُرفض عند إنشاء الطلب
    const available = variant.levels.reduce((a, l) => a + (l.onHand - l.reserved), 0);
    if (available < qty) throw Errors.outOfStock(variant.publicId, available);

    await this.prisma.cartItem.upsert({
      where: { cartId_variantId: { cartId: cart.id, variantId: variant.id } },
      update: { qty },
      create: {
        cartId: cart.id, variantId: variant.id, qty,
        unitPriceSnapshotUsdCents: variant.priceUsdCents,
      },
    });

    // حجز مرن 15 دقيقة يتجدّد بأي تفاعل مع السلة
    const level = variant.levels[0];
    if (level) {
      await this.prisma.inventoryReservation.create({
        data: {
          variantId: variant.id, warehouseId: level.warehouseId, kind: 'SOFT_HOLD',
          qty, cartId: cart.id,
          expiresAt: new Date(Date.now() + SOFT_HOLD_MINUTES * 60_000),
        },
      });
    }
    return this.summary(token);
  }

  /** التحقق قبل إنشاء الطلب: التوفر والسعر وسعر الصرف معاً (الفصل 8 §8.2) */
  async validate(token: string) {
    const cart = await this.get(token);
    const fx = await this.fx.current();
    const conflicts: any[] = [];

    for (const it of cart.items) {
      const available = it.variant.levels.reduce((a, l) => a + (l.onHand - l.reserved), 0);
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

  @Post(':token/validate')
  async validate(@Param('token') token: string) { return { data: await this.cart.validate(token) }; }
}
