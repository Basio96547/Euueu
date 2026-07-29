import { Body, Controller, Get, Inject, Injectable, Param, Post, Query, Req } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service.js';
import { NotificationsService } from './notifications.service.js';
import { Errors } from '../common/errors.js';
import { Protect } from '../common/guards.js';
import type { Prisma } from '@prisma/client';

/**
 * التسوية النقدية اليومية — الفصل 8 §8.7
 *
 * المتجر يعمل نقداً بالكامل: لا بوابة دفع تُمسك دفتراً نيابةً عنه.
 * فما لم يُطابَق ما بيد كل مندوب آخر النهار بما يقابله من طلبات مسلَّمة،
 * لا أحد يعرف أين المال — والعجز يظهر بعد شهر بلا سبيل لردّه إلى يومه.
 *
 * صف واحد لكل (محصِّل، يوم)، والفرق يُخزَّن لا يُحسب عند العرض:
 * تقرير يُعيد الحساب في كل فتحة قد يُظهر رقماً غير الذي اتُّفق عليه.
 */
@Injectable()
export class SettlementsService {
  constructor(
    @Inject(PrismaService) private prisma: PrismaService,
    @Inject(NotificationsService) private notify: NotificationsService,
  ) {}

  /** بداية اليوم بتوقيت دمشق (UTC+3) مُعبَّراً عنها كتاريخ */
  private dayOf(d: Date): Date {
    const damascus = new Date(d.getTime() + 3 * 3_600_000);
    return new Date(Date.UTC(damascus.getUTCFullYear(), damascus.getUTCMonth(), damascus.getUTCDate()));
  }

  private async commissionRate(): Promise<number> {
    const row = await this.prisma.storeSetting.findUnique({ where: { key: 'courier_commission_bp' } });
    return typeof row?.value === 'number' ? row.value : 500;   // 5% افتراضاً
  }

  /**
   * تُستدعى داخل معاملة التحصيل: تربط الطلب بصف يوم محصِّله
   * وتزيد المجاميع ذرياً. الربط لحظة التحصيل لا في تقرير ليلي،
   * وإلا بقي طلبٌ يتيماً كلما تعطّلت المهمة المجدولة ليلة واحدة.
   */
  async attach(
    tx: Prisma.TransactionClient,
    args: {
      orderId: string; collectorId: string; collectorType: 'COURIER' | 'TRANSPORT_OFFICE';
      expectedSyp: bigint; collectedSyp: bigint; roundingDiffSyp: number; at: Date;
    },
  ) {
    const day = this.dayOf(args.at);
    const bp = await this.commissionRate();
    const commission = (args.collectedSyp * BigInt(bp)) / 10_000n;

    /* نقدٌ يصل بعد إقفال يومه يُعيد فتح ذلك اليوم.
       الإضافة الصامتة إلى صفٍّ مُقفَل أسوأ الاحتمالات: الدفتر يتغيّر
       بعد أن وُقِّع عليه، فلا الرقم القديم صحيح ولا الجديد مُراجَع.
       وإعادة الفتح تُظهر الأمر لمن أقفل بدل أن تخفيه عنه. */
    const existing = await tx.cashSettlement.findUnique({
      where: {
        collectorType_collectorId_settlementDate: {
          collectorType: args.collectorType, collectorId: args.collectorId, settlementDate: day,
        },
      },
    });
    const reopens = existing && existing.state !== 'OPEN';

    const row = await tx.cashSettlement.upsert({
      where: {
        collectorType_collectorId_settlementDate: {
          collectorType: args.collectorType, collectorId: args.collectorId, settlementDate: day,
        },
      },
      update: {
        ordersCount: { increment: 1 },
        expectedAmountSyp: { increment: args.expectedSyp },
        collectedAmountSyp: { increment: args.collectedSyp },
        varianceSyp: { increment: args.collectedSyp - args.expectedSyp },
        roundingDiffSyp: { increment: args.roundingDiffSyp },
        deliveryCommissionSyp: { increment: commission },
        ...(reopens
          ? {
              state: 'OPEN' as const,
              reconciledBy: null, reconciledAt: null, settledAt: null,
              note: `أُعيد فتحها: وصل تحصيل بعد إقفالها بحالة ${existing!.state}`,
            }
          : {}),
      },
      create: {
        collectorType: args.collectorType, collectorId: args.collectorId, settlementDate: day,
        ordersCount: 1,
        expectedAmountSyp: args.expectedSyp,
        collectedAmountSyp: args.collectedSyp,
        varianceSyp: args.collectedSyp - args.expectedSyp,
        roundingDiffSyp: args.roundingDiffSyp,
        deliveryCommissionSyp: commission,
      },
    });

    await tx.order.update({
      where: { id: args.orderId },
      data: { settlementId: row.id, collectorType: args.collectorType },
    });

    if (reopens) {
      await tx.auditLog.create({
        data: {
          action: 'settlement.reopen', entityType: 'cash_settlements', entityId: row.id,
          diff: { from: existing!.state, orderId: args.orderId, addedSyp: Number(args.collectedSyp) },
        },
      });
    }

    return row;
  }

