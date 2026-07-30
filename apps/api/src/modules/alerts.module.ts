import { PrismaService } from '../common/prisma.service.js';
import { NotificationsService } from './notifications.service.js';
import { Errors } from '../common/errors.js';
import { roundCash } from '../common/money.js';
import { FxService } from './fx.module.js';

/**
 * تنبيهات التوفر وانخفاض السعر — الفصل 14 §14.6
 *
 * المقارنة بالدولار حصراً. لو قِيست بالليرة لأطلقت كل قفزة صرف موجةَ
 * «انخفض السعر!» عن سعر لم يتحرّك سنتاً واحداً — وأسرع طريق لأن يحظر
 * الزبون رسائل المتجر هي أن يكذب عليه رقمٌ مرتين.
 */
export class AlertsService {
  private running = false;

  constructor(
    private prisma: PrismaService,
    private notify: NotificationsService,
    private fx: FxService,
  ) {}

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

  /**
   * إنذار صاحب المتجر قبل أن يتوقّف البيع.
   *
   * سعر الصرف يصلح أربعاً وعشرين ساعة، ثم اثنتي عشرة بهامش أمان، ثم
   * يتوقّف البيع كلياً: `requireSellable` يرمي فيُرفض كل طلب. وهو قرارٌ
   * صحيح — البيع بسعرٍ ميت في عملةٍ تتحرّك يومياً خسارةٌ مؤكّدة — لكن
   * لم يكن أحدٌ يُنذَر به. فالمتجر يُظلم فجأةً بلا سابق إشارة، وصاحبه
   * يعرف حين يشتكي زبون.
   *
   * فيُقاس ما تبقّى ويُنذَر عند كل درجة. والدرجة هي كيان الإشعار، فمنع
   * التكرار يُخرج إنذاراً واحداً لكل درجةٍ في اليوم لا رسالةً كل ساعة.
   */
  async fxWatch() {
    const fx = await this.fx.current().catch(() => null);
    if (!fx || fx.health === 'FRESH') return { warned: 0 };

    const admins = await this.prisma.user.findMany({
      where: { role: 'ADMIN', deletedAt: null },
      select: { phoneE164: true },
    });
    if (!admins.length) return { warned: 0 };

    const h = Math.max(0, Math.round(fx.hoursLeft));
    const msg = {
      EXPIRING: {
        level: 'P1' as const, title: 'سعر الصرف يوشك أن ينتهي',
        body: `بقي ${h} ساعة على انتهاء السعر (${fx.baseRate.toLocaleString('en-US')}). حدّثه من اللوحة قبل أن يتوقّف البيع.`,
      },
      STALE_MARGIN: {
        level: 'P0' as const, title: 'السعر منتهٍ — البيع بهامش أمان',
        body: `انتهت صلاحية السعر ويُباع الآن بهامش أمان مؤقّت. يتوقّف البيع كلياً خلال ${Math.max(0, 12 + Math.round(fx.hoursLeft))} ساعة.`,
      },
      STALE_HALT: {
        level: 'P0' as const, title: 'توقّف البيع — السعر متقادم',
        body: 'لا يُقبل أي طلب جديد حتى يُحدَّث سعر الصرف من اللوحة.',
      },
    }[fx.health];
    if (!msg) return { warned: 0 };

    let warned = 0;
    for (const a of admins) {
      await this.notify.send({
        type: 'fx.health', level: msg.level, to: a.phoneE164,
        // الدرجة هي الكيان: إنذارٌ واحد لكل درجةٍ لا واحدٌ كل ساعة
        entityId: fx.health, entityType: 'fx_rates',
        title: msg.title, body: msg.body, href: '/admin/pricing',
      }).catch(() => {});
      warned++;
    }
    return { warned, health: fx.health };
  }
}

