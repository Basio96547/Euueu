import { PrismaService } from '../common/prisma.service.js';
import { NotificationsService } from './notifications.service.js';
import { SettlementsService } from './settlements.module.js';
import { Errors } from '../common/errors.js';
import { runBatch } from '../common/batch.js';
import { roundCash } from '../common/money.js';
import { kv } from '../common/kv.js';

export class CourierService {
  /** مفاتيح التفرّد: الإرسال المكرر بعد عودة الشبكة لا يحصّل مرتين (الفصل 17 §17.11) */
  private idemKey(k: string) { return `idem:collect:${k}`; }

  constructor(
    private prisma: PrismaService,
    private notify: NotificationsService,
    private settlements: SettlementsService,
  ) {}
  async tasks() {
    const rows = await this.prisma.order.findMany({
      where: { status: { in: ['PROCESSING', 'SHIPPED', 'OUT_FOR_DELIVERY'] } },
      include: { shippingAddress: true, items: true },
      orderBy: { placedAt: 'asc' },
    });
    return {
      data: rows.map((o) => ({
        orderNo: o.orderNo, status: o.status,
        /* المبلغ المعروض للمندوب مقرَّب كما سيُقبض تماماً */
        cashDueSyp: roundCash(Number(o.totalSyp)),
        customer: o.shippingAddress.recipientName,
        phone: o.shippingAddress.phone,
        altPhone: o.shippingAddress.altPhone,
        governorate: o.shippingAddress.governorate,
        city: o.shippingAddress.city,
        neighborhood: o.shippingAddress.neighborhood,
        landmark: o.shippingAddress.landmark,
        itemCount: o.items.length,
      })),
    };
  }
  async status(no: string, b: { to: 'SHIPPED' | 'OUT_FOR_DELIVERY' | 'DELIVERY_FAILED' }) {
    const o = await this.prisma.order.findUnique({ where: { orderNo: no }, include: { shippingAddress: true } });
    if (!o) throw Errors.notFound('الطلب');

    const allowed: Record<string, string[]> = {
      PROCESSING: ['SHIPPED'],
      SHIPPED: ['OUT_FOR_DELIVERY'],
      OUT_FOR_DELIVERY: ['DELIVERY_FAILED'],
    };
    if (!(allowed[o.status] ?? []).includes(b.to)) throw Errors.invalidTransition(o.status, b.to);

    await this.prisma.$transaction([
      this.prisma.order.update({ where: { id: o.id }, data: { status: b.to as any } }),
      this.prisma.orderStatusHistory.create({
        data: { orderId: o.id, fromStatus: o.status, toStatus: b.to as any, actorType: 'COURIER', source: 'COURIER_APP' },
      }),
    ]);

    if (b.to === 'OUT_FOR_DELIVERY') {
      await this.notify.send({
        type: 'order.out_for_delivery', level: 'P1', to: o.shippingAddress.phone, entityId: no,
        title: 'طلبك خرج للتوصيل',
        body: `${no} — المبلغ المستحق ${roundCash(Number(o.totalSyp)).toLocaleString('en-US')} ل.س`,
      });
    }
    return { data: { orderNo: no, status: b.to } };
  }

