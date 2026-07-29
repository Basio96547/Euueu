import { Body, Controller, Get, Headers, Inject, Injectable, Param, Post, Req } from '@nestjs/common';
import { MaybeAuth, Protect } from '../common/guards.js';
import { PrismaService } from '../common/prisma.service.js';
import { FxService } from './fx.module.js';
import { CartService } from './cart.module.js';
import { CouponsService } from './coupons.module.js';
import { NotificationsService } from './notifications.service.js';
import { Errors } from '../common/errors.js';
import { cashDue, orderNo, publicId } from '../common/money.js';
import { kv } from '../common/kv.js';
import type { Prisma } from '@prisma/client';

/** الحجز الأوّلي ساعتان — عمر الحجز ليس عمر الطلب (الفصل 3) */
const ORDER_HOLD_HOURS = 2;
const CONFIRM_WINDOW_HOURS = 48;
const ANY_ROLE = ['CUSTOMER', 'SUPPORT', 'CATALOG_ADMIN', 'OPS_MANAGER', 'WAREHOUSE', 'COURIER', 'ADMIN'];
const RARE_THRESHOLD = 2;

@Injectable()
export class OrdersService {
  /* مفتاح التفرّد في مخزن مشترك: نسختان بذاكرتين منفصلتين تعنيان
     أن إعادة الإرسال بعد عودة الشبكة تُنشئ طلباً ثانياً. */
  private idemKey(k: string) { return `idem:order:${k}`; }

  constructor(
    @Inject(PrismaService) private prisma: PrismaService,
    @Inject(FxService) private fx: FxService,
    @Inject(CartService) private cart: CartService,
    @Inject(CouponsService) private coupons: CouponsService,
    @Inject(NotificationsService) private notify: NotificationsService,
  ) {}

