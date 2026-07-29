import { sendWhatsapp, sendSms, type SendResult } from './channels.js';

type Level = 'P0' | 'P1' | 'P2' | 'P3';
type Channel = 'IN_APP' | 'WHATSAPP' | 'SMS' | 'WEB_PUSH' | 'EMAIL';

/**
 * موجّه الإشعارات (الفصل 20).
 * محلياً تُكتب الرسائل في السجل بدل إرسالها — لا مزوّد ولا تكلفة.
 * وقواعد التوجيه مطبَّقة كما هي: P0 على قناتين ويتجاوز نافذة عدم الإزعاج.
 */
export class NotificationsService {
  private readonly log = {
    log: (m: string) => console.log(`[Notify] ${m}`),
    debug: (m: string) => console.debug(`[Notify] ${m}`),
    warn: (m: string) => console.warn(`[Notify] ${m}`),
    error: (m: string) => console.error(`[Notify] ${m}`),
  };
  private sent = new Map<string, number>();

  private quietHours(now = new Date()) {
    // بتوقيت دمشق تقريباً (UTC+3)
    const h = (now.getUTCHours() + 3) % 24;
    return h >= 22 || h < 9;
  }

  private channelsFor(level: Level): Channel[] {
    if (level === 'P0') return ['IN_APP', 'WHATSAPP', 'SMS'];
    if (level === 'P1') return ['IN_APP', 'WHATSAPP', 'WEB_PUSH'];
    if (level === 'P2') return ['IN_APP', 'WEB_PUSH'];
    return ['WEB_PUSH'];
  }

  /** إحصاء الفشل لتفعيل التبديل التلقائي إلى الاحتياطي (الفصل 9 §9.12) */
  private waFailures: number[] = [];

  private waUnhealthy() {
    const cutoff = Date.now() - 15 * 60_000;
    this.waFailures = this.waFailures.filter((t) => t > cutoff);
    return this.waFailures.length >= 5;
  }

  async send(opts: { type: string; level: Level; to: string; title: string; body: string; entityId?: string }) {
    const key = `${opts.to}:${opts.type}:${opts.entityId ?? ''}`;
    const last = this.sent.get(key);
    // منع التكرار: الحدث نفسه لا يخرج مرتين خلال 24 ساعة
    if (last && Date.now() - last < 86_400_000) {
      this.log.debug(`تجاهل مكرر: ${key}`);
      return { skipped: 'DUPLICATE' as const };
    }

    if (this.quietHours() && opts.level !== 'P0') {
      this.log.debug(`مؤجَّل لنافذة عدم الإزعاج: ${opts.type}`);
      return { skipped: 'QUIET_HOURS' as const };
    }

    this.sent.set(key, Date.now());
    const planned = this.channelsFor(opts.level);
    const text = `${opts.title}\n${opts.body}`;
    const delivered: SendResult[] = [];

    // واتساب أولاً، وSMS تصعيد عند الفشل — مرة واحدة لا أكثر
    if (planned.includes('WHATSAPP')) {
      const skip = this.waUnhealthy();
      const wa = skip
        ? { ok: false, channel: 'WHATSAPP', detail: 'circuit-open' }
        : await sendWhatsapp(opts.to, text);
      delivered.push(wa);
      if (!wa.ok) {
        this.waFailures.push(Date.now());
        const sms = await sendSms(opts.to, text);
        delivered.push(sms);
      }
    } else if (planned.includes('SMS')) {
      delivered.push(await sendSms(opts.to, text));
    }

    // P0 يخرج على قناتين على الأقل ولو نجحت الأولى
    if (opts.level === 'P0' && delivered.length === 1 && delivered[0]?.ok) {
      delivered.push(await sendSms(opts.to, text));
    }

    this.log.log(
      `[${opts.level}] ${opts.type} → ${opts.to} :: ` +
      delivered.map((d) => `${d.channel}${d.ok ? '✓' : '✗' + (d.detail ?? '')}`).join(' → '),
    );
    return { channels: planned, delivered };
  }
}