  /**
   * تسجيل التحصيل النقدي — occurred_at من جهاز المندوب، received_at من الخادم.
   *
   * و`imeis` أرقامُ الأجهزة التي سُلِّمت فعلاً. كانت الوحدات تُختار
   * بترتيب معرّفها: أوّلُ ما في الرفّ يُختَم «مبيعاً» ويُربط بالسطر، أياً
   * كان الجهاز الذي وُضع في يد الزبون. فالكفالة تُفعَّل على غير جهازه،
   * والتحقّق العام بالـIMEI يقول «غير موجود» لجهازٍ بِيع فعلاً، والمرتجع
   * يُرفض لأن رقمه لا يطابق المسجَّل.
   *
   * وهذه ليست دقّةً محاسبية: في سوقٍ أكثرُه مستورَد يدوياً، رقمُ الجهاز
   * هو الكفالة كلّها.
   */
  async collect(
    no: string,
    b: { amountSyp: number; occurredAt?: string; deviceId?: string; reasonCode?: string; imeis?: string[] },
    req: { user?: { sub: string } },
    key?: string,
  ) {
    if (key) {
      const prior = await kv().get<unknown>(this.idemKey(key));
      if (prior) return { data: prior };
    }

    const o = await this.prisma.order.findUnique({ where: { orderNo: no }, include: { shippingAddress: true } });
    if (!o) throw Errors.notFound('الطلب');
    if (o.paymentStatus === 'COLLECTED') {
      throw Errors.invalidTransition('COLLECTED', 'COLLECTED');
    }
    if (o.status !== 'OUT_FOR_DELIVERY') throw Errors.invalidTransition(o.status, 'DELIVERED');

    const due = roundCash(Number(o.totalSyp));
    const occurredAt = b.occurredAt ? new Date(b.occurredAt) : new Date();
    // ساعة جهاز منحرفة تفسد التسوية بصمت
    if (Math.abs(Date.now() - occurredAt.getTime()) > 10 * 60_000) {
      throw Errors.badRequest('DEVICE_CLOCK_SKEW', 'ساعة الجهاز منحرفة — زامن الوقت', 'Device clock skew');
    }

    // تحصيل أكثر من المستحق ممنوع: فائضٌ في يد المندوب لا سطر له في أي دفتر
    if (b.amountSyp > due) {
      throw Errors.badRequest('OVERCOLLECTION',
        `المستحق ${due.toLocaleString('en-US')} ل.س ولا يجوز تحصيل أكثر منه`,
        'Cannot collect more than due');
    }
    // التحصيل الجزئي قرار لا سهو: يلزمه سبب مسجَّل
    if (b.amountSyp < due && !b.reasonCode) {
      throw Errors.badRequest('PARTIAL_REASON_REQUIRED',
        'التحصيل الجزئي يتطلب سبباً: CUSTOMER_SHORT_CASH أو AGREED_DISCOUNT',
        'Partial collection requires a reason code');
    }

    const collector = await this.prisma.user.findUnique({ where: { publicId: req.user!.sub } });
    if (!collector) throw Errors.notFound('المحصِّل');

    /* التسليم هو لحظة خروج البضاعة، فهنا يُقيَّد البيع لا في مكان آخر:
       الحجز يموت لأنه أدّى غرضه، وon_hand ينقص لأن الجهاز صار بيد زبونه،
       وسطر SALE يُكتب ليبقى الدفتر شاهداً. تأجيل هذا إلى تفعيل الكفالة
       يعني أن المتجر يعرض للبيع أجهزةً سلّمها بالفعل.

       الترتيب هنا جزء من العقد لا تفصيل أسلوب: تُختم الوحدات SOLD أولاً
       ثم يُضبط العدّاد أخيراً، لأن محفِّز التطابق يفحص عند تحديث العدّاد.
       عكسُه يجعل المحفِّز يرفض العملية الصحيحة نفسها. */
    const items = await this.prisma.orderItem.findMany({ where: { orderId: o.id } });
    const holds = await this.prisma.inventoryReservation.findMany({ where: { orderId: o.id } });

    const writes: any[] = [
      this.prisma.order.update({
        where: { id: o.id },
        data: {
          status: 'DELIVERED',
          paymentStatus: b.amountSyp >= due ? 'COLLECTED' : 'PARTIAL',
          collectedAmountSyp: BigInt(b.amountSyp),
          collectedAt: occurredAt,
          collectedBy: collector.id,
          deliveredAt: occurredAt,
          confirmationNotes: b.reasonCode ? `تحصيل جزئي: ${b.reasonCode}` : undefined,
        },
      }),
      ...(await this.settlements.attachOps({
        orderId: o.id,
        collectorId: collector.id,
        collectorType: 'COURIER',
        expectedSyp: o.totalSyp,
        collectedSyp: BigInt(b.amountSyp),
        roundingDiffSyp: o.roundingDiffSyp,
        at: occurredAt,
      })),
      this.prisma.orderStatusHistory.create({
        data: {
          orderId: o.id, fromStatus: 'OUT_FOR_DELIVERY', toStatus: 'DELIVERED',
          actorType: 'COURIER', source: 'COURIER_APP',
        },
      }),
    ];

    // تحرير الحجوزات: الصف يُحذف والعدّاد يُخصم معاً
    for (const h of holds) {
      writes.push(this.prisma.inventoryReservation.delete({ where: { id: h.id } }));
      writes.push(this.prisma.$executeRaw`
        UPDATE inventory_levels
           SET reserved = max(0, reserved - ${h.qty}), version = version + 1
         WHERE variant_id = ${h.variantId} AND warehouse_id = ${h.warehouseId}`);
    }

    /* أرقامٌ مُدخَلة: تُطابَق بالجهاز لا بالترتيب. والمطابقة قبل أي كتابة،
       فرقمٌ واحد خاطئ يُسقط التحصيل كلّه ولا يُسلّم نصفه. */
    const given = (b.imeis ?? []).map((x) => String(x).replace(/\D/g, '')).filter(Boolean);
    const claimed = new Map<string, { id: string; variantId: string }>();
    for (const imei of given) {
      const u = await this.prisma.deviceUnit.findUnique({
        where: { imei }, select: { id: true, variantId: true, state: true },
      });
      if (!u) {
        throw Errors.badRequest('IMEI_UNKNOWN',
          `الرقم ${imei} غير مسجَّل في المخزون`, `IMEI ${imei} not in stock`);
      }
      if (u.state !== 'IN_STOCK') {
        throw Errors.badRequest('IMEI_NOT_AVAILABLE',
          `الجهاز ${imei} ليس على الرفّ (حالته ${u.state})`, `IMEI ${imei} is not IN_STOCK`);
      }
      if (!items.some((it) => it.variantId === u.variantId)) {
        throw Errors.badRequest('IMEI_WRONG_VARIANT',
          `الجهاز ${imei} ليس من أصناف هذا الطلب`, `IMEI ${imei} is not in this order`);
      }
      claimed.set(imei, { id: u.id, variantId: u.variantId });
    }

    /*
      الأصناف المسلسلة تلزمها أرقامها.
      ترك السلوك القديم احتياطاً كان يُبقي الثغرة مفتوحة لمن ينادي الواجهة
      مباشرة: مندوبٌ يتخطّى الشاشة، أو تكاملٌ لاحق. والقاعدة أن ما لا
      يُقبل من الواجهة لا يُقبل من غيرها.
      والشرط على الصنف المسلسل وحده: ملحقٌ بلا وحدات مرقَّمة لا رقم له.
    */
    for (const item of items) {
      const serialized = await this.prisma.deviceUnit.count({
        where: { variantId: item.variantId, state: 'IN_STOCK' },
      });
      if (!serialized) continue;
      const forItem = [...claimed.values()].filter((u) => u.variantId === item.variantId).length;
      if (forItem < item.qty) {
        throw Errors.badRequest('IMEI_REQUIRED',
          `أدخل رقم كل جهاز تسلّمه (المطلوب ${item.qty}، أُدخل ${forItem})`,
          `IMEI required for each serialized unit (${item.qty} needed, ${forItem} given)`);
      }
    }

    for (const item of items) {
      const wh = holds.find((h) => h.variantId === item.variantId)?.warehouseId
        ?? (await this.prisma.inventoryLevel.findFirst({ where: { variantId: item.variantId } }))?.warehouseId;
      if (!wh) continue;

      /* المتغيّر المسلسل: الوحدة التي أدخل المندوب رقمها هي التي تُختَم
         «مبيعة» وتُربط بالسطر — لا أوّل ما في الرفّ. */
      const units = [...claimed.values()]
        .filter((u) => u.variantId === item.variantId)
        .slice(0, item.qty)
        .map((u) => ({ id: u.id }));
      for (const [i, u] of units.entries()) {
        writes.push(this.prisma.deviceUnit.update({
          where: { id: u.id },
          data: { state: 'SOLD', ...(i === 0 ? { orderItemId: item.id } : {}) },
        }));
      }

      writes.push(this.prisma.$executeRaw`
        UPDATE inventory_levels
           SET on_hand = max(0, on_hand - ${item.qty}), version = version + 1
         WHERE variant_id = ${item.variantId} AND warehouse_id = ${wh}`);

      writes.push(this.prisma.inventoryMovement.create({
        data: {
          variantId: item.variantId, warehouseId: wh,
          reason: 'SALE', qtyDelta: -item.qty, refType: 'order', refId: o.id,
          note: units.length ? `وحدات مسلسلة: ${units.length}` : undefined,
        },
      }));
    }

    await runBatch(this.prisma, writes);
    const result = {
      status: 'DELIVERED',
      paymentStatus: b.amountSyp >= due ? 'COLLECTED' : 'PARTIAL',
    };

    await this.notify.send({
      type: 'order.delivered', level: 'P2', to: o.shippingAddress.phone, entityId: no,
      title: 'تم التسليم', body: `${no} — شكراً لك. إيصالك في حسابك.`,
    });

    const payload = {
      orderNo: no, status: result.status, paymentStatus: result.paymentStatus,
      dueSyp: due, collectedSyp: b.amountSyp,
      occurredAt: occurredAt.toISOString(), receivedAt: new Date().toISOString(),
    };
    if (key) await kv().set(this.idemKey(key), payload, 72 * 3600);
    return { data: payload };
  }
}
