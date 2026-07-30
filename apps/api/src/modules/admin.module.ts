import { PrismaService } from '../common/prisma.service.js';
import { OrdersService } from './orders.module.js';
import { NotificationsService } from './notifications.service.js';
import { ReservationSweeper } from './reservations.sweeper.js';
import { Errors } from '../common/errors.js';
import { runBatch } from '../common/batch.js';

type Outcome = 'CONFIRMED' | 'NO_ANSWER' | 'RESCHEDULE' | 'ADDRESS_FIXED' | 'CANCELLED';

/** حجز مُمدَّد بعد أول تفاعل ناجح — 12 ساعة للأجهزة النادرة */
const EXT_HOURS = 48;
const RARE_EXT_HOURS = 12;
const RARE_THRESHOLD = 2;

export class AdminService {
  constructor(
    private prisma: PrismaService,
    private orders: OrdersService,
    private notify: NotificationsService,
    private sweeper: ReservationSweeper,
  ) {}
  async list(status?: string) {
    const rows = await this.prisma.order.findMany({
      where: status ? { status: status as any } : {},
      orderBy: { placedAt: 'desc' }, take: 50,
      include: { shippingAddress: true, items: true },
    });
    const now = Date.now();
    return {
      data: rows.map((o) => ({
        orderNo: o.orderNo, status: o.status, paymentStatus: o.paymentStatus,
        cashDueSyp: Number(o.totalSyp), fxStale: o.fxStale,
        confirmationAttempts: o.confirmationAttempts,
        /* مؤقّت نافذة التأكيد: ما تبقّى بالساعات */
        hoursLeft: Math.round(((o.priceLockedUntil.getTime() - now) / 3_600_000) * 10) / 10,
        customer: o.shippingAddress.recipientName,
        phone: o.shippingAddress.phone,
        governorate: o.shippingAddress.governorate,
        landmark: o.shippingAddress.landmark,
        itemCount: o.items.length,
        placedAt: o.placedAt.toISOString(),
      })),
    };
  }

  /** انتقال PENDING_CONFIRMATION → PROCESSING بعد تأكيد العميل (الفصل 8 §8.4) */
  async confirm(no: string, b: { outcome: Outcome; notes?: string }) {
    const order = await this.prisma.order.findUnique({
      where: { orderNo: no },
      include: { items: { include: { variant: { include: { levels: true } } } }, shippingAddress: true },
    });
    if (!order) throw Errors.notFound('الطلب');
    if (order.status !== 'PENDING_CONFIRMATION') {
      throw Errors.invalidTransition(order.status, 'PROCESSING');
    }

    if (b.outcome === 'CONFIRMED') {
      // إعادة تحقق إلزامية: الحجز الأوّلي قد يكون انتهى (الفصل 8)
      for (const it of order.items) {
        const available = it.variant.levels.reduce((a, l) => a + (l.onHand - l.reserved), 0);
        const reserved = await this.prisma.inventoryReservation.findFirst({
          where: { orderId: order.id, variantId: it.variantId, expiresAt: { gt: new Date() } },
        });
        if (!reserved && available < it.qty) throw Errors.outOfStock(it.variant.publicId, available);
      }

      await runBatch(this.prisma, [
        this.prisma.order.update({
          where: { id: order.id },
          data: {
            status: 'PROCESSING', confirmedAt: new Date(),
            confirmationNotes: b.notes ?? 'WHATSAPP_SELF_CONFIRM',
          },
        }),
        this.prisma.orderStatusHistory.create({
          data: {
            orderId: order.id, fromStatus: 'PENDING_CONFIRMATION', toStatus: 'PROCESSING',
            actorType: 'OPS', source: 'ADMIN',
          },
        }),
      ]);
      const updated = { orderNo: order.orderNo, status: 'PROCESSING' };

      await this.notify.send({
        type: 'order.confirmed', level: 'P1', to: order.shippingAddress.phone, entityId: no,
        title: 'تأكّد طلبك', body: `${no} — نجهّزه الآن، ويصلك خلال 24–48 ساعة.`,
      });
      return { data: { orderNo: updated.orderNo, status: updated.status } };
    }

    if (b.outcome === 'CANCELLED') {
      await this.release(order.id, 'CANCELLED');
      await this.notify.send({
        type: 'order.cancelled', level: 'P0', to: order.shippingAddress.phone, entityId: no,
        title: 'أُلغي طلبك', body: `${no} — ${b.notes ?? 'بناءً على طلبك'}`,
      });
      return { data: { orderNo: no, status: 'CANCELLED' } };
    }

    // محاولة فاشلة: لا تمديد للحجز، والثالثة تُلغي الطلب
    const attempts = order.confirmationAttempts + 1;
    if (attempts >= 3) {
      await this.release(order.id, 'CANCELLED');
      return { data: { orderNo: no, status: 'CANCELLED', reason: 'THREE_FAILED_ATTEMPTS' } };
    }

    // تفاعل ناجح (إعادة جدولة أو تصحيح عنوان) يمدّد الحجز
    if (b.outcome === 'RESCHEDULE' || b.outcome === 'ADDRESS_FIXED') {
      for (const it of order.items) {
        const available = it.variant.levels.reduce((a, l) => a + (l.onHand - l.reserved), 0);
        const hours = available <= RARE_THRESHOLD ? RARE_EXT_HOURS : EXT_HOURS;
        await this.prisma.inventoryReservation.updateMany({
          where: { orderId: order.id, variantId: it.variantId },
          data: { kind: 'ORDER_HOLD_EXT', expiresAt: new Date(Date.now() + hours * 3_600_000) },
        });
      }
    }

    await this.prisma.order.update({
      where: { id: order.id },
      data: { confirmationAttempts: attempts, confirmationNotes: b.notes },
    });
    return { data: { orderNo: no, status: order.status, confirmationAttempts: attempts } };
  }

