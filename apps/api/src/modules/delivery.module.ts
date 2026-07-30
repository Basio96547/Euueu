import { PrismaService } from '../common/prisma.service.js';
import { NotificationsService } from './notifications.service.js';
import { Errors } from '../common/errors.js';
import { strList } from '../common/json-list.js';
import { normalizeAr } from '../common/arabic.js';


/** سعة افتراضية بحسب المركبة — الدراجة هي الغالبة داخل دمشق */
const CAPACITY: Record<string, number> = {
  MOTORCYCLE: 18, CAR: 28, VAN: 35, ON_FOOT: 10,
};

const STATUS_AR: Record<string, string> = {
  AVAILABLE: 'متاح', ON_ROUTE: 'في جولة', OFF_DUTY: 'خارج الوردية', SUSPENDED: 'موقوف',
};

const ZONE_DEFAULTS: Record<string, { surcharge: number; sla: number }> = {
  URBAN_CORE: { surcharge: 0, sla: 24 },
  URBAN_OUTER: { surcharge: 50, sla: 36 },
  SUBURBAN: { surcharge: 100, sla: 48 },
  REMOTE: { surcharge: 200, sla: 72 },
};

/**
 * إدارة التوصيل — الفصل 17
 *
 * التوصيل هنا مركز الكلفة والمخاطرة: كل ليرة إيراد تمرّ بيد مندوب،
 * وكل عنوان غامض محاولةٌ فاشلة بشحن ذهاب وإياب على حساب المتجر.
 * هذه الوحدة تحوّله من اجتهاد يومي إلى عملية بمعطيات: من يوصّل،
 * وإلى أي منطقة، وبأي سعة، وكم نقداً يحمل.
 */
export class DeliveryService {
  constructor(
    private prisma: PrismaService,
    private notify: NotificationsService,
  ) {}

  /* ————— المندوبون ————— */

  async couriers(status?: string) {
    const rows = await this.prisma.courier.findMany({
      where: status ? { status: status as any } : {},
      orderBy: [{ active: 'desc' }, { code: 'asc' }],
      include: { zones: { include: { zone: true } } },
    });

    // عدد مهام اليوم لكل مندوب: السعة بلا عدّاد رقمٌ على ورق
    const today = new Date(); today.setUTCHours(0, 0, 0, 0);
    const loads = await this.prisma.order.groupBy({
      by: ['collectedBy'],
      where: { deliveredAt: { gte: today } },
      _count: true,
    });
    const byId = new Map(loads.map((l) => [l.collectedBy, l._count]));

    return rows.map((c) => ({
      code: c.code, fullName: c.fullName, phone: c.phone,
      status: c.status, statusAr: STATUS_AR[c.status] ?? c.status,
      suspensionReason: c.suspensionReason,
      vehicleType: c.vehicleType, vehiclePlate: c.vehiclePlate,
      employmentType: c.employmentType,
      homeGovernorate: c.homeGovernorate,
      dailyCapacity: c.dailyCapacity,
      deliveredToday: byId.get(c.id) ?? 0,
      cashCapUsdCents: Number(c.cashCapUsdCents),
      depositUsdCents: Number(c.depositUsdCents),
      guarantorName: c.guarantorName, guarantorPhone: c.guarantorPhone,
      ratingAvg: c.ratingAvg ? Number(c.ratingAvg) : null,
      active: c.active,
      zones: c.zones.map((z) => ({ code: z.zone.code, name: z.zone.name, priority: z.priority })),
    }));
  }

