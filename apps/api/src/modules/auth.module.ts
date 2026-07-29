import { Body, Controller, Get, Inject, Injectable, Post, Req } from '@nestjs/common';
import { createHash, randomInt } from 'node:crypto';
import { PrismaService } from '../common/prisma.service.js';
import { NotificationsService } from './notifications.service.js';
import { Errors } from '../common/errors.js';
import { publicId } from '../common/money.js';
import { issue, verify } from '../common/jwt.js';
import { Protect } from '../common/guards.js';

const OTP_LEN = Number(process.env.OTP_LENGTH ?? 6);
const OTP_TTL = Number(process.env.OTP_TTL_SECONDS ?? 300);
const MAX_VERIFY_ATTEMPTS = 5;
const LOCK_MINUTES = 15;
const RESEND_COOLDOWN_SEC = 60;
const SY_PHONE = /^\+9639[0-9]{8}$/;
/** كل دور مسجَّل — للمسارات التي تلزمها هوية لا صلاحية بعينها */
const ANY_ROLE = ['CUSTOMER', 'SUPPORT', 'CATALOG_ADMIN', 'OPS_MANAGER', 'WAREHOUSE', 'COURIER', 'ADMIN'];

interface Otp {
  hash: string; expiresAt: number; attempts: number;
  lockedUntil: number; lastSentAt: number;
}

@Injectable()
export class AuthService {
  /** في الإنتاج يُستبدل بـ Redis؛ البنية نفسها (مفتاح ← سجل بمهلة) */
  private codes = new Map<string, Otp>();

  constructor(
    @Inject(PrismaService) private prisma: PrismaService,
    @Inject(NotificationsService) private notify: NotificationsService,
  ) {}

  private hash(phone: string, code: string) {
    return createHash('sha256').update(`${phone}:${code}:${process.env.JWT_SECRET ?? ''}`).digest('hex');
  }

  async request(phone: string) {
    if (!SY_PHONE.test(phone)) {
      throw Errors.badRequest('PHONE_INVALID',
        'رقم الجوال يجب أن يبدأ بـ +9639 ويتكوّن من اثنتي عشرة خانة',
        'Phone must match +9639XXXXXXXX');
    }
    const now = Date.now();
    const cur = this.codes.get(phone);
    if (cur && cur.lockedUntil > now) {
      throw Errors.badRequest('ACCOUNT_TEMP_LOCKED',
        `الرقم مقفل مؤقتاً — أعد المحاولة بعد ${Math.ceil((cur.lockedUntil - now) / 60000)} دقيقة`,
        'Temporarily locked');
    }
    if (cur && now - cur.lastSentAt < RESEND_COOLDOWN_SEC * 1000) {
      throw Errors.badRequest('OTP_COOLDOWN',
        `انتظر ${Math.ceil((RESEND_COOLDOWN_SEC * 1000 - (now - cur.lastSentAt)) / 1000)} ثانية قبل إعادة الإرسال`,
        'Resend cooldown');
    }

    const code = String(randomInt(0, 10 ** OTP_LEN)).padStart(OTP_LEN, '0');
    this.codes.set(phone, {
      hash: this.hash(phone, code),
      expiresAt: now + OTP_TTL * 1000,
      attempts: 0, lockedUntil: 0, lastSentAt: now,
    });

    // واتساب أولاً وSMS احتياطياً — الموجّه يتولى التصعيد (الفصل 20)
    await this.notify.send({
      type: 'auth.otp', level: 'P0', to: phone, entityId: phone,
      title: 'رمز الدخول',
      body: `رمزك ${code} — صالح ${Math.round(OTP_TTL / 60)} دقائق. لا تشاركه مع أحد.`,
    });

    return {
      sent: true, channel: 'WHATSAPP_THEN_SMS',
      expiresInSec: OTP_TTL,
      // في التطوير يُعاد الرمز لتيسير الاختبار؛ ممنوع في الإنتاج
      ...(process.env.NODE_ENV === 'production' ? {} : { devCode: code }),
    };
  }

