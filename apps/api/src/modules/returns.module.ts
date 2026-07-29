import { Body, Controller, Get, Inject, Injectable, Param, Post, Query, Req } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service.js';
import { FxService } from './fx.module.js';
import { NotificationsService } from './notifications.service.js';
import { Errors } from '../common/errors.js';
import { roundCash } from '../common/money.js';
import { MaybeAuth, Protect } from '../common/guards.js';

/** نافذة الإرجاع سبعة أيام من التسليم — الفصل 8 §8.10 */
const WINDOW_DAYS = 7;

const STATE_AR: Record<string, string> = {
  REQUESTED: 'طلب إرجاع جديد',
  APPROVED: 'موافَق عليه',
  REJECTED: 'مرفوض',
  PICKUP_SCHEDULED: 'مجدول للاستلام',
  RECEIVED: 'وصل المتجر',
  INSPECTED: 'جرى فحصه',
  COMPLETED: 'اكتمل والمبلغ صُرف',
  CANCELLED: 'ألغاه العميل',
};

const REASON_AR: Record<string, string> = {
  NOT_AS_DESCRIBED: 'غير مطابق للوصف',
  DEFECTIVE: 'عيب في الجهاز',
  WRONG_ITEM: 'صنف خاطئ',
  CHANGED_MIND: 'عدول عن الشراء',
  DAMAGED_IN_TRANSIT: 'تضرَّر أثناء الشحن',
};

/** الانتقالات المسموحة — كل ما عداها مرفوض بـ 409 */
const NEXT: Record<string, string[]> = {
  REQUESTED: ['APPROVED', 'REJECTED', 'CANCELLED'],
  APPROVED: ['PICKUP_SCHEDULED', 'CANCELLED'],
  PICKUP_SCHEDULED: ['RECEIVED', 'CANCELLED'],
  RECEIVED: ['INSPECTED'],
  INSPECTED: ['COMPLETED', 'REJECTED'],
  COMPLETED: [],
  REJECTED: [],
  CANCELLED: [],
};

@Injectable()
export class ReturnsService {
  constructor(
    @Inject(PrismaService) private prisma: PrismaService,
    @Inject(FxService) private fx: FxService,
    @Inject(NotificationsService) private notify: NotificationsService,
  ) {}

  private async nextNo() {
    const now = new Date();
    const seq = (await this.prisma.return.count()) + 1;
    const yy = String(now.getUTCFullYear()).slice(2);
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    return `RT-${yy}${mm}-${String(seq).padStart(6, '0')}`;
  }

  /**
   * فتح طلب إرجاع.
   * النافذة تُحسب من التسليم لا من الطلب: بين الاثنين أيام شحن
   * لا ذنب للعميل فيها، وحسابها من الطلب يأكل نصف حقّه.
   */
  async request(args: {
    orderNo: string; reason: string; note?: string; imei?: string;
    phoneTail?: string; userPublicId?: string;
  }) {
    const order = await this.prisma.order.findUnique({
      where: { orderNo: args.orderNo },
      include: { shippingAddress: true, items: true, user: true },
    });
    if (!order) throw Errors.notFound('الطلب');

    // إثبات الملكية: صاحب الحساب، أو آخر أربعة أرقام من جوال العنوان
    const owns = args.userPublicId
      ? order.user?.publicId === args.userPublicId
      : Boolean(args.phoneTail) && order.shippingAddress.phone.endsWith(args.phoneTail!);
    if (!owns) {
      throw Errors.badRequest('NOT_YOUR_ORDER',
        'تعذّر إثبات ملكيتك لهذا الطلب', 'Ownership check failed');
    }

    if (order.status !== 'DELIVERED') {
      throw Errors.badRequest('NOT_DELIVERED',
        'لا يُرجَع إلا طلب مسلَّم', 'Only delivered orders can be returned');
    }

    const delivered = order.deliveredAt ?? order.collectedAt;
    if (!delivered) {
      throw Errors.badRequest('NO_DELIVERY_DATE',
        'لا تاريخ تسليم مسجَّل لهذا الطلب — راجع الدعم', 'Missing delivery date');
    }
    const daysSince = (Date.now() - delivered.getTime()) / 86_400_000;
    if (daysSince > WINDOW_DAYS) {
      throw Errors.badRequest('RETURN_WINDOW_CLOSED',
        `انتهت مهلة الإرجاع (${WINDOW_DAYS} أيام من التسليم) — مضى ${Math.floor(daysSince)} يوماً. الكفالة ما زالت سارية.`,
        'Return window closed');
    }

    const open = await this.prisma.return.findFirst({
      where: { orderId: order.id, state: { notIn: ['REJECTED', 'CANCELLED', 'COMPLETED'] } },
    });
    if (open) {
      throw Errors.badRequest('RETURN_ALREADY_OPEN',
        `على هذا الطلب طلب إرجاع قائم (${open.returnNo})`, 'Return already open');
    }

    const row = await this.prisma.return.create({
      data: {
        returnNo: await this.nextNo(),
        orderId: order.id,
        orderItemId: order.items[0]?.id,
        reason: args.reason as any,
        customerNote: args.note,
        imeiSubmitted: args.imei,
      },
    });

    await this.notify.send({
      type: 'return.requested', level: 'P1', to: order.shippingAddress.phone, entityId: row.returnNo,
      title: 'استلمنا طلب الإرجاع',
      body: `${row.returnNo} — سنراجعه ونعلمك خلال يوم عمل. أبقِ العلبة والملحقات كاملة.`,
    });

    return this.view(row, order);
  }

