import { PrismaService } from '../common/prisma.service.js';
import { Errors } from '../common/errors.js';

/**
 * الجاهزية والمهام الدورية — الفصل 19 §19.5.
 *
 * بنود الجاهزية ليست وثيقة خارجية بل صفوف: وثيقةٌ في ملف تُقرأ مرة
 * وتُنسى، وصفٌّ بحالةٍ يمنع الإطلاق حتى يُحسم بتأشيرٍ من مسؤوله أو
 * بتجاوزٍ مكتوب سببه. و«جاهز» ليست رأياً بل حاصلَ جمعٍ يمكن الاحتجاج به.
 */

/** البنود الاثنان والثلاثون من §19.5، بنصّها وأصحابها */
export const SEED_CHECKS: Array<{
  code: string;
  category: 'TECH' | 'CONTENT' | 'OPS' | 'LEGAL' | 'FINANCE';
  ar: string;
  ownerRole: string;
  isBlocking?: boolean;
}> = [
  { code: 'TECH_LCP_3G', category: 'TECH', ownerRole: 'owner', ar: 'زمن أكبر عنصر في صفحة المنتج ضمن ميزانية الفصل 5 على 3G بطيء' },
  { code: 'TECH_NOJS_BROWSE', category: 'TECH', ownerRole: 'owner', ar: 'التصفح والبحث يعملان مع تعطيل JavaScript' },
  { code: 'TECH_GLASS_FALLBACK', category: 'TECH', ownerRole: 'owner', ar: 'البديل الصلب لطبقة الزجاج يعمل على جهاز ضعيف' },
  { code: 'TECH_RTL_SOUND', category: 'TECH', ownerRole: 'owner', ar: 'اتجاه RTL سليم في كل الشاشات بلا انكسار' },
  { code: 'TECH_BACKUP_RESTORED', category: 'TECH', ownerRole: 'owner', ar: 'النسخ الاحتياطي يعمل واستُعيد اختبارياً مرة على الأقل' },
  { code: 'TECH_MONITORING', category: 'TECH', ownerRole: 'owner', ar: 'المراقبة والتنبيهات مفعّلة ولها مستقبِل بشري' },
  { code: 'TECH_RATE_LIMITS', category: 'TECH', ownerRole: 'owner', ar: 'حدود المعدل مطبَّقة على مسارات الرمز والطلبات' },
  { code: 'TECH_TLS_DOMAINS', category: 'TECH', ownerRole: 'owner', ar: 'شهادات TLS ونطاقات talisham.com وapi وadmin مضبوطة' },
  { code: 'TECH_REINDEX_ON_DEPLOY', category: 'TECH', ownerRole: 'owner', ar: 'إعادة الفهرسة تجري آلياً عند النشر' },
  { code: 'TECH_COURIER_OFFLINE', category: 'TECH', ownerRole: 'operations', ar: 'طابور المزامنة في واجهة المندوب يعمل بلا إنترنت ثم يزامن' },

  { code: 'CONTENT_IMAGES_DESC', category: 'CONTENT', ownerRole: 'catalog', ar: 'كل منتج منشور له صورة أساسية ووصف عربي' },
  { code: 'CONTENT_USED_GRADES', category: 'CONTENT', ownerRole: 'catalog', ar: 'حالة كل جهاز مستعمل ودرجته وصحة بطاريته معبّأة' },
  { code: 'CONTENT_WARRANTY_SHOWN', category: 'CONTENT', ownerRole: 'catalog', ar: 'نوع الكفالة ومدتها ظاهران على كل منتج' },
  { code: 'CONTENT_HELP_PUBLISHED', category: 'CONTENT', ownerRole: 'support', ar: 'صفحات المساعدة والأسئلة الشائعة منشورة' },
  { code: 'CONTENT_SITEMAP_SCHEMA', category: 'CONTENT', ownerRole: 'owner', ar: 'خريطة الموقع والبيانات المنظَّمة صحيحة' },
  { code: 'CONTENT_WA_TEMPLATES', category: 'CONTENT', ownerRole: 'support', ar: 'رسائل واتساب القالبية معتمدة ومختبرة' },

  { code: 'OPS_COURIER_DAMASCUS_3', category: 'OPS', ownerRole: 'operations', ar: 'ثلاثة مندوبين فعّالين لدمشق وريفها بمناطق محددة' },
  { code: 'OPS_TRANSPORT_OFFICES', category: 'OPS', ownerRole: 'operations', ar: 'مكاتب النقل البري لكل محافظة مسجَّلة بأسعارها' },
  { code: 'OPS_FAILED_ATTEMPT_DRILL', category: 'OPS', ownerRole: 'operations', ar: 'سيناريو المحاولة الفاشلة مجرَّب من طرف إلى طرف' },
  { code: 'OPS_SETTLEMENT_DRILL', category: 'OPS', ownerRole: 'operations', ar: 'التسوية النقدية اليومية مجرَّبة بفصل واجبات فعلي' },
  { code: 'OPS_SUPPORT_HOURS', category: 'OPS', ownerRole: 'support', ar: 'ساعات الدعم معلنة ومغطّاة بموظف' },
  { code: 'OPS_POWER_PLAN', category: 'OPS', ownerRole: 'operations', ar: 'خطة انقطاع الكهرباء والإنترنت مكتوبة' },
  { code: 'OPS_OPENING_STOCKTAKE', category: 'OPS', ownerRole: 'operations', ar: 'جرد افتتاحي مطابق بين النظام والرفّ' },

  { code: 'LEGAL_RETURN_POLICY', category: 'LEGAL', ownerRole: 'owner', ar: 'سياسة الإرجاع والاستبدال منشورة وموافقة لما يُنفَّذ فعلاً' },
  { code: 'LEGAL_TERMS_PRIVACY', category: 'LEGAL', ownerRole: 'owner', ar: 'شروط الاستخدام وسياسة الخصوصية وحذف الحساب منشورة' },
  { code: 'LEGAL_WARRANTY_TERMS', category: 'LEGAL', ownerRole: 'owner', ar: 'شروط الكفالة تفصل بين كفالة المحل وكفالة الوكيل' },
  { code: 'LEGAL_INVOICE_FIELDS', category: 'LEGAL', ownerRole: 'owner', ar: 'الفاتورة الورقية تحمل البيانات المطلوبة نظامياً' },
  { code: 'LEGAL_PII_RETENTION', category: 'LEGAL', ownerRole: 'owner', ar: 'معالجة بيانات الهوية والصور محدودة بمدة احتفاظ معلنة' },

  { code: 'FIN_FX_SOURCE_DOCUMENTED', category: 'FINANCE', ownerRole: 'owner', ar: 'مصدر سعر الصرف وآلية تحديثه موثّقان ومسنَدان لشخص واحد' },
  { code: 'FIN_MARGIN_SAMPLE_20', category: 'FINANCE', ownerRole: 'owner', ar: 'هامش الربح محسوب بعد الشحن والمرتجعات والعمولة على عيّنة 20 منتجاً' },
  { code: 'FIN_COURIER_CASH_CAP', category: 'FINANCE', ownerRole: 'owner', ar: 'سقف النقد المسموح بحمله لكل مندوب محدَّد' },
  { code: 'FIN_REFUND_FLOAT', category: 'FINANCE', ownerRole: 'owner', ar: 'صندوق استرداد نقدي مخصَّص لتغطية إرجاعات الأسبوع الأول' },
];

