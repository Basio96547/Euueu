import { Body, Controller, Get, Inject, Injectable, Param, Post, Query } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service.js';
import { NotificationsService } from './notifications.service.js';
import { Errors } from '../common/errors.js';
import { Protect } from '../common/guards.js';

type ClaimState = 'OPENED' | 'RECEIVED' | 'DIAGNOSING' | 'DECISION' | 'IN_REPAIR' | 'TESTING' | 'READY' | 'CLOSED' | 'REJECTED';

const NEXT: Record<ClaimState, ClaimState[]> = {
  OPENED: ['RECEIVED', 'REJECTED'],
  RECEIVED: ['DIAGNOSING'],
  DIAGNOSING: ['DECISION'],
  DECISION: ['IN_REPAIR', 'REJECTED'],
  IN_REPAIR: ['TESTING'],
  TESTING: ['READY', 'IN_REPAIR'],
  READY: ['CLOSED'],
  CLOSED: [],
  REJECTED: [],
};

const STATE_AR: Record<ClaimState, string> = {
  OPENED: 'مفتوحة', RECEIVED: 'استُلم الجهاز', DIAGNOSING: 'قيد التشخيص',
  DECISION: 'صدر القرار', IN_REPAIR: 'قيد الإصلاح', TESTING: 'قيد الفحص',
  READY: 'جاهز للتسليم', CLOSED: 'مغلقة', REJECTED: 'مرفوضة',
};

@Injectable()
export class WarrantyService {
  constructor(
    @Inject(PrismaService) private prisma: PrismaService,
    @Inject(NotificationsService) private notify: NotificationsService,
  ) {}

  /**
   * تُفعَّل الكفالة عند التسليم لا عند إنشاء الطلب (الفصل 15):
   * جهاز لم يصل بعدُ لا كفالة له.
   */
  async activateForOrder(orderNo: string) {
    const order = await this.prisma.order.findUnique({
      where: { orderNo },
      include: { items: { include: { variant: true, unit: true } } },
    });
    if (!order) throw Errors.notFound('الطلب');
    if (order.status !== 'DELIVERED') {
      throw Errors.invalidTransition(order.status, 'WARRANTY_ACTIVE');
    }

    const start = order.collectedAt ?? new Date();
    let activated = 0;
    for (const item of order.items) {
      if (!item.unit) continue;
      const months = item.variant.warrantyMonths;
      if (months <= 0) continue;
      const end = new Date(start);
      end.setMonth(end.getMonth() + months);

      /* الوحدة خرجت من المخزون لحظة التسليم وقُيّد بيعها هناك (وحدة المندوب).
         التفعيل هنا يضع تواريخ الكفالة فقط — ولو حرّك المخزون ثانيةً
         لخُصم الجهاز مرتين وانحرف الدفتر عن الرفّ. */
      const unit = item.unit;
      await this.prisma.deviceUnit.update({
        where: { id: unit.id },
        data: {
          warrantyType: item.variant.warrantyType,
          warrantyStartAt: start,
          warrantyEndAt: end,
        },
      });
      activated++;
    }
    return { orderNo, activated, startAt: start.toISOString() };
  }

  /**
   * تحقق عام بالـ IMEI: يرد بحالة الكفالة فقط بلا أي بيانات شخصية.
   * قناة اكتساب من سوق إعادة البيع، وحد المعدل في الفصل 9.
   */
  async verify(imei: string) {
    const unit = await this.prisma.deviceUnit.findUnique({
      where: { imei },
      include: { variant: { include: { product: true } } },
    });
    if (!unit || !unit.warrantyEndAt) return { status: 'NOT_FOUND' as const };
    const active = unit.warrantyEndAt.getTime() > Date.now();
    return {
      status: active ? ('ACTIVE' as const) : ('EXPIRED' as const),
      product: (unit.variant.product.name as any).ar,
      warrantyType: unit.warrantyType,
      startAt: unit.warrantyStartAt?.toISOString() ?? null,
      endAt: unit.warrantyEndAt.toISOString(),
      daysLeft: active ? Math.ceil((unit.warrantyEndAt.getTime() - Date.now()) / 86_400_000) : 0,
    };
  }