  private view(r: any, order?: any) {
    return {
      returnNo: r.returnNo,
      state: r.state,
      stateAr: STATE_AR[r.state] ?? r.state,
      reason: r.reason,
      reasonAr: REASON_AR[r.reason] ?? r.reason,
      customerNote: r.customerNote,
      imeiChecked: r.imeiChecked,
      imeiMatched: r.imeiMatched,
      inspectionNote: r.inspectionNote,
      rejectReason: r.rejectReason,
      requestedAt: r.requestedAt,
      completedAt: r.completedAt,
      ...(order ? { orderNo: order.orderNo, customer: order.shippingAddress?.recipientName } : {}),
    };
  }

  async byNo(returnNo: string) {
    const r = await this.prisma.return.findUnique({
      where: { returnNo },
      include: { order: { include: { shippingAddress: true } }, refund: true },
    });
    if (!r) throw Errors.notFound('طلب الإرجاع');
    return {
      ...this.view(r, r.order),
      refund: r.refund && {
        amountUsdCents: Number(r.refund.amountUsdCents),
        amountSyp: Number(r.refund.amountSyp),
        state: r.refund.state,
        disbursedAt: r.refund.disbursedAt,
      },
    };
  }

  async list(state?: string) {
    const rows = await this.prisma.return.findMany({
      where: state ? { state: state as any } : {},
      orderBy: { requestedAt: 'desc' }, take: 60,
      include: { order: { include: { shippingAddress: true } }, refund: true },
    });
    return rows.map((r) => ({
      ...this.view(r, r.order),
      dueSyp: Number(r.order.totalSyp),
      refundState: r.refund?.state ?? null,
    }));
  }