  async verifyCode(phone: string, code: string) {
    const now = Date.now();
    const rec = this.codes.get(phone);
    if (!rec) throw Errors.badRequest('OTP_INVALID', 'اطلب رمزاً جديداً', 'Request a new code');
    if (rec.lockedUntil > now) {
      throw Errors.badRequest('ACCOUNT_TEMP_LOCKED', 'الرقم مقفل مؤقتاً', 'Temporarily locked');
    }
    if (rec.expiresAt < now) {
      this.codes.delete(phone);
      throw Errors.badRequest('OTP_EXPIRED', 'انتهت صلاحية الرمز', 'Code expired');
    }

    rec.attempts++;
    if (this.hash(phone, code) !== rec.hash) {
      if (rec.attempts >= MAX_VERIFY_ATTEMPTS) {
        rec.lockedUntil = now + LOCK_MINUTES * 60_000;
        throw Errors.badRequest('ACCOUNT_TEMP_LOCKED',
          `خمس محاولات خاطئة — قُفل الرقم ${LOCK_MINUTES} دقيقة`, 'Locked after 5 attempts');
      }
      throw Errors.badRequest('OTP_INVALID',
        `رمز غير صحيح — بقيت ${MAX_VERIFY_ATTEMPTS - rec.attempts} محاولات`, 'Invalid code');
    }

    this.codes.delete(phone);
    const user = await this.prisma.user.upsert({
      where: { phoneE164: phone },
      update: { phoneVerifiedAt: new Date() },
      create: { publicId: publicId(), phoneE164: phone, phoneVerifiedAt: new Date() },
    });

    const tokens = issue(user.publicId, user.role, user.tokenVersion);
    return { ...tokens, user: { publicId: user.publicId, role: user.role, phone: user.phoneE164 } };
  }

  async refresh(token: string) {
    const claims = verify(token);
    if (!claims || claims.typ !== 'refresh') {
      throw Errors.badRequest('TOKEN_INVALID', 'رمز التحديث غير صالح', 'Invalid refresh token');
    }
    const user = await this.prisma.user.findUnique({ where: { publicId: claims.sub } });
    if (!user || user.tokenVersion !== claims.tv) {
      throw Errors.badRequest('SESSION_REVOKED', 'أُبطلت الجلسة', 'Session revoked');
    }
    return issue(user.publicId, user.role, user.tokenVersion);
  }

  async me(publicIdValue: string) {
    const u = await this.prisma.user.findUnique({ where: { publicId: publicIdValue } });
    if (!u) throw Errors.notFound('المستخدم');
    return {
      publicId: u.publicId, phone: u.phoneE164, role: u.role,
      fullName: u.fullName, locale: u.locale, displayCurrency: u.displayCurrency,
    };
  }

  /** الخروج من كل الأجهزة: رفع النسخة يُسقط كل الرموز الصادرة */
  async revokeAll(publicIdValue: string) {
    const u = await this.prisma.user.update({
      where: { publicId: publicIdValue },
      data: { tokenVersion: { increment: 1 } },
    });
    return { revoked: true, tokenVersion: u.tokenVersion };
  }
}

@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthService) private auth: AuthService) {}

  @Post('otp/request')
  async request(@Body() b: { phone: string }) { return { data: await this.auth.request(b.phone) }; }

  @Post('otp/verify')
  async verify(@Body() b: { phone: string; code: string }) {
    return { data: await this.auth.verifyCode(b.phone, b.code) };
  }

  @Post('refresh')
  async refresh(@Body() b: { refreshToken: string }) { return { data: await this.auth.refresh(b.refreshToken) }; }

  @Get('me')
  @Protect(...ANY_ROLE)
  async me(@Req() req: { user?: { sub: string } }) {
    return { data: await this.auth.me(req.user!.sub) };
  }

  // الهوية تُؤخذ من الرمز لا من الجسم — وإلا أبطل أحدهم جلسات غيره
  @Post('sessions/revoke-all')
  @Protect(...ANY_ROLE)
  async revoke(@Req() req: { user?: { sub: string } }) {
    return { data: await this.auth.revokeAll(req.user!.sub) };
  }
}