  async openClaim(imei: string, description: string, phone: string) {
    const unit = await this.prisma.deviceUnit.findUnique({ where: { imei } });
    if (!unit) throw Errors.notFound('الجهاز');
    if (!unit.warrantyEndAt || unit.warrantyEndAt.getTime() < Date.now()) {
      throw Errors.badRequest('WARRANTY_EXPIRED', 'انتهت كفالة هذا الجهاز', 'Warranty expired');
    }

    const seq = (await this.prisma.auditLog.count({ where: { entityType: 'warranty_claims' } })) + 1;
    const now = new Date();
    const claimNo = `WC-${String(now.getUTCFullYear()).slice(2)}${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(seq).padStart(6, '0')}`;

    await this.prisma.auditLog.create({
      data: {
        action: 'claim.open', entityType: 'warranty_claims', entityId: unit.id,
        diff: { claimNo, imei, description, phone, state: 'OPENED' as ClaimState },
      },
    });

    await this.notify.send({
      type: 'claim.opened', level: 'P1', to: phone, entityId: claimNo,
      title: 'استلمنا مطالبة الكفالة',
      body: `${claimNo} — سنتواصل معك لاستلام الجهاز خلال 48 ساعة.`,
    });
    return { claimNo, state: 'OPENED' as ClaimState, stateAr: STATE_AR.OPENED };
  }

  async transition(claimNo: string, to: ClaimState) {
    const rows = await this.prisma.auditLog.findMany({
      where: { entityType: 'warranty_claims' }, orderBy: { createdAt: 'desc' },
    });
    const last = rows.find((r) => (r.diff as any)?.claimNo === claimNo);
    if (!last) throw Errors.notFound('المطالبة');
    const from = (last.diff as any).state as ClaimState;
    if (!NEXT[from].includes(to)) throw Errors.invalidTransition(from, to);

    await this.prisma.auditLog.create({
      data: {
        action: 'claim.transition', entityType: 'warranty_claims', entityId: last.entityId,
        diff: { ...(last.diff as any), state: to, from },
      },
    });
    if (to === 'READY') {
      await this.notify.send({
        type: 'claim.ready', level: 'P1', to: (last.diff as any).phone, entityId: claimNo,
        title: 'جهازك جاهز', body: `${claimNo} — يمكنك استلامه أو نرسله لك.`,
      });
    }
    return { claimNo, state: to, stateAr: STATE_AR[to], from };
  }

  async listClaims() {
    const rows = await this.prisma.auditLog.findMany({
      where: { entityType: 'warranty_claims' }, orderBy: { createdAt: 'desc' }, take: 100,
    });
    const latest = new Map<string, any>();
    for (const r of rows) {
      const d = r.diff as any;
      if (d?.claimNo && !latest.has(d.claimNo)) {
        latest.set(d.claimNo, { claimNo: d.claimNo, imei: d.imei, state: d.state, stateAr: STATE_AR[d.state as ClaimState], at: r.createdAt.toISOString() });
      }
    }
    return [...latest.values()];
  }
}

@Controller()
export class WarrantyController {
  constructor(@Inject(WarrantyService) private w: WarrantyService) {}

  @Get('warranties/verify')
  async verify(@Query('imei') imei: string) {
    if (!imei) throw Errors.badRequest('IMEI_REQUIRED', 'أدخل رقم IMEI', 'IMEI required');
    return { data: await this.w.verify(imei) };
  }

  @Post('warranties/activate/:orderNo')
  async activate(@Param('orderNo') no: string) { return { data: await this.w.activateForOrder(no) }; }

  @Post('me/warranty-claims')
  async open(@Body() b: { imei: string; description: string; phone: string }) {
    return { data: await this.w.openClaim(b.imei, b.description, b.phone) };
  }

  @Get('admin/warranty-claims')
  @Protect('SUPPORT', 'OPS_MANAGER', 'ADMIN')
  async list() { return { data: await this.w.listClaims() }; }

  @Post('admin/warranty-claims/:claimNo/transition')
  @Protect('SUPPORT', 'OPS_MANAGER', 'ADMIN')
  async transition(@Param('claimNo') no: string, @Body() b: { to: ClaimState }) {
    return { data: await this.w.transition(no, b.to) };
  }
}
