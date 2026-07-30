import { sendWhatsapp, sendSms, type SendResult } from './channels.js';
import type { PrismaService } from '../common/prisma.service.js';
import { kv } from '../common/kv.js';

type Level = 'P0' | 'P1' | 'P2' | 'P3';
type Channel = 'IN_APP' | 'WHATSAPP' | 'SMS' | 'WEB_PUSH' | 'EMAIL';

/**
 * موجّه الإشعارات (الفصل 20).
 *
 * `IN_APP` كان مذكوراً في قنوات كل مستوى ولا يُسلَّم إلى أي مكان: الموجّه
 * يعالج واتساب وSMS فقط. وواتساب التجاري ممنوعٌ على سوريا، ولا مزوّد SMS
 * مضبوطاً، والقناتان تُرجعان `ok: true` وهما محاكاة — فكل إشعارات المتجر
 * تخرج إلى سطر سجلّ ويُقال إنها وصلت. وهذا أسوأ من خطأ صريح.
 *
 * فصار `IN_APP` أولاً وحقيقياً: يُكتب صفٌّ في القاعدة يقرؤه الزبون من
 * صندوقه في التطبيق. قناةٌ لا تحتاج مزوّداً ولا تُمنع على بلد.
 *
 * وقواعد التوجيه كما هي: P0 على قناتين ويتجاوز نافذة عدم الإزعاج.
 */
export class NotificationsService {
  /* القاعدة اختيارية: الموجّه يُنشأ في مواضع بلا اتصال (اختبارات الوحدة)،
     وغيابها يُعطّل الصندوق لا الإرسال. */
  constructor(private prisma?: PrismaService) {}

  private readonly log = {
    log: (m: string) => console.log(`[Notify] ${m}`),
    debug: (m: string) => console.debug(`[Notify] ${m}`),
    warn: (m: string) => console.warn(`[Notify] ${m}`),
    error: (m: string) => console.error(`[Notify] ${m}`),
  };

  private quietHours(now = new Date()) {
    // بتوقيت دمشق تقريباً (UTC+3)
    const h = (now.getUTCHours() + 3) % 24;
    return h >= 22 || h < 9;
  }

  private channelsFor(level: Level): Channel[] {
    if (level === 'P0') return ['IN_APP', 'WHATSAPP', 'SMS'];
    if (level === 'P1') return ['IN_APP', 'WHATSAPP', 'WEB_PUSH'];
    if (level === 'P2') return ['IN_APP', 'WEB_PUSH'];
    return ['IN_APP', 'WEB_PUSH'];
  }

  /**
   * منع التكرار على القاعدة لا على الذاكرة.
   *
   * كان `Map` داخل النسخة. وعزلات الـWorker كثيرة تُنشأ وتُهدَم بلا إشعار،
   * فواحدةٌ لا تعرف ما أرسلته أختها — والزبون يتلقّى «طلبك تأكّد» مرات.
   * والسؤال الآن: هل خرج هذا النوع لهذا الرقم عن هذا الكيان في آخر يوم؟
   */
  private async isDuplicate(phone: string, type: string, entityId?: string) {
    if (!this.prisma) return false;
    try {
      const since = new Date(Date.now() - 86_400_000);
      const prior = await this.prisma.notification.findFirst({
        where: { phone, type, entityId: entityId ?? null, createdAt: { gte: since } },
        select: { id: true },
      });
      return Boolean(prior);
    } catch {
      // الجدول غير موجود بعد (ترحيلٌ لم يُطبَّق): لا نمنع الإرسال بسببه
      return false;
    }
  }

  /**
   * قاطع واتساب في KV لا في الذاكرة — للسبب نفسه: عدّادٌ في عزلةٍ واحدة
   * لا يفتح قاطعاً ولا يغلقه، فيبقى المتجر يطرق باباً مغلقاً كل مرة.
   */
  private async waUnhealthy() {
    try { return ((await kv().get<number>('notify:wa:fail')) ?? 0) >= 5; }
    catch { return false; }
  }

  private async waFailed() {
    try { await kv().incr('notify:wa:fail', 900); } catch { /* لا يُسقط الإرسال */ }
  }