  /**
   * إنشاء مندوب أو تعديله.
   * يُربط بحساب مستخدم بدور COURIER: السجل التشغيلي شيء والدخول شيء،
   * لكن بلا حساب لا يستطيع فتح تطبيقه ولا تسجيل تحصيل.
   */
  async upsertCourier(b: any, actorPublicId: string) {
    if (!/^[A-Z]{2,4}-[0-9]{1,3}$/.test(b.code ?? '')) {
      throw Errors.badRequest('COURIER_CODE_INVALID',
        'الرمز بصيغة DMS-04 — حروف لاتينية كبيرة ثم شرطة ثم رقم', 'Invalid courier code');
    }
    if (!/^\+9639[0-9]{8}$/.test(b.phone ?? '')) {
      throw Errors.badRequest('PHONE_INVALID', 'رقم الجوال بصيغة +9639XXXXXXXX', 'Invalid phone');
    }
    if (!b.fullName?.trim()) {
      throw Errors.badRequest('NAME_REQUIRED', 'الاسم الثلاثي إلزامي', 'Full name required');
    }

    /* حساب الدخول يُنشأ أو يُرقّى هنا: مندوبٌ بلا حساب سجلٌّ في جدول
       لا يستطيع صاحبه فتح تطبيقه — وهو ما يُكتشف يوم أول جولة. */
    const user = await this.prisma.user.upsert({
      where: { phoneE164: b.phone },
      update: { role: 'COURIER', fullName: b.fullName },
      create: {
        publicId: (await import('../common/money.js')).publicId(),
        phoneE164: b.phone, role: 'COURIER', fullName: b.fullName,
      },
    });

    const existing = await this.prisma.courier.findUnique({ where: { code: b.code } });
    const vehicle = b.vehicleType ?? 'MOTORCYCLE';

    const data = {
      userId: user.id,
      fullName: b.fullName.trim(),
      phone: b.phone,
      employmentType: (b.employmentType ?? 'CONTRACTOR') as any,
      vehicleType: vehicle as any,
      vehiclePlate: b.vehiclePlate ?? null,
      homeGovernorate: (b.homeGovernorate ?? 'DAMASCUS') as any,
      dailyCapacity: Number(b.dailyCapacity) || CAPACITY[vehicle] || 18,
      cashCapUsdCents: BigInt(b.cashCapUsdCents ?? 200000),
      guarantorName: b.guarantorName ?? null,
      guarantorPhone: b.guarantorPhone ?? null,
      depositUsdCents: BigInt(b.depositUsdCents ?? 0),
      active: b.active ?? true,
    };

    const c = existing
      ? await this.prisma.courier.update({ where: { id: existing.id }, data })
      : await this.prisma.courier.create({ data: { ...data, code: b.code } });

    const actor = await this.prisma.user.findUnique({ where: { publicId: actorPublicId } });
    await this.prisma.auditLog.create({
      data: {
        actorId: actor?.id, action: existing ? 'courier.update' : 'courier.create',
        entityType: 'couriers', entityId: c.id, diff: { code: c.code, phone: c.phone },
      },
    });

    return { code: c.code, created: !existing, userPublicId: user.publicId };
  }

  /**
   * تغيير حالة المندوب.
   * الإيقاف يحتاج سبباً مكتوباً: «موقوف» بلا سبب تُنسى بعد أسبوع
   * فلا أحد يعرف أيُرفع الإيقاف أم لا.
   */
  async setCourierStatus(code: string, status: string, reason: string | undefined, actorPublicId: string) {
    if (!STATUS_AR[status]) {
      throw Errors.badRequest('STATUS_INVALID', `الحالة من: ${Object.keys(STATUS_AR).join('، ')}`, 'Invalid status');
    }
    if (status === 'SUSPENDED' && !reason?.trim()) {
      throw Errors.badRequest('SUSPENSION_REASON_REQUIRED',
        'الإيقاف يحتاج سبباً مكتوباً', 'Suspension reason required');
    }
    const c = await this.prisma.courier.findUnique({ where: { code } });
    if (!c) throw Errors.notFound('المندوب');

    const updated = await this.prisma.courier.update({
      where: { id: c.id },
      data: { status: status as any, suspensionReason: status === 'SUSPENDED' ? reason : null },
    });

    const actor = await this.prisma.user.findUnique({ where: { publicId: actorPublicId } });
    await this.prisma.auditLog.create({
      data: {
        actorId: actor?.id, action: 'courier.status', entityType: 'couriers', entityId: c.id,
        diff: { code, from: c.status, to: status, reason: reason ?? null },
      },
    });

    if (status === 'SUSPENDED') {
      await this.notify.send({
        type: 'courier.suspended', level: 'P1', to: c.phone, entityId: code,
        title: 'أُوقف حسابك التشغيلي',
        body: `${reason} — راجع مدير العمليات. مستحقاتك محفوظة ويمكنك الاطلاع عليها.`,
      });
    }
    return { code, status: updated.status, statusAr: STATUS_AR[updated.status] };
  }