  async create(cartToken: string, address: any, idempotencyKey?: string, buyerPublicId?: string) {
    if (idempotencyKey) {
      const prior = await kv().get<string>(this.idemKey(idempotencyKey));
      if (prior) return this.byNo(prior);
    }

    /* الإعدادات تُفرض هنا لا في الواجهة: زرٌّ مخفيّ في المتصفح ليس
       إيقافاً، ومن يعرف عنوان المسار يطلب رغم أنف الشاشة. */
    const paused = await this.setting('store_paused', false);
    if (paused) {
      throw Errors.badRequest('STORE_PAUSED',
        'المتجر متوقف مؤقتاً عن استقبال الطلبات — عد بعد قليل',
        'Store is paused');
    }

    const served = await this.setting('served_governorates', [] as any);
    if (Array.isArray(served) && served.length && !served.includes(address?.governorate)) {
      throw Errors.badRequest('GOVERNORATE_NOT_SERVED',
        'لا نوصّل إلى هذه المحافظة بعد — راسلنا لنرتّب لك عبر مكتب نقل',
        'Governorate not served', { governorate: address?.governorate });
    }

    const openMax = await this.setting('open_orders_per_phone_max', 2);
    if (address?.phone) {
      const open = await this.prisma.order.count({
        where: {
          shippingAddress: { phone: address.phone },
          status: { in: ['PENDING_CONFIRMATION', 'PROCESSING', 'SHIPPED', 'OUT_FOR_DELIVERY'] },
        },
      });
      if (open >= Number(openMax)) {
        throw Errors.badRequest('COD_OPEN_ORDERS_LIMIT',
          `لديك ${open} طلبات مفتوحة — أكمل استلامها قبل طلب جديد`,
          'Too many open orders');
      }
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

    /* شريحة الكمية تُطبَّق على السطر هنا كما تُطبَّق في السلة بالضبط.
       حسابها في مكان واحد فقط يعني أن الزبون يرى رقماً ويدفع آخر —
       وهو أسوأ من ألا يكون للشريحة وجود. */
    const lines = await Promise.all(cart.items.map(async (it) => {
      const unit = Number(it.variant.priceUsdCents);
      const gross = unit * it.qty;
      const brk = await this.coupons.quantityBreakFor(
        it.variant.sku, it.variant.product.category?.slug ?? null, it.qty,
      );
      const off = brk ? Math.floor((gross * brk.discountBp) / 10_000) : 0;
      return {
        variantId: it.variantId, qty: it.qty,
        unit,
        total: gross - off,
        name: it.variant.product.name,
        levelWarehouseId: it.variant.levels[0]?.warehouseId,
        // «النادر» يُقاس بما في المستودع لا بما تبقّى بعد الحجوزات:
        // المهلة القصيرة تخصّ آخر قطعتين حقيقتين، لا سلالاً معلّقة.
        available: it.variant.levels.reduce((a, l) => a + l.onHand, 0),
      };
    }));

    let shipping = 200;
    const grossSubtotal = lines.reduce((a, l) => a + l.total, 0);

    /* الحزم تُعاد من الخدمة نفسها التي تحسبها في السلة: حسابان
       منفصلان لخصم واحد يفترقان يوماً ما، والزبون يرى رقماً ويدفع آخر. */
    const bundles = await this.coupons.bundlesFor(
      cart.items.map((it) => ({
        sku: it.variant.sku, qty: it.qty,
        unitPriceUsdCents: Number(it.variant.priceUsdCents),
      })),
    );
    const bundleOff = bundles.reduce((a, b) => a + b.savedUsdCents, 0);
    const subtotal = Math.max(0, grossSubtotal - bundleOff);

    /* الخصم يُعاد تقييمه هنا من الرمز المحفوظ لا من رقم قادم مع الطلب.
       بين لحظة إدخال الرمز ولحظة الضغط على «أكّد» قد ينتهي الكوبون أو
       يُستنفَد أو يهبط المجموع تحت حدّه الأدنى — والقيمة المحسوبة سابقاً
       تصير وعداً لا يقابله شرط. */
    const cartRow = await this.prisma.cart.findUnique({ where: { token: cartToken } });
    let coupon: { code: string; couponId: string | null; discountUsdCents: number; freeShipping: boolean } | null = null;
    if (cartRow?.couponCode) {
      try {
        coupon = await this.coupons.evaluate(cartRow.couponCode, {
          subtotalUsdCents: subtotal, shippingUsdCents: shipping, phone: address.phone,
        });
      } catch (e: any) {
        // الكوبون بطل: يُرفض الإنشاء الصامت بسعر مختلف عمّا رآه الزبون
        throw Errors.badRequest('COUPON_NO_LONGER_VALID',
          `رمز الخصم ${cartRow.couponCode} لم يعد صالحاً: ${e?.response?.error?.message?.ar ?? 'انتهى'}. أزِله وأعد المحاولة.`,
          'Coupon no longer valid', { code: cartRow.couponCode });
      }
    }

    const discount = coupon?.discountUsdCents ?? 0;
    if (coupon?.freeShipping && discount > 0) shipping = 0;
    const billable = coupon?.freeShipping ? subtotal : Math.max(0, subtotal - discount);
    const totals = cashDue([billable], shipping, fx.rate);

    const codMax = await this.setting('cod_max_order_usd_cents', 150000);
    if (totals.totalUsdCents > codMax) throw Errors.codLimit(codMax);

    const now = new Date();
    const order = await this.prisma.$transaction(async (tx) => {
      const seq = (await tx.order.count()) + 1;

      // الطلب يُنسب لصاحبه إن كان داخلاً؛ وإلا لحساب الرقم الذي كتبه في العنوان.
      // الشراء بلا حساب هو الحالة الغالبة هنا، فلا يجوز أن يقف تسجيل الدخول
      // في وجه بيع — لكن الطلب يجب أن يبقى موصولاً برقم يُتتبَّع به.
      const owner = await this.buyer(tx, buyerPublicId, address.phone);

      const addr = await tx.address.create({
        data: {
          userId: owner.id,
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
          subtotalUsdCents: BigInt(grossSubtotal),
          discountTotalUsdCents: BigInt((coupon?.freeShipping ? 0 : discount) + bundleOff),
          shippingTotalUsdCents: BigInt(shipping),
          couponCode: coupon?.code,
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

      // ترقية الحجز المرن إلى حجز أوّلي ساعتين — ويُقصَّر للأجهزة النادرة.
      // ترقيةٌ لا إضافة: الحجز المرن خصم من المتاح أصلاً، فإنشاء حجز ثانٍ
      // بجانبه يخصم الكمية مرتين ويحجب بضاعة موجودة عن زبائن آخرين
      // حتى تنتهي مهلة المرن — والعدّاد لا يُصلح نفسه.
      for (const l of lines) {
        if (!l.levelWarehouseId) continue;
        const hours = l.available <= RARE_THRESHOLD ? 1 : ORDER_HOLD_HOURS;
        const expiresAt = new Date(now.getTime() + hours * 3_600_000);

        const soft = await tx.inventoryReservation.findFirst({
          where: { cartId: cart.id, variantId: l.variantId, kind: 'SOFT_HOLD' },
        });
        const alreadyHeld = soft?.qty ?? 0;

        if (soft) {
          await tx.inventoryReservation.update({
            where: { id: soft.id },
            data: { kind: 'ORDER_HOLD', qty: l.qty, orderId: created.id, cartId: null, expiresAt },
          });
        } else {
          await tx.inventoryReservation.create({
            data: {
              variantId: l.variantId, warehouseId: l.levelWarehouseId, kind: 'ORDER_HOLD',
              qty: l.qty, orderId: created.id, expiresAt,
            },
          });
        }

        // الفرق فقط: ما حجزته السلّة محسوب في العدّاد منذ الإضافة
        const delta = l.qty - alreadyHeld;
        if (delta !== 0) {
          await tx.inventoryLevel.updateMany({
            where: { variantId: l.variantId, warehouseId: l.levelWarehouseId },
            data: { reserved: { increment: delta }, version: { increment: 1 } },
          });
          // الدفتر يسجّل حركة الكميات؛ سطرٌ بفرق صفر ضجيج يُخفي الحركات الحقيقية
          await tx.inventoryMovement.create({
            data: {
              variantId: l.variantId, warehouseId: l.levelWarehouseId,
              reason: delta > 0 ? 'RESERVE' : 'RELEASE',
              qtyDelta: -delta, refType: 'order', refId: created.id,
              note: soft ? 'ترقية حجز مرن إلى حجز طلب' : undefined,
            },
          });
        }
      }

      /* عدّاد الاستخدام يُزاد داخل معاملة إنشاء الطلب لا عند إدخال الرمز:
         لو زِيد عند الإدخال لاستنفد فضوليٌّ كوبوناً بلا أن يشتري شيئاً،
         ولو زِيد بعدها لاستُخدم الرمز مرتين من جهازين في اللحظة نفسها. */
      if (coupon?.couponId) {
        await this.coupons.redeem(tx, {
          couponId: coupon.couponId, orderId: created.id,
          phone: address.phone, discountUsdCents: discount,
        });
      }

      await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
      return created;
    });

    // 72 ساعة تكفي إعادة إرسال متأخرة من جهاز عاد إلى الشبكة (الفصل 17 §17.11)
    if (idempotencyKey) await kv().set(this.idemKey(idempotencyKey), order.orderNo, 72 * 3600);

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

  /**
   * صاحب الطلب: المستخدم الداخل إن وُجد، وإلا حساب يُنشأ بصمت لرقم التسليم.
   * إنشاء الحساب من الرقم لا يمنحه شيئاً — لا رمز ولا صلاحية — لكنه يجعل
   * الزبون حين يسجّل دخوله لاحقاً بالرقم نفسه يجد طلباته السابقة في مكانها.
   */
  private async buyer(tx: Prisma.TransactionClient, buyerPublicId?: string, orderPhone?: string) {
    if (buyerPublicId) {
      const u = await tx.user.findUnique({ where: { publicId: buyerPublicId } });
      if (u) return u;
    }
    const phone = orderPhone && /^\+9639[0-9]{8}$/.test(orderPhone) ? orderPhone : '+963900000000';
    return tx.user.upsert({
      where: { phoneE164: phone },
      update: {},
      create: { publicId: publicId(), phoneE164: phone },
    });
  }

  /** طلباتي — تُقرأ بالهوية لا برقم يُخمَّن */
  async mine(userPublicId: string) {
    const user = await this.prisma.user.findUnique({ where: { publicId: userPublicId } });
    if (!user) throw Errors.notFound('المستخدم');
    const orders = await this.prisma.order.findMany({
      where: { userId: user.id },
      orderBy: { placedAt: 'desc' },
      take: 50,
      include: { items: true },
    });
    return orders.map((o) => ({
      orderNo: o.orderNo, status: o.status, paymentStatus: o.paymentStatus,
      cashDueSyp: Number(o.totalSyp), itemCount: o.items.reduce((a, i) => a + i.qty, 0),
      placedAt: o.placedAt,
    }));
  }
}

@Controller('orders')
export class OrdersController {
  constructor(
    @Inject(OrdersService) private orders: OrdersService,
  ) {}

  @Post()
  @MaybeAuth()
  async create(
    @Body() b: { cartToken: string; address: any },
    @Req() req: { user?: { sub: string } },
    @Headers('idempotency-key') key?: string,
  ) {
    return { data: await this.orders.create(b.cartToken, b.address, key, req.user?.sub) };
  }

  // «طلباتي» قبل «:orderNo» — وإلا التقطه المسار المتغيّر كرقم طلب
  @Get('mine')
  @Protect(...ANY_ROLE)
  async mine(@Req() req: { user?: { sub: string } }) {
    return { data: await this.orders.mine(req.user!.sub) };
  }

  @Get(':orderNo')
  async one(@Param('orderNo') no: string) { return { data: await this.orders.byNo(no) }; }

  @Get(':orderNo/track/:tail')
  async track(@Param('orderNo') no: string, @Param('tail') tail: string) {
    return { data: await this.orders.track(no, tail) };
  }
}
