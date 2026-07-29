import { Inject, Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service.js';
import { NotificationsService } from './notifications.service.js';
import { Errors } from '../common/errors.js';
import { roundCash } from '../common/money.js';

@Controller('courier')
export class CourierController {
  /** مفاتيح التفرّد: الإرسال المكرر بعد عودة الشبكة لا يحصّل مرتين (الفصل 17 §17.11) */
  private idem = new Map<string, unknown>();

  constructor(
    @Inject(PrismaService) private prisma: PrismaService,
    @Inject(NotificationsService) private notify: NotificationsService,
  ) {}

  @Get('tasks')
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

  @Post('orders/:orderNo/status')
  async status(@Param('orderNo') no: string, @Body() b: { to: 'SHIPPED' | 'OUT_FOR_DELIVERY' | 'DELIVERY_FAILED' }) {
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
  @Post('orders/:orderNo/collect')
  async collect(
    @Param('orderNo') no: string,
    @Body() b: { amountSyp: number; occurredAt?: string; deviceId?: string },
    @Headers('idempotency-key') key?: string,
  ) {
    if (key && this.idem.has(key)) return { data: this.idem.get(key) };

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

    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.order.update({
        where: { id: o.id },
        data: {
          status: 'DELIVERED',
          paymentStatus: b.amountSyp >= due ? 'COLLECTED' : 'PARTIAL',
          collectedAmountSyp: BigInt(b.amountSyp),
          collectedAt: occurredAt,
        },
      });
      await tx.orderStatusHistory.create({
        data: {
          orderId: o.id, fromStatus: 'OUT_FOR_DELIVERY', toStatus: 'DELIVERED',
          actorType: 'COURIER', source: 'COURIER_APP',
        },
      });
      return updated;
    });

    await this.notify.send({
      type: 'order.delivered', level: 'P2', to: o.shippingAddress.phone, entityId: no,
      title: 'تم التسليم', body: `${no} — شكراً لك. إيصالك في حسابك.`,
    });

    const payload = {
      orderNo: no, status: result.status, paymentStatus: result.paymentStatus,
      dueSyp: due, collectedSyp: b.amountSyp,
      occurredAt: occurredAt.toISOString(), receivedAt: new Date().toISOString(),
    };
    if (key) this.idem.set(key, payload);
    return { data: payload };
  }
}
