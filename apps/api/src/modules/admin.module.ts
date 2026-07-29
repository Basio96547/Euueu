import { Inject, Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service.js';
import { OrdersService } from './orders.module.js';
import { NotificationsService } from './notifications.service.js';
import { Errors } from '../common/errors.js';

type Outcome = 'CONFIRMED' | 'NO_ANSWER' | 'RESCHEDULE' | 'ADDRESS_FIXED' | 'CANCELLED';

/** حجز مُمدَّد بعد أول تفاعل ناجح — 12 ساعة للأجهزة النادرة */
const EXT_HOURS = 48;
const RARE_EXT_HOURS = 12;
const RARE_THRESHOLD = 2;

@Controller('admin')
export class AdminController {
  constructor(
    @Inject(PrismaService) private prisma: PrismaService,
    @Inject(OrdersService) private orders: OrdersService,
    @Inject(NotificationsService) private notify: NotificationsService,
  ) {}

  @Get('orders')
  async list(@Query('status') status?: string) {
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
  @Post('orders/:orderNo/confirm')
  async confirm(@Param('orderNo') no: string, @Body() b: { outcome: Outcome; notes?: string }) {
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

      const updated = await this.prisma.$transaction(async (tx) => {
        const o = await tx.order.update({
          where: { id: order.id },
          data: {
            status: 'PROCESSING', confirmedAt: new Date(),
            confirmationNotes: b.notes ?? 'WHATSAPP_SELF_CONFIRM',
          },
        });
        await tx.orderStatusHistory.create({
          data: {
            orderId: order.id, fromStatus: 'PENDING_CONFIRMATION', toStatus: 'PROCESSING',
            actorType: 'OPS', source: 'ADMIN',
          },
        });
        return o;
      });

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
  @Post('fx')
  async setFx(@Body() b: { rate: number; validHours?: number; note?: string }) {
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

  @Get('dashboard')
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
    await this.prisma.$transaction(async (tx) => {
      const holds = await tx.inventoryReservation.findMany({ where: { orderId } });
      for (const h of holds) {
        await tx.inventoryLevel.updateMany({
          where: { variantId: h.variantId, warehouseId: h.warehouseId },
          data: { reserved: { decrement: h.qty }, version: { increment: 1 } },
        });
        await tx.inventoryMovement.create({
          data: {
            variantId: h.variantId, warehouseId: h.warehouseId,
            reason: 'RELEASE', qtyDelta: h.qty, refType: 'order', refId: orderId,
          },
        });
      }
      await tx.inventoryReservation.deleteMany({ where: { orderId } });
      await tx.order.update({ where: { id: orderId }, data: { status: to } });
      await tx.orderStatusHistory.create({
        data: { orderId, toStatus: to, actorType: 'SYSTEM', source: 'SYSTEM' },
      });
    });
  }
}