const ROUTINES: Record<string, 'DAILY' | 'WEEKLY' | 'MONTHLY'> = {
  DAILY_PENDING_CONFIRMATIONS: 'DAILY',
  DAILY_RISK_REVIEW: 'DAILY',
  DAILY_FULFILLMENT: 'DAILY',
  DAILY_ASSIGNMENTS: 'DAILY',
  DAILY_HANDOVER: 'DAILY',
  DAILY_SHIPMENT_WATCH: 'DAILY',
  DAILY_SETTLEMENT: 'DAILY',
  DAILY_TICKETS: 'DAILY',
  DAILY_LOW_STOCK: 'DAILY',
  DAILY_QUESTIONS: 'DAILY',
  WEEKLY_FX_UPDATE: 'WEEKLY',
  WEEKLY_PRICE_REVIEW: 'WEEKLY',
  WEEKLY_RETURNS_REVIEW: 'WEEKLY',
  WEEKLY_WARRANTY_CLAIMS: 'WEEKLY',
  WEEKLY_MAINTENANCE_REPORT: 'WEEKLY',
  WEEKLY_MODERATION: 'WEEKLY',
  WEEKLY_PURCHASE_ORDERS: 'WEEKLY',
  WEEKLY_COURIER_SCORECARD: 'WEEKLY',
  MONTHLY_PNL_CLOSE: 'MONTHLY',
  MONTHLY_SUPPLIER_SCORECARD: 'MONTHLY',
  MONTHLY_COMMISSIONS: 'MONTHLY',
  MONTHLY_DEAD_STOCK: 'MONTHLY',
  MONTHLY_MARKET_PRICING: 'MONTHLY',
  MONTHLY_PARTIAL_STOCKTAKE: 'MONTHLY',
  MONTHLY_ACCESS_REVIEW: 'MONTHLY',
};