  async list(state?: string, date?: string) {
    const rows = await this.prisma.cashSettlement.findMany({
      where: {
        ...(state ? { state: state as any } : {}),
        ...(date ? { settlementDate: new Date(date) } : {}),
      },
      orderBy: [{ settlementDate: 'desc' }, { createdAt: 'desc' }],
      take: 60,
      include: { collector: true },
    });
    return rows.map((r) => this.view(r));
  }

  private view(r: any) {
    return {
      id: r.id,
      date: r.settlementDate.toISOString().slice(0, 10),
      collectorType: r.collectorType,
      collector: r.collector ? { name: r.collector.fullName, phone: r.collector.phoneE164 } : null,
      ordersCount: r.ordersCount,
      expectedSyp: Number(r.expectedAmountSyp),
      collectedSyp: Number(r.collectedAmountSyp),
      varianceSyp: Number(r.varianceSyp),
      roundingDiffSyp: r.roundingDiffSyp,
      commissionSyp: Number(r.deliveryCommissionSyp),
      /// صافي ما يجب أن يصل صندوق المتجر
      netDueSyp: Number(r.collectedAmountSyp - r.deliveryCommissionSyp),
      state: r.state,
      note: r.note,
      reconciledAt: r.reconciledAt,
      settledAt: r.settledAt,
    };
  }

  async one(id: string) {
    const r = await this.prisma.cashSettlement.findUnique({
      where: { id }, include: { collector: true, orders: { include: { shippingAddress: true } } },
    });
    if (!r) throw Errors.notFound('التسوية');
    return {
      ...this.view(r),
      orders: r.orders.map((o) => ({
        orderNo: o.orderNo,
        dueSyp: Number(o.totalSyp),
        collectedSyp: Number(o.collectedAmountSyp ?? 0),
        paymentStatus: o.paymentStatus,
        customer: o.shippingAddress.recipientName,
        collectedAt: o.collectedAt,
      })),
    };
  }

  /**
   * المطابقة.
   *
   * الفرق المحاسَب عليه هو (ما قبضه المندوب − ما كان يجب أن يقبضه)، وكلاهما
   * بالليرة المقرَّبة التي طُبعت على الإيصال وقيلت للعميل. أما rounding_diff
   * فيقيس شيئاً آخر تماماً: الفجوة بين الإيراد بالدولار والنقد المقرَّب،
   * وهي فجوة قائمة حتى لو حصّل المندوب كل قرش. خصمها من فرقه يجعله مديناً
   * أو دائناً بمئات الليرات كل يوم لم تمرّ بيده أصلاً — فتُترك حيث تنفع:
   * بنداً محاسبياً في الصف، لا اتهاماً في ذمّة رجل.
   */
  /** الرمز يحمل publicId والجداول تخزّن UUID — الترجمة في مكان واحد */
  private async actorUuid(publicIdValue: string) {
    const u = await this.prisma.user.findUnique({ where: { publicId: publicIdValue } });
    if (!u) throw Errors.notFound('المستخدم');
    return u.id;
  }

  async reconcile(id: string, actorPublicId: string) {
    const actorId = await this.actorUuid(actorPublicId);
    const s = await this.prisma.cashSettlement.findUnique({ where: { id }, include: { collector: true } });
    if (!s) throw Errors.notFound('التسوية');
    if (s.state === 'SETTLED') {
      throw Errors.invalidTransition('SETTLED', 'RECONCILED');
    }
    // فصل الواجبات: من حصّل لا يُقفل تسويته (الفصل 9)
    if (s.collectorId === actorId) {
      throw Errors.badRequest('SEGREGATION_OF_DUTIES',
        'لا يجوز أن يطابق المحصِّل تسويته بنفسه',
        'Collector cannot reconcile own settlement');
    }

    const variance = Number(s.varianceSyp);
    const state = variance === 0 ? 'RECONCILED' : 'DISPUTED';

    const row = await this.prisma.cashSettlement.update({
      where: { id },
      data: {
        state,
        reconciledBy: actorId,
        reconciledAt: new Date(),
        note: variance === 0
          ? null
          : `${variance < 0 ? 'عجز' : 'فائض'} ${Math.abs(variance).toLocaleString('en-US')} ل.س`,
      },
      include: { collector: true },
    });

    await this.prisma.auditLog.create({
      data: {
        actorId, action: 'settlement.reconcile', entityType: 'cash_settlements', entityId: id,
        diff: { state, variance, roundingMemoSyp: s.roundingDiffSyp },
      },
    });

    if (state === 'DISPUTED') {
      await this.notify.send({
        type: 'settlement.disputed', level: 'P0', to: s.collector.phoneE164, entityId: id,
        title: 'فرق في التسوية',
        body: `تسوية ${row.settlementDate.toISOString().slice(0, 10)}: ${row.note} يحتاج توضيحاً خلال 72 ساعة.`,
      });
    }

    return this.view(row);
  }

