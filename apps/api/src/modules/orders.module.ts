import { Body, Controller, Get, Headers, Inject, Injectable, Param, Post } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service.js';
import { FxService } from './fx.module.js';
import { CartService } from './cart.module.js';
import { NotificationsService } from './notifications.service.js';
import { Errors } from '../common/errors.js';
import { cashDue, orderNo, publicId } from '../common/money.js';
import type { Prisma } from '@prisma/client';

/** الحجز الأوّلي ساعتان — عمر الحجز ليس عمر الطلب (الفصل 3) */
const ORDER_HOLD_HOURS = 2;
const CONFIRM_WINDOW_HOURS = 48;
const RARE_THRESHOLD = 2;

@Injectable()
export class OrdersService {
  private idem = new Map<string, string>();

  constructor(
    @Inject(PrismaService) private prisma: PrismaService,
    @Inject(FxService) private fx: FxService,
    @Inject(CartService) private cart: CartService,
    @Inject(NotificationsService) private notify: NotificationsService,
  ) {}

  async create(cartToken: string, address: any, idempotencyKey?: string) {
    if (idempotencyKey && this.idem.has(idempotencyKey)) {
      return this.byNo(this.idem.get(idempotencyKey)!);
    }

    const fx = await this.fx.requireSellable();
    const check = await this.cart.validate(cartToken);
    if (!check.valid) {
      const demo = check.conflicts.find((c: any) => c.code === 'DEMO_PRODUCT_NOT_ORDERABLE');
      if (demo) throw Errors.demoNotOrderable();
      throw Errors.priceChanged({ conflicts: check.conflicts });
    }

    const cart = await this.cart.get(cartToken);
    if (!cart.items.length) throw Errors.badRequest('CART_EMPTY', 'السلة فارغة', 'Cart is empty');

    const lines = cart.items.map((it) => ({
      variantId: it.variantId, qty: it.qty,
      unit: Number(it.variant.priceUsdCents),
      total: Number(it.variant.priceUsdCents) * it.qty,
      name: it.variant.product.name,
      levelWarehouseId: it.variant.levels[0]?.warehouseId,
      available: it.variant.levels.reduce((a, l) => a + (l.onHand - l.reserved), 0),
    }));

    const shipping = 200;
    const totals = cashDue(lines.map((l) => l.total), shipping, fx.rate);

    const codMax = await this.setting('cod_max_order_usd_cents', 150000);
    if (totals.totalUsdCents > codMax) throw Errors.codLimit(codMax);

    const now = new Date();
    const order = await this.prisma.$transaction(async (tx) => {
      const seq = (await tx.order.count()) + 1;

      const addr = await tx.address.create({
        data: {
          userId: (await this.systemUser(tx)).id,
          recipientName: address.recipientName, governorate: address.governorate,
          city: address.city, neighborhood: address.neighborhood, street: address.street,
          landmark: address.landmark, details: address.details,
          phone: address.phone, altPhone: address.altPhone,
        },
      });

      const created = await tx.order.create({
        data: {
          publicId: publicId(), orderNo: orderNo(seq, now),
          userId: addr.userId, shippingAddressId: addr.id,
          subtotalUsdCents: BigInt(totals.totalUsdCents - shipping),
          shippingTotalUsdCents: BigInt(shipping),
          totalUsdCents: BigInt(totals.totalUsdCents),
          fxRateId: fx.rateId, fxRate: fx.rate,
          totalSyp: BigInt(totals.cashSyp),
          roundingDiffSyp: totals.roundingDiffSyp,
          fxStale: fx.health === 'STALE_MARGIN',
          priceLockedUntil: new Date(now.getTime() + CONFIRM_WINDOW_HOURS * 3_600_000),
          items: {
            create: lines.map((l) => ({
              variantId: l.variantId, qty: l.qty,
              unitPriceUsdCents: BigInt(l.unit), lineTotalUsdCents: BigInt(l.total),
              nameSnapshot: l.name as Prisma.InputJsonValue,
            })),
          },
          history: { create: { toStatus: 'PENDING_CONFIRMATION', actorType: 'CUSTOMER', source: 'SYSTEM' } },
        },
      });

      // ترقية الحجز المرن إلى حجز أوّلي ساعتين — ويُقصَّر للأجهزة النادرة
      for (const l of lines) {
        if (!l.levelWarehouseId) continue;
        const hours = l.available <= RARE_THRESHOLD ? 1 : ORDER_HOLD_HOURS;
        await tx.inventoryReservation.create({
          data: {
            variantId: l.variantId, warehouseId: l.levelWarehouseId, kind: 'ORDER_HOLD',
            qty: l.qty, orderId: created.id,
            expiresAt: new Date(now.getTime() + hours * 3_600_000),
          },
        });
        await tx.inventoryLevel.updateMany({
          where: { variantId: l.variantId, warehouseId: l.levelWarehouseId },
          data: { reserved: { increment: l.qty }, version: { increment: 1 } },
        });
        await tx.inventoryMovement.create({
          data: {
            variantId: l.variantId, warehouseId: l.levelWarehouseId,
            reason: 'RESERVE', qtyDelta: -l.qty, refType: 'order', refId: created.id,
          },
        });
      }

      await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
      return created;
    });

    if (idempotencyKey) this.idem.set(idempotencyKey, order.orderNo);

    // واتساب أولاً بزرَّي تأكيد وإلغاء؛ المكالمة تصعيد لا قاعدة (الفصل 8)
    await this.notify.send({
      type: 'order.created', level: 'P1', to: address.phone, entityId: order.orderNo,
      title: 'استلمنا طلبك',
      body: `${order.orderNo} — المستحق نقداً ${totals.cashSyp.toLocaleString('en-US')} ل.س. أكّد الطلب بالضغط على «أؤكد».`,
    });

    return this.byNo(order.orderNo);
  }