  /**
   * نقل الحالة.
   *
   * الفحص عند `INSPECTED` هو الحارس الحقيقي: مطابقة IMEI شرط لا مجاملة،
   * فجهازٌ غير الذي بِيع قد يكون مسروقاً أو معطوباً أصلاً، وقبولُه يعني
   * أن المتجر اشترى مشكلة شخص آخر نقداً.
   */
  async transition(returnNo: string, to: string, actorPublicId: string, b: {
    note?: string; rejectReason?: string; imei?: string; restock?: boolean;
  }) {
    const r = await this.prisma.return.findUnique({
      where: { returnNo },
      include: { order: { include: { shippingAddress: true, items: { include: { unit: true, variant: true } } } } },
    });
    if (!r) throw Errors.notFound('طلب الإرجاع');
    if (!(NEXT[r.state] ?? []).includes(to)) throw Errors.invalidTransition(r.state, to);

    const actor = await this.prisma.user.findUnique({ where: { publicId: actorPublicId } });
    const now = new Date();
    const data: any = { state: to, decidedBy: actor?.id, decidedAt: now };

    if (to === 'REJECTED') {
      if (!b.rejectReason) {
        throw Errors.badRequest('REJECT_REASON_REQUIRED',
          'الرفض يحتاج سبباً يُقال للعميل', 'Reject reason required');
      }
      data.rejectReason = b.rejectReason;
    }

    if (to === 'RECEIVED') data.receivedAt = now;

    if (to === 'INSPECTED') {
      const sold = r.order.items.find((i) => i.unit)?.unit;
      // متغيّر مسلسل: المطابقة إلزامية. ملحق بلا IMEI: تُتخطّى بلا ادّعاء فحص
      if (sold?.imei) {
        const given = (b.imei ?? r.imeiSubmitted ?? '').trim();
        const matched = given === sold.imei;
        data.imeiChecked = true;
        data.imeiMatched = matched;
        if (!matched) {
          data.state = 'REJECTED';
          data.rejectReason = 'IMEI_MISMATCH';
          const row = await this.prisma.return.update({ where: { id: r.id }, data });
          await this.notify.send({
            type: 'return.rejected', level: 'P1', to: r.order.shippingAddress.phone, entityId: returnNo,
            title: 'تعذّر قبول الإرجاع',
            body: `${returnNo} — رقم الجهاز المُعاد لا يطابق الجهاز المُباع. راجع الدعم.`,
          });
          throw Errors.badRequest('IMEI_MISMATCH',
            'رقم الجهاز المُعاد لا يطابق الجهاز المُباع — رُفض الإرجاع',
            'Returned IMEI does not match the sold unit', { returnNo: row.returnNo });
        }
      }
      data.inspectionNote = b.note;
      data.restock = b.restock ?? true;
    }

    if (to === 'COMPLETED') {
      if (!r.imeiChecked && r.order.items.some((i) => i.unit?.imei)) {
        throw Errors.badRequest('INSPECTION_REQUIRED',
          'لا يُصرف مبلغ قبل الفحص ومطابقة IMEI', 'Inspection required before refund');
      }
      data.completedAt = now;
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.return.update({ where: { id: r.id }, data });

      // إعادة البضاعة إلى الرفّ عند الاكتمال، وبالوحدة نفسها إن كانت مسلسلة
      if (to === 'COMPLETED' && row.restock) {
        for (const item of r.order.items) {
          const level = await tx.inventoryLevel.findFirst({ where: { variantId: item.variantId } });
          if (!level) continue;
          if (item.unit) {
            await tx.deviceUnit.update({
              where: { id: item.unit.id },
              data: { state: 'IN_STOCK', orderItemId: null },
            });
          }
          await tx.inventoryLevel.updateMany({
            where: { variantId: item.variantId, warehouseId: level.warehouseId },
            data: { onHand: { increment: item.qty }, version: { increment: 1 } },
          });
          await tx.inventoryMovement.create({
            data: {
              variantId: item.variantId, warehouseId: level.warehouseId,
              reason: 'RETURN', qtyDelta: item.qty,
              refType: 'return', refId: row.id, note: returnNo,
            },
          });
        }

        await tx.order.update({
          where: { id: r.orderId },
          data: { status: 'RETURNED', paymentStatus: 'REFUNDED' },
        });
        await tx.orderStatusHistory.create({
          data: {
            orderId: r.orderId, fromStatus: 'DELIVERED', toStatus: 'RETURNED',
            actorType: 'STAFF', source: 'ADMIN', reasonCode: returnNo,
          },
        });

        /* الاسترداد بالدولار مرجعاً وبالليرة مقرَّبة لأقرب ألف:
           العميل دفع مبلغاً مقرَّباً، فيُعاد إليه بالتقريب نفسه لا بالخام. */
        const fx = await this.fx.current();
        const usd = Number(r.order.totalUsdCents);
        const raw = Math.round((usd * fx.rate) / 100);
        const syp = roundCash(raw);
        await tx.refund.create({
          data: {
            returnId: row.id,
            amountUsdCents: BigInt(usd),
            fxRate: fx.rate,
            amountSyp: BigInt(syp),
            roundingDiffSyp: syp - raw,
            state: 'APPROVED',
          },
        });
      }
      return row;
    });

