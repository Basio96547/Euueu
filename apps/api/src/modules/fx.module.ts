import { Body, Controller, Get, Inject, Injectable, Post } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service.js';
import { Errors } from '../common/errors.js';

export type FxHealth = 'FRESH' | 'EXPIRING' | 'STALE_MARGIN' | 'STALE_HALT';

@Injectable()
export class FxService {
  constructor(
    @Inject(PrismaService) private prisma: PrismaService,
  ) {}

  async current() {
    const row = await this.prisma.fxRate.findFirst({
      where: { effectiveFrom: { lte: new Date() } },
      orderBy: { effectiveFrom: 'desc' },
    });
    if (!row) throw Errors.notFound('سعر الصرف');

    const hoursLeft = (row.validUntil.getTime() - Date.now()) / 3_600_000;
    const health: FxHealth =
      hoursLeft > 4 ? 'FRESH' : hoursLeft > 0 ? 'EXPIRING' : hoursLeft > -12 ? 'STALE_MARGIN' : 'STALE_HALT';

    // في فترة السماح يُطبَّق هامش أمان بدل البيع بسعر ميت (الفصل 3)
    const base = Number(row.rate);
    const rate = health === 'STALE_MARGIN' ? base * (1 + row.safetyMarginBp / 10_000) : base;

    return {
      rateId: row.id, rate, baseRate: base, health,
      effectiveFrom: row.effectiveFrom.toISOString(),
      validUntil: row.validUntil.toISOString(),
      safetyMarginBp: row.safetyMarginBp,
      hoursLeft: Math.round(hoursLeft * 10) / 10,
    };
  }

  /** البيع يتوقف تلقائياً عند التقادم الشديد — لا استمرار صامت */
  async requireSellable() {
    const fx = await this.current();
    if (fx.health === 'STALE_HALT') throw Errors.fxStaleHalt();
    return fx;
  }
}

@Controller('fx')
export class FxController {
  constructor(
    @Inject(FxService) private fx: FxService,
    @Inject(PrismaService) private prisma: PrismaService,
  ) {}

  @Get('current')
  async current() { return { data: await this.fx.current() }; }

  /** معاينة أثر سعر جديد قبل اعتماده (الفصل 10 §10.7) */
  @Post('preview')
  async preview(@Body() body: { rate: number }) {
    const cur = await this.fx.current();
    const variants = await this.prisma.productVariant.findMany({
      where: { deletedAt: null }, take: 500,
      select: { sku: true, priceUsdCents: true, product: { select: { name: true } } },
    });
    const round = (n: number) => Math.round(n / 1000) * 1000;
    const rows = variants.map((v) => {
      const cents = Number(v.priceUsdCents);
      const before = round((cents * cur.rate) / 100);
      const after = round((cents * body.rate) / 100);
      return { sku: v.sku, name: (v.product.name as any).ar, before, after, delta: after - before };
    });
    const changed = rows.filter((r) => Math.abs(r.delta) >= 1000);
    const protectedOrders = await this.prisma.order.count({
      where: { priceLockedUntil: { gt: new Date() }, status: 'PENDING_CONFIRMATION' },
    });
    return {
      data: {
        currentRate: cur.rate, newRate: body.rate,
        deviationPct: Math.round(((body.rate - cur.rate) / cur.rate) * 1000) / 10,
        changedCount: changed.length, totalCount: rows.length,
        protectedOrders,
        top: [...changed].sort((a, b) => b.after - a.after).slice(0, 10),
      },
    };
  }
}