  /* ————— المناطق ————— */

  async zones(governorate?: string) {
    const rows = await this.prisma.deliveryZone.findMany({
      where: governorate ? { governorate: governorate as any } : {},
      orderBy: [{ governorate: 'asc' }, { code: 'asc' }],
      include: { defaultCourier: true, couriers: { include: { courier: true } } },
    });
    return rows.map((z) => ({
      code: z.code, name: z.name,
      governorate: z.governorate, city: z.city,
      neighborhoods: strList(z.neighborhoods),
      zoneType: z.zoneType,
      surchargeUsdCents: z.surchargeUsdCents,
      slaHours: z.slaHours,
      codMaxUsdCents: z.codMaxUsdCents ? Number(z.codMaxUsdCents) : null,
      defaultCourier: z.defaultCourier?.code ?? null,
      couriers: z.couriers
        .sort((a, b) => a.priority - b.priority)
        .map((c) => ({ code: c.courier.code, name: c.courier.fullName, priority: c.priority })),
      active: z.active,
    }));
  }

  async upsertZone(b: any, actorPublicId: string) {
    if (!/^[A-Z]{2,4}-[A-Z0-9]{1,6}$/.test(b.code ?? '')) {
      throw Errors.badRequest('ZONE_CODE_INVALID',
        'الرمز بصيغة DMS-C1', 'Invalid zone code');
    }
    if (!b.name?.ar?.trim()) {
      throw Errors.badRequest('NAME_REQUIRED', 'اسم المنطقة بالعربية إلزامي', 'Arabic name required');
    }
    const neighborhoods: string[] = Array.isArray(b.neighborhoods)
      ? b.neighborhoods.map((n: string) => n.trim()).filter(Boolean)
      : [];
    if (!neighborhoods.length) {
      throw Errors.badRequest('NEIGHBOURHOODS_REQUIRED',
        'المنطقة تُعرَّف بأحيائها — أضف حياً واحداً على الأقل',
        'At least one neighborhood required');
    }

    const type = b.zoneType ?? 'URBAN_CORE';
    const d = ZONE_DEFAULTS[type] ?? ZONE_DEFAULTS.URBAN_CORE!;
    const courier = b.defaultCourierCode
      ? await this.prisma.courier.findUnique({ where: { code: b.defaultCourierCode } })
      : null;

    const data = {
      name: b.name as any,
      governorate: (b.governorate ?? 'DAMASCUS') as any,
      city: b.city ?? 'دمشق',
      neighborhoods,
      zoneType: type as any,
      surchargeUsdCents: b.surchargeUsdCents ?? d.surcharge,
      slaHours: b.slaHours ?? d.sla,
      defaultCourierId: courier?.id ?? null,
      codMaxUsdCents: b.codMaxUsdCents ? BigInt(b.codMaxUsdCents) : null,
      active: b.active ?? true,
    };

    const existing = await this.prisma.deliveryZone.findUnique({ where: { code: b.code } });
    const z = existing
      ? await this.prisma.deliveryZone.update({ where: { id: existing.id }, data })
      : await this.prisma.deliveryZone.create({ data: { ...data, code: b.code } });

    const actor = await this.prisma.user.findUnique({ where: { publicId: actorPublicId } });
    await this.prisma.auditLog.create({
      data: {
        actorId: actor?.id, action: existing ? 'zone.update' : 'zone.create',
        entityType: 'delivery_zones', entityId: z.id, diff: { code: z.code },
      },
    });
    return { code: z.code, created: !existing };
  }

  async assignCourierToZone(zoneCode: string, courierCode: string, priority: number) {
    const [z, c] = await Promise.all([
      this.prisma.deliveryZone.findUnique({ where: { code: zoneCode } }),
      this.prisma.courier.findUnique({ where: { code: courierCode } }),
    ]);
    if (!z) throw Errors.notFound('المنطقة');
    if (!c) throw Errors.notFound('المندوب');

    await this.prisma.courierZone.upsert({
      where: { courierId_zoneId: { courierId: c.id, zoneId: z.id } },
      update: { priority },
      create: { courierId: c.id, zoneId: z.id, priority },
    });
    return { zone: zoneCode, courier: courierCode, priority };
  }

