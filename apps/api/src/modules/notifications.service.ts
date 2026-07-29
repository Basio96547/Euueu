import { Injectable, Logger } from '@nestjs/common';

type Level = 'P0' | 'P1' | 'P2' | 'P3';
type Channel = 'IN_APP' | 'WHATSAPP' | 'SMS' | 'WEB_PUSH' | 'EMAIL';

/**
 * موجّه الإشعارات (الفصل 20).
 * محلياً تُكتب الرسائل في السجل بدل إرسالها — لا مزوّد ولا تكلفة.
 * وقواعد التوجيه مطبَّقة كما هي: P0 على قناتين ويتجاوز نافذة عدم الإزعاج.
 */
@Injectable()
export class NotificationsService {
  private readonly log = new Logger('Notify');
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
    const channels = this.channelsFor(opts.level);
    this.log.log(`[${opts.level}] ${opts.type} → ${opts.to} عبر ${channels.join('+')} :: ${opts.title} — ${opts.body}`);
    return { channels };
  }
}
