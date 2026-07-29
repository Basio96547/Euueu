import { PrismaService } from '../common/prisma.service.js';
import { FxService } from './fx.module.js';
import { Errors } from '../common/errors.js';

/**
 * التقارير المالية والتشغيلية — الفصلان 16 و17، ومهام 19.2 الشهرية.
 *
 * كل رقم هنا بالدولار مرجعاً، والليرة عرضٌ يُشتقّ بسعر اليوم. الربح
 * المحسوب بالليرة على بضاعةٍ اشتُريت بالدولار ليس ربحاً بل أثرَ صرف،
 * ومن يقرأه على أنه ربح يوزّعه ثم يعجز عن إعادة شراء ما باع.
 */
export class ReportsService {
  constructor(private prisma: PrismaService, private fx: FxService) {}

  private monthRange(month?: string) {
    const now = new Date();
    const key = month ?? `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    const m = /^(\d{4})-(\d{2})$/.exec(key);
    if (!m) throw Errors.badRequest('MONTH_INVALID', 'الشهر بصيغة YYYY-MM', 'Month must be YYYY-MM');
    const from = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1));
    const to = new Date(Date.UTC(Number(m[1]), Number(m[2]), 1));
    return { key, from, to };
  }

  /**
   * قائمة الأرباح والخسائر الشهرية.
   * الإيراد من الطلبات المسلَّمة وحدها: طلبٌ شُحن ولم يُسلَّم لم يصر بيعاً،
   * واحتسابه إيراداً يجعل كل محاولة فاشلة ربحاً على الورق.
   */
  async pnl(month?: string) {
    const { key, from, to } = this.monthRange(month);

    const items = await this.prisma.orderItem.findMany({
      where: { order: { status: 'DELIVERED', deliveredAt: { gte: from, lt: to } } },
      include: { variant: { include: { product: true } }, order: true },
    });

    let revenue = 0, cogs = 0, shipping = 0, discounts = 0;
    const orderIds = new Set<string>();
    for (const it of items) {
      revenue += Number(it.lineTotalUsdCents);
      cogs += Number(it.variant.costPriceUsdCents ?? 0n) * it.qty;
      orderIds.add(it.orderId);
    }

    const orders = await this.prisma.order.findMany({
      where: { status: 'DELIVERED', deliveredAt: { gte: from, lt: to } },
    });
    for (const o of orders) {
      shipping += Number(o.shippingTotalUsdCents);
      discounts += Number(o.discountTotalUsdCents);
    }

    // المرتجعات تُخصم في شهر صرفها لا في شهر بيعها: النقد خرج حينها
    const refunds = await this.prisma.refund.findMany({
      where: { disbursedAt: { gte: from, lt: to } },
    });
    const refunded = refunds.reduce((a, r) => a + Number(r.amountUsdCents ?? 0n), 0);

    const settlements = await this.prisma.cashSettlement.findMany({
      where: { settlementDate: { gte: from, lt: to } },
    });
    /* عمولة التوصيل تُدفع بالليرة ولا يُخفى ذلك بتحويلٍ صامت: تُعرض
       بعملتها، ويُشتقّ مقابلها الدولاري بسعر معلن ليُطرح من الصافي. */
    const commissionSyp = settlements.reduce((a, s) => a + Number(s.deliveryCommissionSyp), 0);
    const fx = await this.fx.current().catch(() => null);
    const commissionUsdCents = fx?.rate ? Math.round((commissionSyp / fx.rate) * 100) : 0;

    const grossUsdCents = revenue - cogs;
    const netUsdCents = grossUsdCents + shipping - discounts - refunded - commissionUsdCents;

    return {
      month: key,
      orders: orders.length,
      units: items.reduce((a, i) => a + i.qty, 0),
      revenueUsdCents: revenue,
      cogsUsdCents: cogs,
      grossMarginUsdCents: grossUsdCents,
      grossMarginPct: revenue ? Math.round((grossUsdCents / revenue) * 1000) / 10 : 0,
      shippingUsdCents: shipping,
      discountsUsdCents: discounts,
      refundsUsdCents: refunded,
      courierCommissionSyp: commissionSyp,
      courierCommissionUsdCents: commissionUsdCents,
      netUsdCents,
      fxRateUsed: fx?.rate ?? null,
      note: 'الإيراد من المسلَّم فقط. المرتجع يُخصم في شهر صرفه لا في شهر بيعه.',
    };
  }

  /**
   * المخزون الراكد وتقادمه.
   * «راكد» ليست رأياً: صنفٌ في الرفّ ولم يُبَع منه شيء منذ عتبة الأيام.
   */
  async deadStock(days = 90) {
    const since = new Date(Date.now() - days * 86_400_000);

    const levels = await this.prisma.inventoryLevel.findMany({
      where: { onHand: { gt: 0 } },
      include: { variant: { include: { product: true } } },
    });

    const out = [];
    for (const l of levels) {
      const lastSale = await this.prisma.inventoryMovement.findFirst({
        where: { variantId: l.variantId, reason: 'SALE' },
        orderBy: { createdAt: 'desc' },
      });
      const lastReceipt = await this.prisma.inventoryMovement.findFirst({
        where: { variantId: l.variantId, reason: 'RECEIPT' },
        orderBy: { createdAt: 'desc' },
      });
      if (lastSale && lastSale.createdAt > since) continue;

      const cost = Number(l.variant.costPriceUsdCents ?? 0n);
      const ageDays = lastReceipt
        ? Math.floor((Date.now() - lastReceipt.createdAt.getTime()) / 86_400_000)
        : null;

      out.push({
        sku: l.variant.sku,
        name: (l.variant.product.name as any).ar,
        onHand: l.onHand,
        reserved: l.reserved,
        tiedCapitalUsdCents: cost * l.onHand,
        lastSaleAt: lastSale?.createdAt ?? null,
        ageDays,
        priceUsdCents: Number(l.variant.priceUsdCents),
      });
    }

    out.sort((a, b) => b.tiedCapitalUsdCents - a.tiedCapitalUsdCents);
    return {
      thresholdDays: days,
      count: out.length,
      tiedCapitalUsdCents: out.reduce((a, x) => a + x.tiedCapitalUsdCents, 0),
      items: out,
    };
  }

  /**
   * تقادم المخزون بشرائح عمرية — للتخفيض قبل أن يصير الجهاز جيلاً قديماً.
   * العمر يُقاس من آخر استلام في دفتر الحركات: وحدة الجهاز لا تحمل
   * تاريخ دخولها، والدفتر يحمله — فالمصدر هو الدفتر لا التخمين.
   */
  async inventoryAging() {
    const buckets = [
      { label: '0-30', min: 0, max: 30, units: 0, capitalUsdCents: 0 },
      { label: '31-60', min: 31, max: 60, units: 0, capitalUsdCents: 0 },
      { label: '61-90', min: 61, max: 90, units: 0, capitalUsdCents: 0 },
      { label: '90+', min: 91, max: Infinity, units: 0, capitalUsdCents: 0 },
      { label: 'بلا استلام مسجَّل', min: -1, max: -1, units: 0, capitalUsdCents: 0 },
    ];

    const levels = await this.prisma.inventoryLevel.findMany({
      where: { onHand: { gt: 0 } },
      include: { variant: true },
    });

    for (const l of levels) {
      const lastReceipt = await this.prisma.inventoryMovement.findFirst({
        where: { variantId: l.variantId, reason: 'RECEIPT' },
        orderBy: { createdAt: 'desc' },
      });
      const age = lastReceipt
        ? Math.floor((Date.now() - lastReceipt.createdAt.getTime()) / 86_400_000)
        : -1;
      const b = buckets.find((x) => age >= x.min && age <= x.max) ?? buckets[buckets.length - 1]!;
      b.units += l.onHand;
      b.capitalUsdCents += Number(l.variant.costPriceUsdCents ?? 0n) * l.onHand;
    }

    return {
      buckets,
      totalUnits: buckets.reduce((a, b) => a + b.units, 0),
      totalCapitalUsdCents: buckets.reduce((a, b) => a + b.capitalUsdCents, 0),
    };
  }

  /**
   * بطاقة أداء المندوب — الفصل 17.
   * المقياس الأول نسبة التسليم من أول محاولة: هو الرقم الذي يقرّر كلفة
   * التوصيل الحقيقية، ومحاولةٌ ثانية تعني رحلةً كاملة بلا إيراد جديد.
   */
  async courierScorecard(code: string, days = 30) {
    const courier = await this.prisma.courier.findUnique({ where: { code } });
    if (!courier) throw Errors.notFound('المندوب');
    const since = new Date(Date.now() - days * 86_400_000);

    /* الطلب لا يحمل حقل مندوب: الرابط الحقيقي هو من حصّل النقد ومن
       سجّل انتقالات الشحن. القياس من الأثر الفعلي لا من نيّة تعيين. */
    const delivered = await this.prisma.order.findMany({
      where: { collectedBy: courier.userId, deliveredAt: { gte: since } },
      include: { history: true },
    });

    const failedAttempts = await this.prisma.orderStatusHistory.count({
      where: { actorId: courier.userId, toStatus: 'DELIVERY_FAILED', createdAt: { gte: since } },
    });
    const firstAttempt = delivered.filter(
      (o) => !o.history.some((h) => h.toStatus === 'DELIVERY_FAILED'),
    ).length;

    const settlements = await this.prisma.cashSettlement.findMany({
      where: { collectorId: courier.userId, settlementDate: { gte: since } },
    });
    const collected = settlements.reduce((a, s) => a + Number(s.collectedAmountSyp), 0);
    const variance = settlements.reduce((a, s) => a + Number(s.varianceSyp), 0);

    return {
      code: courier.code,
      name: courier.fullName,
      periodDays: days,
      delivered: delivered.length,
      failedAttempts,
      firstAttemptPct: delivered.length ? Math.round((firstAttempt / delivered.length) * 1000) / 10 : null,
      collectedSyp: collected,
      varianceSyp: variance,
      settlementsCount: settlements.length,
      status: courier.status,
      cashCapUsdCents: Number(courier.cashCapUsdCents),
    };
  }

  /**
   * احتساب عمولات الشهر — الاحتساب آلي والاعتماد يدوي (19.2).
   * لا صرف من هنا: هذا تقرير يُقرأ ويُعتمد، وأي صرف يمرّ بالتسويات
   * حيث يوجد فصل الواجبات — وإلا صار للعمولة بابٌ خلفي بلا مراجعة.
   */
  async commissions(month?: string) {
    const { key, from, to } = this.monthRange(month);
    const settlements = await this.prisma.cashSettlement.findMany({
      where: { settlementDate: { gte: from, lt: to } },
    });

    const byCollector = new Map<string, { commission: number; collected: number; days: number }>();
    for (const st of settlements) {
      const id = st.collectorId;
      const cur = byCollector.get(id) ?? { commission: 0, collected: 0, days: 0 };
      cur.commission += Number(st.deliveryCommissionSyp);
      cur.collected += Number(st.collectedAmountSyp);
      cur.days++;
      byCollector.set(id, cur);
    }

    const rows = [];
    for (const [id, v] of byCollector) {
      const courier = await this.prisma.courier.findFirst({ where: { userId: id } });
      rows.push({
        collectorId: id,
        code: courier?.code ?? null,
        name: courier?.fullName ?? null,
        daysWorked: v.days,
        collectedSyp: v.collected,
        commissionSyp: v.commission,
      });
    }
    rows.sort((a, b) => b.commissionSyp - a.commissionSyp);

    return {
      month: key,
      couriers: rows.length,
      totalCommissionSyp: rows.reduce((a, r) => a + r.commissionSyp, 0),
      rows,
      note: 'الاحتساب آلي والاعتماد يدوي — ولا صرف إلا عبر التسويات حيث فصل الواجبات.',
    };
  }
}