  /** اعتماد سعر صرف جديد — صف جديد دائماً، لا تعديل على قديم */
  async setFx(b: { rate: number; validHours?: number; note?: string }) {
    const now = new Date();
    const row = await this.prisma.fxRate.create({
      data: {
        rate: b.rate, effectiveFrom: now,
        validUntil: new Date(now.getTime() + (b.validHours ?? 24) * 3_600_000),
        note: b.note,
      },
    });
    await this.prisma.auditLog.create({
      data: { action: 'fx.update', entityType: 'fx_rates', entityId: row.id, diff: { rate: b.rate } },
    });
    return { data: { rate: Number(row.rate), validUntil: row.validUntil.toISOString() } };
  }

  /** قائمة المنتجات للوحة — تشمل التجريبية التي يخفيها المتجر العام */
  async products(demo?: string) {
    const rows = await this.prisma.product.findMany({
      where: {
        deletedAt: null,
        ...(demo === 'true' ? { isDemo: true } : demo === 'false' ? { isDemo: false } : {}),
      },
      orderBy: [{ isDemo: 'desc' }, { slug: 'asc' }],
      include: { brand: true, variants: { include: { levels: true } } },
    });
    return {
      data: rows.map((p) => ({
        slug: p.slug, name: p.name, status: p.status, isDemo: p.isDemo,
        brand: p.brand.name,
        variants: p.variants.map((v) => ({
          sku: v.sku,
          priceUsdCents: Number(v.priceUsdCents),
          onHand: v.levels.reduce((a, l) => a + l.onHand, 0),
          reserved: v.levels.reduce((a, l) => a + l.reserved, 0),
        })),
      })),
    };
  }

  /**
   * تحويل منتج تجريبي إلى حقيقي.
   *
   * مخزون المنتج التجريبي رقمٌ عرضيّ كُتب في inventory_levels مباشرة:
   * لا وحدات أجهزة خلفه ولا حركة في الدفتر. لو تُرك كما هو بعد التحويل
   * لصار المتجر يبيع هواءً، ولانفجر محفِّز التطابق عند أول استلام حقيقي
   * (count(units) ≠ on_hand). لذلك التحويل يصفّر الكمية بالضرورة:
   * المنتج يصير حقيقياً بمخزون صفر، والبضاعة تدخل من بوابة المشتريات وحدها.
   */
  async promote(slug: string) {
    // كنس أولاً: حجز ميت لا يجوز أن يقف في وجه التحويل
    await this.sweeper.sweep();

    const product = await this.prisma.product.findFirst({
      where: { slug, deletedAt: null },
      include: { variants: { include: { levels: true } } },
    });
    if (!product) throw Errors.notFound('المنتج');
    if (!product.isDemo) {
      throw Errors.badRequest('PRODUCT_ALREADY_REAL',
        'هذا المنتج حقيقي أصلاً', 'Product is already real');
    }

    // حجز قائم يعني سلّة أو طلباً معلّقاً على كمية وهمية — تصفيرها يُنتج متاحاً سالباً
    const held = product.variants.flatMap((v) => v.levels).reduce((a, l) => a + l.reserved, 0);
    if (held > 0) {
      throw Errors.badRequest('PRODUCT_HAS_HOLDS',
        `على المنتج ${held} حجزاً قائماً — حرِّرها قبل التحويل`,
        'Release existing reservations first');
    }

    const ids = product.variants.map((v) => v.id);
    const cleared = product.variants.flatMap((v) => v.levels).reduce((a, l) => a + l.onHand, 0);

    await runBatch(this.prisma, [
      this.prisma.inventoryLevel.updateMany({
        where: { variantId: { in: ids } },
        data: { onHand: 0, version: { increment: 1 } },
      }),
      this.prisma.product.update({ where: { id: product.id }, data: { isDemo: false } }),
      this.prisma.auditLog.create({
        data: {
          action: 'catalog.promote', entityType: 'products', entityId: product.id,
          diff: { slug, isDemo: { from: true, to: false }, demoStockCleared: cleared },
        },
      }),
    ]);

    return {
      data: {
        slug, isDemo: false, demoStockCleared: cleared,
        note: 'المنتج حقيقي الآن بمخزون صفر — استلم البضاعة من المشتريات لتفعيل البيع.',
      },
    };
  }