  /**
   * كتابة الإشعار في صندوق الزبون.
   *
   * لا تُسقط النداء مهما جرى: الإشعار أثرٌ للعملية لا العملية نفسها،
   * وطلبٌ يفشل لأن رسالته لم تُحفَظ خسارةٌ بلا مقابل. وإن كان الترحيل لم
   * يُطبَّق بعد على القاعدة الحيّة، يبقى المتجر يعمل كما كان بالضبط.
   */
  private async inbox(opts: {
    phone: string; type: string; level: Level; title: string; body: string;
    entityType?: string; entityId?: string; href?: string;
  }): Promise<SendResult> {
    if (!this.prisma) return { ok: false, channel: 'IN_APP', detail: 'no-db' };
    try {
      const user = await this.prisma.user.findUnique({
        where: { phoneE164: opts.phone }, select: { id: true },
      });
      await this.prisma.notification.create({
        data: {
          userId: user?.id ?? null,
          phone: opts.phone,
          type: opts.type,
          level: opts.level,
          title: opts.title,
          body: opts.body,
          entityType: opts.entityType ?? null,
          entityId: opts.entityId ?? null,
          href: opts.href ?? null,
        },
      });
      return { ok: true, channel: 'IN_APP' };
    } catch (e) {
      this.log.warn(`تعذّر حفظ الإشعار: ${e instanceof Error ? e.message : 'unknown'}`);
      return { ok: false, channel: 'IN_APP', detail: 'store-failed' };
    }
  }

  async send(opts: {
    type: string; level: Level; to: string; title: string; body: string;
    entityId?: string; entityType?: string; href?: string;
    /**
     * `dedupe: false` لما يُطلب مراراً بقصد. رمز الدخول أوّلها: كيانه رقمُ
     * الهاتف نفسه، فمنعُ التكرار يوماً كاملاً يعني أن من طلب رمزاً صباحاً
     * لا يستطيع الدخول حتى الغد. وكان المنع في الذاكرة فلا يكاد يُصيب —
     * ونقلُه إلى القاعدة يجعله يُصيب دائماً. فالاستثناء صريحٌ هنا لا صدفة.
     */
    dedupe?: boolean;
    /**
     * `inApp: false` لما لا يجوز أن يبقى مكتوباً. رمز الدخول أوّلها مرةً
     * أخرى: الصندوق لا يُقرأ إلا بعد الدخول، فحفظُ الرمز فيه لا يُفيد من
     * يريد الدخول — ويترك سرّاً مكتوباً لمن دخل بغير حقّ.
     */
    inApp?: boolean;
  }) {
    if (opts.dedupe !== false && await this.isDuplicate(opts.to, opts.type, opts.entityId)) {
      this.log.debug(`تجاهل مكرر: ${opts.to}:${opts.type}:${opts.entityId ?? ''}`);
      return { skipped: 'DUPLICATE' as const };
    }

    const planned = this.channelsFor(opts.level);
    const text = `${opts.title}\n${opts.body}`;
    const delivered: SendResult[] = [];

    /* الصندوق يُكتب قبل أي قناة خارجية وقبل فحص نافذة الهدوء: الهدوء
       يمنع أن يرنّ الهاتف ليلاً، لا أن يجد الزبون رسالته صباحاً. وإسقاط
       الإشعار كله بحجّة الليل يعني أن ما جرى بين العاشرة والتاسعة لا
       أثر له في أي مكان. */
    if (opts.inApp !== false) {
      delivered.push(await this.inbox({
        phone: opts.to, type: opts.type, level: opts.level,
        title: opts.title, body: opts.body,
        entityType: opts.entityType, entityId: opts.entityId, href: opts.href,
      }));
    }

    if (this.quietHours() && opts.level !== 'P0') {
      this.log.debug(`القنوات الخارجية مؤجَّلة لنافذة عدم الإزعاج: ${opts.type}`);
      return { channels: planned, delivered, quietHours: true };
    }

    // واتساب أولاً، وSMS تصعيد عند الفشل — مرة واحدة لا أكثر
    if (planned.includes('WHATSAPP')) {
      const skip = await this.waUnhealthy();
      const wa = skip
        ? { ok: false, channel: 'WHATSAPP', detail: 'circuit-open' }
        : await sendWhatsapp(opts.to, text);
      delivered.push(wa);
      if (!wa.ok) {
        if (!skip) await this.waFailed();
        delivered.push(await sendSms(opts.to, text));
      }
    } else if (planned.includes('SMS')) {
      delivered.push(await sendSms(opts.to, text));
    }

    // P0 يخرج على قناتين على الأقل ولو نجحت الأولى
    const external = delivered.filter((d) => d.channel !== 'IN_APP');
    if (opts.level === 'P0' && external.length === 1 && external[0]?.ok) {
      delivered.push(await sendSms(opts.to, text));
    }

    this.log.log(
      `[${opts.level}] ${opts.type} → ${opts.to} :: ` +
      delivered.map((d) => `${d.channel}${d.ok ? '✓' : '✗' + (d.detail ?? '')}`).join(' → '),
    );
    return { channels: planned, delivered };
  }
}