  /** الإقفال: النقد وصل الصندوق فعلاً */
  async settle(id: string, actorPublicId: string) {
    const actorId = await this.actorUuid(actorPublicId);
    const s = await this.prisma.cashSettlement.findUnique({ where: { id } });
    if (!s) throw Errors.notFound('التسوية');
    if (s.state !== 'RECONCILED') {
      throw Errors.invalidTransition(s.state, 'SETTLED');
    }
    const row = await this.prisma.cashSettlement.update({
      where: { id }, data: { state: 'SETTLED', settledAt: new Date() },
      include: { collector: true },
    });
    await this.prisma.auditLog.create({
      data: {
        actorId, action: 'settlement.settle', entityType: 'cash_settlements', entityId: id,
        diff: { netDueSyp: Number(s.collectedAmountSyp - s.deliveryCommissionSyp) },
      },
    });
    return this.view(row);
  }

  /** تقرير التحصيل: ما يهمّ المالك في شاشة واحدة */
  async report(days = 7) {
    const since = new Date(Date.now() - days * 86_400_000);

    const [open, disputed, agg, stalePending] = await Promise.all([
      this.prisma.cashSettlement.count({ where: { state: 'OPEN' } }),
      this.prisma.cashSettlement.count({ where: { state: 'DISPUTED' } }),
      this.prisma.cashSettlement.aggregate({
        where: { settlementDate: { gte: since } },
        _sum: { collectedAmountSyp: true, expectedAmountSyp: true, deliveryCommissionSyp: true, varianceSyp: true },
        _count: true,
      }),
      // مسلَّم ولم يُحصَّل بعد 48 ساعة — إنذار لا تقرير
      this.prisma.order.count({
        where: {
          status: 'DELIVERED', paymentStatus: 'PENDING',
          deliveredAt: { lt: new Date(Date.now() - 48 * 3_600_000) },
        },
      }),
    ]);

    const partial = await this.prisma.order.count({ where: { paymentStatus: 'PARTIAL' } });
    const delivered = await this.prisma.order.count({
      where: { status: 'DELIVERED', deliveredAt: { gte: since } },
    });
    const failed = await this.prisma.order.count({
      where: { status: 'DELIVERY_FAILED', updatedAt: { gte: since } },
    });

    return {
      days,
      settlements: { open, disputed, total: agg._count },
      collectedSyp: Number(agg._sum.collectedAmountSyp ?? 0),
      expectedSyp: Number(agg._sum.expectedAmountSyp ?? 0),
      varianceSyp: Number(agg._sum.varianceSyp ?? 0),
      commissionSyp: Number(agg._sum.deliveryCommissionSyp ?? 0),
      netDueSyp: Number((agg._sum.collectedAmountSyp ?? 0n) - (agg._sum.deliveryCommissionSyp ?? 0n)),
      delivered, failed,
      partialOrders: partial,
      stalePendingPayments: stalePending,
    };
  }
}

@Controller('admin/settlements')
@Protect('OPS_MANAGER', 'ADMIN')
export class SettlementsController {
  constructor(@Inject(SettlementsService) private s: SettlementsService) {}

  @Get()
  async list(@Query('state') state?: string, @Query('date') date?: string) {
    return { data: await this.s.list(state, date) };
  }

  @Get('report')
  async report(@Query('days') days?: string) {
    return { data: await this.s.report(days ? Number(days) : 7) };
  }

  @Get(':id')
  async one(@Param('id') id: string) { return { data: await this.s.one(id) }; }

  @Post(':id/reconcile')
  async reconcile(@Param('id') id: string, @Req() req: { user?: { sub: string } }) {
    return { data: await this.s.reconcile(id, req.user!.sub) };
  }

  @Post(':id/settle')
  @Protect('ADMIN')
  async settle(@Param('id') id: string, @Req() req: { user?: { sub: string } }) {
    return { data: await this.s.settle(id, req.user!.sub) };
  }
}
