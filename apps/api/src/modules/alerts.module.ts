import { Body, Controller, Inject, Injectable, Post, Req, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service.js';
import { NotificationsService } from './notifications.service.js';
import { Errors } from '../common/errors.js';
import { roundCash } from '../common/money.js';
import { FxService } from './fx.module.js';
import { MaybeAuth } from '../common/guards.js';

/**
 * تنبيهات التوفر وانخفاض السعر — الفصل 14 §14.6
 *
 * المقارنة بالدولار حصراً. لو قِيست بالليرة لأطلقت كل قفزة صرف موجةَ
 * «انخفض السعر!» عن سعر لم يتحرّك سنتاً واحداً — وأسرع طريق لأن يحظر
 * الزبون رسائل المتجر هي أن يكذب عليه رقمٌ مرتين.
 */
@Injectable()
export class AlertsService implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private readonly intervalMs = Number(process.env.ALERTS_INTERVAL_MS ?? 300_000);

  constructor(
    @Inject(PrismaService) private prisma: PrismaService,
    @Inject(NotificationsService) private notify: NotificationsService,
    @Inject(FxService) private fx: FxService,
  ) {}

  onModuleInit() {
    if (process.env.ALERTS_DISABLED === '1') return;
    this.timer = setInterval(() => { void this.scan(); }, this.intervalMs);
    this.timer.unref?.();
  }

  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  async subscribeStock(b: { sku: string; phone: string; userPublicId?: string }) {
    if (!/^\+9639[0-9]{8}$/.test(b.phone)) {
      throw Errors.badRequest('PHONE_INVALID', 'رقم الجوال بصيغة +9639XXXXXXXX', 'Invalid phone');
    }
    const variant = await this.prisma.productVariant.findUnique({
      where: { sku: b.sku }, include: { levels: true },
    });
    if (!variant) throw Errors.notFound('المتغيّر');

    const available = variant.levels.reduce((a, l) => a + (l.onHand - l.reserved), 0);
    if (available > 0) {
      throw Errors.badRequest('ALREADY_AVAILABLE',
        'المنتج متوفر الآن — أضفه للسلة', 'Already in stock');
    }

    const user = b.userPublicId
      ? await this.prisma.user.findUnique({ where: { publicId: b.userPublicId } })
      : null;

    await this.prisma.stockAlert.upsert({
      where: { phone_variantId: { phone: b.phone, variantId: variant.id } },
      update: { isActive: true, notifiedAt: null, expiresAt: new Date(Date.now() + 90 * 86_400_000) },
      create: {
        phone: b.phone, variantId: variant.id, userId: user?.id,
        expiresAt: new Date(Date.now() + 90 * 86_400_000),
      },
    });
    return { subscribed: true, note: 'سنرسل لك رسالة واحدة فور توفره.' };
  }

  async subscribePrice(userPublicId: string, b: { sku: string; thresholdBp?: number }) {
    const [user, variant] = await Promise.all([
      this.prisma.user.findUnique({ where: { publicId: userPublicId } }),
      this.prisma.productVariant.findUnique({ where: { sku: b.sku } }),
    ]);
    if (!user) throw Errors.notFound('المستخدم');
    if (!variant) throw Errors.notFound('المتغيّر');

    await this.prisma.priceAlert.upsert({
      where: { userId_variantId: { userId: user.id, variantId: variant.id } },
      update: {
        basePriceUsdCents: variant.priceUsdCents,
        thresholdBp: b.thresholdBp ?? 500,
        isActive: true, lastNotifiedAt: null,
        expiresAt: new Date(Date.now() + 90 * 86_400_000),
      },
      create: {
        userId: user.id, variantId: variant.id,
        basePriceUsdCents: variant.priceUsdCents,
        thresholdBp: b.thresholdBp ?? 500,
        expiresAt: new Date(Date.now() + 90 * 86_400_000),
      },
    });
    const pct = ((b.thresholdBp ?? 500) / 100).toFixed(1);
    return { subscribed: true, note: `سنعلمك إن نزل السعر ${pct}% أو أكثر.` };
  }

  /** فحص دوري: رسالة واحدة لكل اشتراك ثم يُغلق */
  async scan() {
    if (this.running) return { stock: 0, price: 0 };
    this.running = true;
    try {
      const fx = await this.fx.current().catch(() => null);
      const rate = fx?.rate ?? 0;
      const syp = (cents: number) => roundCash((cents * rate) / 100).toLocaleString('en-US');

      let stockSent = 0, priceSent = 0;
      const now = new Date();

      const stock = await this.prisma.stockAlert.findMany({
        where: { isActive: true, notifiedAt: null, expiresAt: { gt: now } },
        include: { variant: { include: { product: true, levels: true } } },
        take: 200,
      });
      for (const a of stock) {
        const available = a.variant.levels.reduce((x, l) => x + (l.onHand - l.reserved), 0);
        if (available <= 0) continue;
        await this.notify.send({
          type: 'alert.back_in_stock', level: 'P2', to: a.phone, entityId: a.variant.sku,
          title: 'توفّر ما انتظرتَه',
          body: `${(a.variant.product.name as any).ar} متوفر الآن — ${syp(Number(a.variant.priceUsdCents))} ل.س.`,
        });
        await this.prisma.stockAlert.update({
          where: { id: a.id }, data: { notifiedAt: now, isActive: false },
        });
        stockSent++;
      }

      const price = await this.prisma.priceAlert.findMany({
        where: { isActive: true, expiresAt: { gt: now } },
        include: { variant: { include: { product: true } }, user: true },
        take: 200,
      });
      for (const a of price) {
        const base = Number(a.basePriceUsdCents);
        const cur = Number(a.variant.priceUsdCents);
        if (base <= 0) continue;
        const dropBp = Math.round(((base - cur) / base) * 10_000);
        if (dropBp < a.thresholdBp) continue;
        // رسالة واحدة كل 24 ساعة على الأكثر
        if (a.lastNotifiedAt && now.getTime() - a.lastNotifiedAt.getTime() < 86_400_000) continue;

        await this.notify.send({
          type: 'alert.price_drop', level: 'P2', to: a.user.phoneE164, entityId: a.variant.sku,
          title: 'انخفض السعر',
          body: `${(a.variant.product.name as any).ar}: ${(dropBp / 100).toFixed(1)}% أقل — ${syp(cur)} ل.س.`,
        });
        await this.prisma.priceAlert.update({
          where: { id: a.id }, data: { lastNotifiedAt: now, isActive: false },
        });
        priceSent++;
      }

      if (stockSent || priceSent) {
        console.log(`تنبيهات: ${stockSent} توفّر · ${priceSent} انخفاض سعر`);
      }
      return { stock: stockSent, price: priceSent };
    } finally {
      this.running = false;
    }
  }
}

@Controller('alerts')
export class AlertsController {
  constructor(@Inject(AlertsService) private a: AlertsService) {}

  /** التوفّر يعمل للضيف: من ينتظر جهازاً لا يُطالَب بحساب أولاً */
  @Post('stock')
  @MaybeAuth()
  async stock(@Body() b: { sku: string; phone: string }, @Req() req: any) {
    return { data: await this.a.subscribeStock({ ...b, userPublicId: req.user?.sub }) };
  }

  @Post('price')
  @MaybeAuth()
  async price(@Body() b: { sku: string; thresholdBp?: number }, @Req() req: any) {
    if (!req.user?.sub) {
      throw Errors.badRequest('AUTH_REQUIRED',
        'تنبيه السعر يحتاج حساباً — سجّل دخولك برمز', 'Sign in required');
    }
    return { data: await this.a.subscribePrice(req.user.sub, b) };
  }
}