  async byNo(no: string) {
    const o = await this.prisma.order.findUnique({
      where: { orderNo: no },
      include: { items: true, shippingAddress: true, history: { orderBy: { createdAt: 'asc' } } },
    });
    if (!o) throw Errors.notFound('الطلب');
    return {
      orderNo: o.orderNo, status: o.status,
      paymentMethod: o.paymentMethod, paymentStatus: o.paymentStatus,
      totalUsdCents: Number(o.totalUsdCents),
      cashDueSyp: Number(o.totalSyp),
      roundingDiffSyp: o.roundingDiffSyp,
      fxRate: Number(o.fxRate), fxStale: o.fxStale,
      priceLockedUntil: o.priceLockedUntil.toISOString(),
      confirmationAttempts: o.confirmationAttempts,
      placedAt: o.placedAt.toISOString(),
      address: {
        recipientName: o.shippingAddress.recipientName,
        governorate: o.shippingAddress.governorate,
        city: o.shippingAddress.city, neighborhood: o.shippingAddress.neighborhood,
        landmark: o.shippingAddress.landmark, phone: o.shippingAddress.phone,
      },
      items: o.items.map((i) => ({
        name: (i.nameSnapshot as any).ar, qty: i.qty,
        unitPriceUsdCents: Number(i.unitPriceUsdCents),
      })),
      history: o.history.map((h) => ({ to: h.toStatus, at: h.createdAt.toISOString(), by: h.actorType })),
    };
  }

  /** تتبّع بلا حساب: رقم الطلب + آخر أربعة أرقام من الجوال (الفصل 14) */
  async track(no: string, phoneTail: string) {
    const o = await this.prisma.order.findUnique({ where: { orderNo: no }, include: { shippingAddress: true } });
    // استجابة موحّدة تمنع تعداد أرقام الطلبات
    if (!o || !o.shippingAddress.phone.endsWith(phoneTail)) throw Errors.notFound('الطلب');
    return {
      orderNo: o.orderNo, status: o.status,
      cashDueSyp: Number(o.totalSyp),
      placedAt: o.placedAt.toISOString(),
    };
  }

  private async setting<T>(key: string, fallback: T): Promise<T> {
    const s = await this.prisma.storeSetting.findUnique({ where: { key } });
    return (s?.value as T) ?? fallback;
  }

  private async systemUser(tx: Prisma.TransactionClient) {
    const phone = '+963900000000';
    return tx.user.upsert({
      where: { phoneE164: phone },
      update: {},
      create: { publicId: publicId(), phoneE164: phone, fullName: 'زبون تجريبي' },
    });
  }
}

@Controller('orders')
export class OrdersController {
  constructor(
    @Inject(OrdersService) private orders: OrdersService,
  ) {}

  @Post()
  async create(
    @Body() b: { cartToken: string; address: any },
    @Headers('idempotency-key') key?: string,
  ) {
    return { data: await this.orders.create(b.cartToken, b.address, key) };
  }

  @Get(':orderNo')
  async one(@Param('orderNo') no: string) { return { data: await this.orders.byNo(no) }; }

  @Get(':orderNo/track/:tail')
  async track(@Param('orderNo') no: string, @Param('tail') tail: string) {
    return { data: await this.orders.track(no, tail) };
  }
}
