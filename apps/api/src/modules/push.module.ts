import { Body, Controller, Get, Inject, Injectable, Post, Req } from '@nestjs/common';
import { createSign } from 'node:crypto';
import { PrismaService } from '../common/prisma.service.js';
import { Errors } from '../common/errors.js';
import { MaybeAuth } from '../common/guards.js';

/**
 * إشعارات المتصفح (Web Push) — الفصل 20
 *
 * قناة ثالثة إلى جانب واتساب وSMS، وأرخصها: لا تكلفة لكل رسالة ولا
 * مزوّد يمكن أن يحجب. لكنها الأضعف وصولاً — تعمل على أندرويد وسطح
 * المكتب، وعلى iOS بشرط أن يضيف الزبون المتجر إلى الشاشة الرئيسية.
 * لذلك هي **إضافة** لا بديل: الطلبات الحرجة تبقى على واتساب.
 *
 * التوقيع VAPID مكتوب هنا بلا مكتبة: التوقيع ES256 على رأس JWT
 * وحمولة صغيرة، وهو كل ما يلزم لإرسال إشعار بلا حمولة مشفَّرة.
 */
const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY ?? '';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY ?? '';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT ?? 'mailto:support@talisham.com';

export const pushConfigured = () => Boolean(VAPID_PUBLIC && VAPID_PRIVATE);

const b64url = (b: Buffer) => b.toString('base64url');