  async unassign(zoneCode: string, courierCode: string) {
    const [z, c] = await Promise.all([
      this.prisma.deliveryZone.findUnique({ where: { code: zoneCode } }),
      this.prisma.courier.findUnique({ where: { code: courierCode } }),
    ]);
    if (!z || !c) throw Errors.notFound('الربط');
    await this.prisma.courierZone.deleteMany({ where: { courierId: c.id, zoneId: z.id } });
    return { unassigned: true };
  }

  /**
   * مطابقة عنوان بمنطقة.
   *
   * المطابقة بالاسم المطبَّع لا بالنص الخام: الزبون يكتب «المزّة» و«المزه»
   * و«المزة الفيلات»، والمنطقة مسجَّلة باسم واحد. بلا تطبيع تسقط أغلب
   * العناوين إلى «لا منطقة» ويضيع الغرض من التقسيم كله.
   */
  async zoneForAddress(governorate: string, neighborhood: string) {
    const zones = await this.prisma.deliveryZone.findMany({
      where: { governorate: governorate as any, active: true },
    });
    const target = normalizeAr(neighborhood ?? '');
    if (!target) return null;

    for (const z of zones) {
      for (const n of strList(z.neighborhoods)) {
        const norm = normalizeAr(n);
        // احتواء في الاتجاهين: «المزة» تطابق «المزة فيلات غربية» وبالعكس
        if (norm && (target.includes(norm) || norm.includes(target))) return z;
      }
    }
    return null;
  }

  /**
   * اقتراح مندوب لطلب.
   * الترتيب: مندوبو المنطقة بأولويتهم، ثم من لم يبلغ سعته، ثم الأقل حِملاً.
   * لا يُقترح موقوف ولا خارج وردية — واقتراحُ من لا يعمل يضيّع وقت المرسِل.
   */
  async suggestCourier(orderNo: string) {
    const order = await this.prisma.order.findUnique({
      where: { orderNo }, include: { shippingAddress: true },
    });
    if (!order) throw Errors.notFound('الطلب');

    const zone = await this.zoneForAddress(
      order.shippingAddress.governorate, order.shippingAddress.neighborhood,
    );

    const today = new Date(); today.setUTCHours(0, 0, 0, 0);
    const candidates = await this.prisma.courier.findMany({
      where: {
        active: true,
        status: { in: ['AVAILABLE', 'ON_ROUTE'] },
        ...(zone
          ? { zones: { some: { zoneId: zone.id } } }
          : { homeGovernorate: order.shippingAddress.governorate }),
      },
      include: { zones: true },
    });

    const loads = await this.prisma.order.groupBy({
      by: ['collectedBy'],
      where: { deliveredAt: { gte: today } },
      _count: true,
    });
    const byId = new Map(loads.map((l) => [l.collectedBy, l._count]));

    const ranked = candidates
      .map((c) => {
        const load = byId.get(c.id) ?? 0;
        const priority = zone ? (c.zones.find((z) => z.zoneId === zone.id)?.priority ?? 99) : 50;
        return {
          code: c.code, name: c.fullName, phone: c.phone,
          status: c.status, load, capacity: c.dailyCapacity,
          atCapacity: load >= c.dailyCapacity,
          priority,
        };
      })
      .sort((a, b) =>
        Number(a.atCapacity) - Number(b.atCapacity)
        || a.priority - b.priority
        || a.load - b.load);

    return {
      orderNo,
      zone: zone ? { code: zone.code, name: zone.name, slaHours: zone.slaHours,
                     surchargeUsdCents: zone.surchargeUsdCents } : null,
      note: zone ? null : 'لا منطقة تطابق هذا الحي — أضف الحي إلى منطقة ليُقترح مندوبها تلقائياً.',
      candidates: ranked.slice(0, 5),
    };
  }
}