export class ReadinessService {
  constructor(private prisma: PrismaService) {}

  /** بذر البنود مرة واحدة — التشغيل المتكرر لا يعيد ضبط ما أُشِّر */
  async seed() {
    let created = 0;
    for (const [i, c] of SEED_CHECKS.entries()) {
      const exists = await this.prisma.readinessCheck.findUnique({ where: { code: c.code } });
      if (exists) continue;
      await this.prisma.readinessCheck.create({
        data: {
          code: c.code, category: c.category, title: { ar: c.ar },
          ownerRole: c.ownerRole, isBlocking: c.isBlocking ?? true, sortOrder: i,
        },
      });
      created++;
    }
    return { created, total: SEED_CHECKS.length };
  }

  async list(category?: string) {
    const rows = await this.prisma.readinessCheck.findMany({
      where: category ? { category: category as any } : {},
      orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }],
      include: { checkedBy: true },
    });
    return rows.map((r) => ({
      code: r.code, category: r.category, title: (r.title as any).ar,
      isBlocking: r.isBlocking, ownerRole: r.ownerRole, status: r.status,
      evidenceUrl: r.evidenceUrl, waiverReason: r.waiverReason,
      checkedBy: r.checkedBy?.fullName ?? null, checkedAt: r.checkedAt,
    }));
  }

  /**
   * التأشير. التجاوز (`WAIVED`) يلزمه سبب: بندٌ يُتجاوَز بلا سبب مكتوب
   * ليس محسوماً بل مخفياً، وأثره يظهر يوم الإطلاق لا يوم التأشير.
   */
  async update(code: string, b: { status?: string; evidenceUrl?: string; waiverReason?: string }, byPublicId?: string) {
    const check = await this.prisma.readinessCheck.findUnique({ where: { code } });
    if (!check) throw Errors.notFound(`بند الجاهزية ${code}`);

    if (b.status && !['PENDING', 'PASSED', 'FAILED', 'WAIVED'].includes(b.status)) {
      throw Errors.badRequest('READINESS_STATUS_INVALID', 'حالة غير معروفة', 'Unknown status');
    }
    if (b.status === 'WAIVED' && !b.waiverReason?.trim()) {
      throw Errors.badRequest('WAIVER_REASON_REQUIRED',
        'تجاوز بند الجاهزية يلزمه سبب مكتوب', 'Waiver reason required');
    }
    if (b.status === 'PASSED' && check.isBlocking && !(b.evidenceUrl ?? check.evidenceUrl)) {
      throw Errors.badRequest('EVIDENCE_REQUIRED',
        'بندٌ مانع للإطلاق لا يُؤشَّر ناجحاً بلا إثبات (تقرير أو لقطة أو عقد)',
        'Evidence required for blocking checks');
    }

    const user = byPublicId
      ? await this.prisma.user.findUnique({ where: { publicId: byPublicId } })
      : null;

    const updated = await this.prisma.readinessCheck.update({
      where: { code },
      data: {
        status: (b.status ?? check.status) as any,
        evidenceUrl: b.evidenceUrl ?? check.evidenceUrl,
        waiverReason: b.status === 'WAIVED' ? b.waiverReason : check.waiverReason,
        checkedById: user?.id ?? check.checkedById,
        checkedAt: new Date(),
      },
    });
    await this.prisma.auditLog.create({
      data: {
        actorId: user?.id, action: 'readiness.update', entityType: 'readiness_checks',
        entityId: check.id, diff: { code, from: check.status, to: updated.status, waiver: b.waiverReason },
      },
    });
    return { code, status: updated.status };
  }

  /** الخلاصة: `launch_ready` حاصلُ جمعٍ لا رأي */
  async summary() {
    const rows = await this.prisma.readinessCheck.findMany();
    const blocking = rows.filter((r) => r.isBlocking);
    const passed = blocking.filter((r) => r.status === 'PASSED' || r.status === 'WAIVED');
    const failed = blocking.filter((r) => r.status !== 'PASSED' && r.status !== 'WAIVED');

    return {
      launch_ready: blocking.length > 0 && failed.length === 0,
      blocking_total: blocking.length,
      blocking_passed: passed.length,
      total: rows.length,
      failed: failed.map((r) => ({
        code: r.code, category: r.category, owner_role: r.ownerRole,
        title: (r.title as any).ar, status: r.status,
      })),
    };
  }

  /* ————————————————— المهام الدورية (19.2) ————————————————— */

  /** مفتاح الفترة: يوم أو أسبوع أو شهر بتوقيت دمشق */
  periodKey(cadence: 'DAILY' | 'WEEKLY' | 'MONTHLY', at = new Date()): string {
    const d = new Date(at.getTime() + 3 * 3_600_000);   // UTC+3
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    if (cadence === 'MONTHLY') return `${y}-${m}`;
    if (cadence === 'DAILY') return `${y}-${m}-${String(d.getUTCDate()).padStart(2, '0')}`;
    const start = Date.UTC(y, 0, 1);
    const week = Math.ceil(((d.getTime() - start) / 86_400_000 + new Date(start).getUTCDay() + 1) / 7);
    return `${y}-W${String(week).padStart(2, '0')}`;
  }

  async routines(cadence?: string, periodKey?: string) {
    const codes = Object.entries(ROUTINES)
      .filter(([, c]) => !cadence || c === cadence);

    const out = [];
    for (const [code, c] of codes) {
      const key = periodKey ?? this.periodKey(c);
      const run = await this.prisma.opsRoutineRun.findUnique({
        where: { routineCode_periodKey: { routineCode: code, periodKey: key } },
        include: { performedBy: true },
      });
      out.push({
        code, cadence: c, periodKey: key,
        status: run?.status ?? null,
        isAutomated: run?.isAutomated ?? false,
        performedBy: run?.performedBy?.fullName ?? null,
        completedAt: run?.completedAt ?? null,
        notes: run?.notes ?? null,
      });
    }
    return out;
  }

  /** القيد الفريد يمنع ازدواج التنفيذ؛ وإعادة التسجيل تحديثٌ لا صفٌّ ثانٍ */
  async completeRoutine(
    code: string,
    b: { periodKey?: string; status?: string; notes?: string; isAutomated?: boolean },
    byPublicId?: string,
  ) {
    const cadence = ROUTINES[code];
    if (!cadence) throw Errors.notFound(`المهمة الدورية ${code}`);

    const status = b.status ?? 'DONE';
    if (!['DONE', 'SKIPPED', 'FAILED'].includes(status)) {
      throw Errors.badRequest('ROUTINE_STATUS_INVALID', 'حالة غير معروفة', 'Unknown status');
    }
    if (status !== 'DONE' && !b.notes?.trim()) {
      throw Errors.badRequest('ROUTINE_NOTE_REQUIRED',
        'تخطّي مهمة أو فشلها يلزمه سبب', 'Reason required when skipped or failed');
    }

    const key = b.periodKey ?? this.periodKey(cadence);
    const user = byPublicId
      ? await this.prisma.user.findUnique({ where: { publicId: byPublicId } })
      : null;

    const run = await this.prisma.opsRoutineRun.upsert({
      where: { routineCode_periodKey: { routineCode: code, periodKey: key } },
      update: {
        status: status as any, notes: b.notes,
        performedById: user?.id, isAutomated: b.isAutomated ?? false, completedAt: new Date(),
      },
      create: {
        routineCode: code, cadence, periodKey: key, status: status as any,
        notes: b.notes, performedById: user?.id, isAutomated: b.isAutomated ?? false,
      },
    });
    return { code, periodKey: key, status: run.status };
  }
}