/** توقيع JWT بخوارزمية ES256 على منحنى P-256 — ما يشترطه VAPID */
function signVapidJwt(audience: string): string {
  const header = b64url(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const payload = b64url(Buffer.from(JSON.stringify({
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: VAPID_SUBJECT,
  })));

  const der = createSign('SHA256')
    .update(`${header}.${payload}`)
    .sign({ key: pkcs8FromRaw(VAPID_PRIVATE) });

  return `${header}.${payload}.${b64url(derToJose(der))}`;
}

/** المفتاح الخاص يُخزَّن خاماً (32 بايت base64url)، وopenssl يريده PKCS#8 */
function pkcs8FromRaw(rawB64: string): string {
  const raw = Buffer.from(rawB64, 'base64url');
  const prefix = Buffer.from(
    '308141020100301306072a8648ce3d020106082a8648ce3d030107042730250201010420',
    'hex',
  );
  const der = Buffer.concat([prefix, raw]);
  return `-----BEGIN PRIVATE KEY-----\n${der.toString('base64').replace(/(.{64})/g, '$1\n')}\n-----END PRIVATE KEY-----\n`;
}

/** توقيع DER إلى الصيغة المسطّحة (r‖s) التي يطلبها JOSE */
function derToJose(der: Buffer): Buffer {
  let off = 2;
  if (der[1]! & 0x80) off += der[1]! & 0x7f;
  const rLen = der[off + 1]!;
  const r = der.subarray(off + 2, off + 2 + rLen);
  const sOff = off + 2 + rLen;
  const sLen = der[sOff + 1]!;
  const sBuf = der.subarray(sOff + 2, sOff + 2 + sLen);
  const pad = (b: Buffer) => {
    const t = b[0] === 0 ? b.subarray(1) : b;
    return Buffer.concat([Buffer.alloc(Math.max(0, 32 - t.length)), t]);
  };
  return Buffer.concat([pad(r), pad(sBuf)]);
}

@Injectable()
export class PushService {
  constructor(@Inject(PrismaService) private prisma: PrismaService) {}

  publicKey() {
    if (!pushConfigured()) return null;
    return VAPID_PUBLIC;
  }

  async subscribe(b: {
    endpoint: string; keys: { p256dh: string; auth: string };
    phone?: string; userAgent?: string; userPublicId?: string;
  }) {
    if (!b.endpoint?.startsWith('https://') || !b.keys?.p256dh || !b.keys?.auth) {
      throw Errors.badRequest('SUBSCRIPTION_INVALID', 'بيانات الاشتراك ناقصة', 'Invalid subscription');
    }
    const user = b.userPublicId
      ? await this.prisma.user.findUnique({ where: { publicId: b.userPublicId } })
      : null;

    const row = await this.prisma.pushSubscription.upsert({
      where: { endpoint: b.endpoint },
      update: {
        p256dh: b.keys.p256dh, auth: b.keys.auth,
        userId: user?.id ?? undefined, phone: b.phone ?? undefined,
        isActive: true, failCount: 0,
      },
      create: {
        endpoint: b.endpoint, p256dh: b.keys.p256dh, auth: b.keys.auth,
        userId: user?.id, phone: b.phone, userAgent: b.userAgent,
      },
    });
    return { subscribed: true, id: row.id };
  }

  async unsubscribe(endpoint: string) {
    await this.prisma.pushSubscription.updateMany({
      where: { endpoint }, data: { isActive: false },
    });
    return { unsubscribed: true };
  }

  /**
   * إرسال إشعار إلى كل أجهزة رقم بعينه.
   * الإرسال بلا حمولة: العنوان والنص يصلان عبر إشعار عام والتطبيق يجلب
   * التفاصيل. تشفير الحمولة يحتاج ECDH وHKDF ومكتبة كاملة، ومقابله
   * ضئيل هنا — الزبون سيفتح الطلب على أي حال.
   */
  async sendToPhone(phone: string, title: string, body: string, url?: string) {
    if (!pushConfigured()) return { sent: 0, skipped: 'VAPID_NOT_CONFIGURED' as const };

    const subs = await this.prisma.pushSubscription.findMany({
      where: { phone, isActive: true }, take: 10,
    });
    if (!subs.length) return { sent: 0 };

    let sent = 0;
    for (const s of subs) {
      try {
        const aud = new URL(s.endpoint).origin;
        const res = await fetch(s.endpoint, {
          method: 'POST',
          headers: {
            TTL: '86400',
            Authorization: `vapid t=${signVapidJwt(aud)}, k=${VAPID_PUBLIC}`,
            'Content-Length': '0',
          },
          signal: AbortSignal.timeout(8000),
        });

        /* 404 و410 يعنيان أن الاشتراك مات: المتصفح أُلغي تثبيته أو
           مُسحت بياناته. إبقاؤه نشطاً يعني محاولات أبدية إلى عنوان ميت. */
        if (res.status === 404 || res.status === 410) {
          await this.prisma.pushSubscription.update({
            where: { id: s.id }, data: { isActive: false },
          });
          continue;
        }
        if (res.ok || res.status === 201) {
          sent++;
          await this.prisma.pushSubscription.update({
            where: { id: s.id }, data: { lastSentAt: new Date(), failCount: 0 },
          });
        } else {
          await this.prisma.pushSubscription.update({
            where: { id: s.id },
            data: { failCount: { increment: 1 }, isActive: s.failCount + 1 < 5 },
          });
        }
      } catch {
        await this.prisma.pushSubscription.update({
          where: { id: s.id },
          data: { failCount: { increment: 1 }, isActive: s.failCount + 1 < 5 },
        });
      }
    }
    return { sent };
  }
}

@Controller('push')
export class PushController {
  constructor(@Inject(PushService) private p: PushService) {}

  /** المتصفح يحتاج المفتاح العام قبل أن يطلب الإذن */
  @Get('key')
  async key() {
    const k = this.p.publicKey();
    return { data: { publicKey: k, enabled: Boolean(k) } };
  }

  @Post('subscribe')
  @MaybeAuth()
  async subscribe(@Body() b: any, @Req() req: any) {
    return { data: await this.p.subscribe({ ...b, userPublicId: req.user?.sub }) };
  }

  @Post('unsubscribe')
  async unsubscribe(@Body() b: { endpoint: string }) {
    return { data: await this.p.unsubscribe(b.endpoint) };
  }
}