  /** كنس يدوي — الدوري يعمل كل دقيقة، وهذا لمن أراد التحقق فوراً */
  async sweep() { return { data: await this.sweeper.sweep() }; }

  /**
   * إعدادات المتجر — الفصل 18
   * ما يتغيّر بلا نشر كود: السقوف والمحافظات المخدومة وإيقاف المتجر.
   * غيابها يعني أن تعطيل الطلبات ساعةَ أزمة يحتاج مبرمجاً ونشراً.
   */
  async settings() {
    const rows = await this.prisma.storeSetting.findMany({ orderBy: { key: 'asc' } });
    return { data: rows.map((r) => ({ key: r.key, value: r.value, updatedAt: r.updatedAt })) };
  }
  async setSetting(b: { key: string; value: unknown }, req: { user?: { sub: string } }) {
    const KNOWN: Record<string, 'number' | 'boolean' | 'array'> = {
      cod_max_order_usd_cents: 'number',
      open_orders_per_phone_max: 'number',
      cash_rounding_step_syp: 'number',
      confirmation_window_hours: 'number',
      order_hold_hours: 'number',
      order_hold_ext_hours: 'number',
      rare_stock_threshold: 'number',
      rare_hold_ext_hours: 'number',
      free_shipping_above_usd_cents: 'number',
      courier_commission_bp: 'number',
      served_governorates: 'array',
      store_paused: 'boolean',
      demo_mode: 'boolean',
    };
    const kind = KNOWN[b.key];
    // مفتاح غير معروف يعني خطأً مطبعياً يُنشئ إعداداً لا يقرؤه أحد
    if (!kind) {
      throw Errors.badRequest('SETTING_UNKNOWN',
        `مفتاح غير معروف: ${b.key}`, 'Unknown setting key');
    }
    const okType =
      kind === 'number' ? typeof b.value === 'number' && Number.isFinite(b.value) && b.value >= 0
      : kind === 'boolean' ? typeof b.value === 'boolean'
      : Array.isArray(b.value);
    if (!okType) {
      throw Errors.badRequest('SETTING_TYPE_INVALID',
        `قيمة ${b.key} يجب أن تكون ${kind === 'number' ? 'رقماً غير سالب' : kind === 'boolean' ? 'صح أو خطأ' : 'قائمة'}`,
        'Invalid setting value');
    }

    const actor = await this.prisma.user.findUnique({ where: { publicId: req.user!.sub } });
    const before = await this.prisma.storeSetting.findUnique({ where: { key: b.key } });
    const row = await this.prisma.storeSetting.upsert({
      where: { key: b.key },
      update: { value: b.value as any, updatedBy: actor?.id },
      create: { key: b.key, value: b.value as any, updatedBy: actor?.id },
    });
    await this.prisma.auditLog.create({
      data: {
        actorId: actor?.id, action: 'settings.update', entityType: 'store_settings', entityId: null,
        diff: { key: b.key, from: (before?.value ?? null) as any, to: b.value as any },
      },
    });
    return { data: { key: row.key, value: row.value } };
  }
  async dashboard() {
    const [pending, processing, delivered, lowStock, staleOrders] = await Promise.all([
      this.prisma.order.count({ where: { status: 'PENDING_CONFIRMATION' } }),
      this.prisma.order.count({ where: { status: 'PROCESSING' } }),
      this.prisma.order.count({ where: { status: 'DELIVERED' } }),
      this.prisma.inventoryLevel.count({ where: { onHand: { lte: 2 } } }),
      this.prisma.order.count({ where: { fxStale: true } }),
    ]);
    const collected = await this.prisma.order.aggregate({
      where: { paymentStatus: 'COLLECTED' }, _sum: { collectedAmountSyp: true },
    });
    return {
      data: {
        pending, processing, delivered, lowStock, staleOrders,
        collectedSyp: Number(collected._sum.collectedAmountSyp ?? 0),
      },
    };
  }

  private async release(orderId: string, to: 'CANCELLED') {
    const holds = await this.prisma.inventoryReservation.findMany({ where: { orderId } });

    const writes: any[] = [];
    for (const h of holds) {
      writes.push(this.prisma.inventoryLevel.updateMany({
        where: { variantId: h.variantId, warehouseId: h.warehouseId },
        data: { reserved: { decrement: h.qty }, version: { increment: 1 } },
      }));
      writes.push(this.prisma.inventoryMovement.create({
        data: {
          variantId: h.variantId, warehouseId: h.warehouseId,
          reason: 'RELEASE', qtyDelta: h.qty, refType: 'order', refId: orderId,
        },
      }));
    }
    writes.push(this.prisma.inventoryReservation.deleteMany({ where: { orderId } }));
    writes.push(this.prisma.order.update({ where: { id: orderId }, data: { status: to } }));
    writes.push(this.prisma.orderStatusHistory.create({
      data: { orderId, toStatus: to, actorType: 'SYSTEM', source: 'SYSTEM' },
    }));

    await runBatch(this.prisma, writes);
  }
}
