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

  /** تسجيل التحصيل النقدي — occurred_at من جهاز المندوب، received_at من الخادم */
  async collect(
    no: string,
    b: { amountSyp: number; occurredAt?: string; deviceId?: string; reasonCode?: string },
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

    for (const item of items) {
      const wh = holds.find((h) => h.variantId === item.variantId)?.warehouseId
        ?? (await this.prisma.inventoryLevel.findFirst({ where: { variantId: item.variantId } }))?.warehouseId;
      if (!wh) continue;

      /* المتغيّر المسلسل: تُختار وحدات بعينها وتُختم SOLD وتُربط بالسطر.
         الاختيار يقع قبل الدفعة، والختم داخلها — فإن تغيّر المخزون بينهما
         رفض المحفِّز الدفعة كاملةً عند ضبط العدّاد. */
      const units = await this.prisma.deviceUnit.findMany({
        where: { variantId: item.variantId, warehouseId: wh, state: 'IN_STOCK' },
        orderBy: { id: 'asc' }, take: item.qty,
      });
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