    if (to !== 'REJECTED') {
      await this.notify.send({
        type: `return.${to.toLowerCase()}`, level: 'P1',
        to: r.order.shippingAddress.phone, entityId: returnNo,
        title: STATE_AR[to] ?? to,
        body: to === 'COMPLETED'
          ? `${returnNo} — اكتمل الإرجاع، والمبلغ جاهز للصرف نقداً.`
          : `${returnNo} — ${STATE_AR[to] ?? to}.`,
      });
    }

    return this.view(updated, r.order);
  }

  /** صرف النقد: آخر خطوة، ولا رجعة فيها */
  async disburse(returnNo: string, actorPublicId: string, note?: string) {
    const r = await this.prisma.return.findUnique({ where: { returnNo }, include: { refund: true, order: { include: { shippingAddress: true } } } });
    if (!r?.refund) throw Errors.notFound('الاسترداد');
    if (r.refund.state === 'DISBURSED') {
      throw Errors.invalidTransition('DISBURSED', 'DISBURSED');
    }
    if (r.state !== 'COMPLETED') {
      throw Errors.badRequest('RETURN_NOT_COMPLETED',
        'لا يُصرف مبلغ قبل اكتمال الإرجاع', 'Return not completed');
    }
    const actor = await this.prisma.user.findUnique({ where: { publicId: actorPublicId } });
    const row = await this.prisma.refund.update({
      where: { id: r.refund.id },
      data: { state: 'DISBURSED', disbursedBy: actor?.id, disbursedAt: new Date(), note },
    });
    await this.prisma.auditLog.create({
      data: {
        actorId: actor?.id, action: 'refund.disburse', entityType: 'refunds', entityId: row.id,
        diff: { returnNo, amountSyp: Number(row.amountSyp) },
      },
    });
    await this.notify.send({
      type: 'refund.disbursed', level: 'P1', to: r.order.shippingAddress.phone, entityId: returnNo,
      title: 'صُرف مبلغ الإرجاع',
      body: `${returnNo} — ${Number(row.amountSyp).toLocaleString('en-US')} ل.س. شكراً لتعاملك معنا.`,
    });
    return { returnNo, state: row.state, amountSyp: Number(row.amountSyp) };
  }
}

@Controller()
export class ReturnsController {
  constructor(@Inject(ReturnsService) private r: ReturnsService) {}

  /** فتح إرجاع: يعمل للضيف بآخر أربعة أرقام وللداخل بهويته */
  @Post('returns')
  @MaybeAuth()
  async request(
    @Body() b: { orderNo: string; reason: string; note?: string; imei?: string; phoneTail?: string },
    @Req() req: { user?: { sub: string } },
  ) {
    return { data: await this.r.request({ ...b, userPublicId: req.user?.sub }) };
  }

  @Get('returns/:returnNo')
  async one(@Param('returnNo') n: string) { return { data: await this.r.byNo(n) }; }

  @Get('admin/returns')
  @Protect('SUPPORT', 'OPS_MANAGER', 'ADMIN')
  async list(@Query('state') state?: string) { return { data: await this.r.list(state) }; }

  @Post('admin/returns/:returnNo/transition')
  @Protect('SUPPORT', 'OPS_MANAGER', 'ADMIN')
  async transition(
    @Param('returnNo') n: string,
    @Body() b: { to: string; note?: string; rejectReason?: string; imei?: string; restock?: boolean },
    @Req() req: { user?: { sub: string } },
  ) {
    return { data: await this.r.transition(n, b.to, req.user!.sub, b) };
  }

  // الصرف النقدي للمدير وحده: يد واحدة تُخرج المال ويد أخرى تراجعها
  @Post('admin/returns/:returnNo/disburse')
  @Protect('ADMIN')
  async disburse(
    @Param('returnNo') n: string,
    @Body() b: { note?: string },
    @Req() req: { user?: { sub: string } },
  ) {
    return { data: await this.r.disburse(n, req.user!.sub, b.note) };
  }
}
