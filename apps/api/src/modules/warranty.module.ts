import { PrismaService } from '../common/prisma.service.js';
import { NotificationsService } from './notifications.service.js';
import { Errors } from '../common/errors.js';

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

export class WarrantyService {
  constructor(
    private prisma: PrismaService,
    private notify: NotificationsService,
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

  /**
   * فتح مطالبة كفالة.
   * الحالة كانت تُستنتج من آخر سطر في سجل التدقيق — وهذا خطأ بنيوي:
   * سجل التدقيق يقول «ماذا جرى» لا «أين نحن»، وقراءة الحاضر منه تعني
   * مسح آلاف السطور لمعرفة حالة مطالبة واحدة، وفقدانها لو نُظّف السجل.
   * الحالة الآن صفٌّ له جدوله، والسجل يبقى للتدقيق وحده.
   */
  async openClaim(imei: string, description: string, phone: string) {
    const unit = await this.prisma.deviceUnit.findUnique({ where: { imei } });
    if (!unit) throw Errors.notFound('الجهاز');
    if (!unit.warrantyEndAt || unit.warrantyEndAt.getTime() < Date.now()) {
      throw Errors.badRequest('WARRANTY_EXPIRED', 'انتهت كفالة هذا الجهاز', 'Warranty expired');
    }

    const open = await this.prisma.warrantyClaim.findFirst({
      where: { deviceUnitId: unit.id, state: { notIn: ['CLOSED', 'REJECTED'] } },
    });
    if (open) {
      throw Errors.badRequest('CLAIM_ALREADY_OPEN',
        `على هذا الجهاز مطالبة قائمة (${open.claimNo})`, 'Claim already open');
    }

    const now = new Date();
    const seq = (await this.prisma.warrantyClaim.count()) + 1;
    const claimNo = `WC-${String(now.getUTCFullYear()).slice(2)}${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(seq).padStart(6, '0')}`;

    const claim = await this.prisma.warrantyClaim.create({
      data: { claimNo, deviceUnitId: unit.id, imei, phone, description },
    });

    await this.notify.send({
      type: 'claim.opened', level: 'P1', to: phone, entityId: claimNo,
      title: 'استلمنا مطالبة الكفالة',
      body: `${claimNo} — سنتواصل معك لاستلام الجهاز خلال 48 ساعة.`,
    });
    return { claimNo, state: claim.state as ClaimState, stateAr: STATE_AR[claim.state as ClaimState] };
  }

  async transition(claimNo: string, to: ClaimState, b?: { diagnosis?: string; resolution?: string; rejectReason?: string }) {
    const claim = await this.prisma.warrantyClaim.findUnique({ where: { claimNo } });
    if (!claim) throw Errors.notFound('المطالبة');
    const from = claim.state as ClaimState;
    if (!NEXT[from].includes(to)) throw Errors.invalidTransition(from, to);
    if (to === 'REJECTED' && !b?.rejectReason) {
      throw Errors.badRequest('REJECT_REASON_REQUIRED',
        'الرفض يحتاج سبباً يُقال للعميل', 'Reject reason required');
    }

    const updated = await this.prisma.warrantyClaim.update({
      where: { id: claim.id },
      data: {
        state: to,
        diagnosis: b?.diagnosis ?? claim.diagnosis,
        resolution: b?.resolution ?? claim.resolution,
        rejectReason: b?.rejectReason ?? claim.rejectReason,
        ...(to === 'CLOSED' || to === 'REJECTED' ? { closedAt: new Date() } : {}),
      },
    });
    await this.prisma.auditLog.create({
      data: {
        action: 'claim.transition', entityType: 'warranty_claims', entityId: claim.id,
        diff: { claimNo, from, to },
      },
    });

    if (to === 'READY') {
      await this.notify.send({
        type: 'claim.ready', level: 'P1', to: claim.phone, entityId: claimNo,
        title: 'جهازك جاهز', body: `${claimNo} — يمكنك استلامه أو نرسله لك.`,
      });
    }
    if (to === 'REJECTED') {
      await this.notify.send({
        type: 'claim.rejected', level: 'P1', to: claim.phone, entityId: claimNo,
        title: 'نتيجة فحص المطالبة',
        body: `${claimNo} — ${b!.rejectReason}. تواصل مع الدعم لأي استفسار.`,
      });
    }
    return { claimNo, state: updated.state as ClaimState, stateAr: STATE_AR[to], from };
  }

  async listClaims(state?: string) {
    const rows = await this.prisma.warrantyClaim.findMany({
      where: state ? { state: state as any } : {},
      orderBy: { openedAt: 'desc' }, take: 100,
    });
    return rows.map((c) => ({
      claimNo: c.claimNo, imei: c.imei, phone: c.phone,
      description: c.description, diagnosis: c.diagnosis,
      state: c.state, stateAr: STATE_AR[c.state as ClaimState],
      openedAt: c.openedAt, closedAt: c.closedAt,
      at: c.openedAt.toISOString(),
    }));
  }

  /** رقم صاحب الحساب — المصدر الوحيد للهوية في مسارات `me` */
  private async phoneOf(publicId: string): Promise<string> {
    const u = await this.prisma.user.findUnique({
      where: { publicId }, select: { phoneE164: true },
    });
    if (!u) throw Errors.notFound('الحساب');
    return u.phoneE164;
  }

  /** مطالباتي — الرقم من الرمز لا من الطلب */
  async myClaimsFor(publicId: string) {
    return this.myClaims(await this.phoneOf(publicId));
  }

  /** فتح مطالبة باسم صاحب الحساب نفسه */
  async openClaimFor(publicId: string, imei: string, description: string) {
    return this.openClaim(imei, description, await this.phoneOf(publicId));
  }

  /** مطالباتي — بالرقم الذي فُتحت به */
  async myClaims(phone: string) {
    const rows = await this.prisma.warrantyClaim.findMany({
      where: { phone }, orderBy: { openedAt: 'desc' }, take: 30,
    });
    return rows.map((c) => ({
      claimNo: c.claimNo, state: c.state, stateAr: STATE_AR[c.state as ClaimState],
      description: c.description, openedAt: c.openedAt,
    }));
  }
}

