import { createHash, randomInt } from 'node:crypto';
import { PrismaService } from '../common/prisma.service.js';
import { NotificationsService } from './notifications.service.js';
import { Errors } from '../common/errors.js';
import { publicId } from '../common/money.js';
import { issue, verify } from '../common/jwt.js';
import { checkPasswordStrength, hashPassword, verifyPassword } from '../common/password.js';
import { kv } from '../common/kv.js';

const OTP_LEN = Number(process.env.OTP_LENGTH ?? 6);
const OTP_TTL = Number(process.env.OTP_TTL_SECONDS ?? 300);
const MAX_VERIFY_ATTEMPTS = 5;
const LOCK_MINUTES = 15;
const RESEND_COOLDOWN_SEC = 60;
const SY_PHONE = /^\+9639[0-9]{8}$/;
/** الأدوار التي يجوز لها الدخول بكلمة سرّ — الزبون يدخل برمز وحده */
const STAFF_ROLES = new Set(['SUPPORT', 'CATALOG_ADMIN', 'OPS_MANAGER', 'WAREHOUSE', 'COURIER', 'ADMIN']);
const MAX_PASSWORD_ATTEMPTS = 5;
const PASSWORD_LOCK_MINUTES = 15;

/** كل دور مسجَّل — للمسارات التي تلزمها هوية لا صلاحية بعينها */

interface Otp {
  hash: string; expiresAt: number; attempts: number;
  lockedUntil: number; lastSentAt: number;
}

export class AuthService {
  /* الرموز في مخزن مشترك: رمزٌ يُولَّد في نسخة ويُتحقَّق منه في أخرى
     يُرفض بلا سبب مفهوم للزبون — وهو أسوأ أعطال التوسّع لأنه صامت. */
  private key(phone: string) { return `otp:${phone}`; }
  private async load(phone: string) { return kv().get<Otp>(this.key(phone)); }
  private async save(phone: string, rec: Otp) {
    // المهلة تغطي عمر الرمز والقفل معاً: أطولهما هو ما يجب أن يبقى
    const ttl = Math.max(60, Math.ceil((Math.max(rec.expiresAt, rec.lockedUntil) - Date.now()) / 1000));
    await kv().set(this.key(phone), rec, ttl);
  }

  constructor(
    private prisma: PrismaService,
    private notify: NotificationsService,
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
    const cur = await this.load(phone);
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
    await this.save(phone, {
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

  async verifyCode(phone: string, code: string, meta?: { userAgent?: string; ip?: string | null }) {
    const now = Date.now();
    const rec = await this.load(phone);
    if (!rec) throw Errors.badRequest('OTP_INVALID', 'اطلب رمزاً جديداً', 'Request a new code');
    if (rec.lockedUntil > now) {
      throw Errors.badRequest('ACCOUNT_TEMP_LOCKED', 'الرقم مقفل مؤقتاً', 'Temporarily locked');
    }
    if (rec.expiresAt < now) {
      await kv().del(this.key(phone));
      throw Errors.badRequest('OTP_EXPIRED', 'انتهت صلاحية الرمز', 'Code expired');
    }

    rec.attempts++;
    if (this.hash(phone, code) !== rec.hash) {
      if (rec.attempts >= MAX_VERIFY_ATTEMPTS) {
        rec.lockedUntil = now + LOCK_MINUTES * 60_000;
        await this.save(phone, rec);
        throw Errors.badRequest('ACCOUNT_TEMP_LOCKED',
          `خمس محاولات خاطئة — قُفل الرقم ${LOCK_MINUTES} دقيقة`, 'Locked after 5 attempts');
      }
      await this.save(phone, rec);
      throw Errors.badRequest('OTP_INVALID',
        `رمز غير صحيح — بقيت ${MAX_VERIFY_ATTEMPTS - rec.attempts} محاولات`, 'Invalid code');
    }

    await kv().del(this.key(phone));
    const user = await this.prisma.user.upsert({
      where: { phoneE164: phone },
      update: { phoneVerifiedAt: new Date() },
      create: { publicId: publicId(), phoneE164: phone, phoneVerifiedAt: new Date() },
    });

    const sid = await this.openSession(user.id, meta);
    const tokens = issue(user.publicId, user.role, user.tokenVersion, sid);
    return { ...tokens, user: { publicId: user.publicId, role: user.role, phone: user.phoneE164 } };
  }


  /**
   * جلسة لكل تسجيل دخول.
   * `token_version` سلاح ثقيل يُسقط كل الأجهزة دفعة واحدة؛ ومن ضاع
   * هاتفه يريد إسقاط ذلك الجهاز وحده. فصار لكل دخول صفٌّ يُرى ويُبطَل.
   */
  private async openSession(userId: string, meta?: { userAgent?: string; ip?: string | null }) {
    const session = await this.prisma.session.create({
      data: {
        userId,
        userAgent: meta?.userAgent?.slice(0, 200) || null,
        ip: meta?.ip ?? null,
      },
    });
    return session.id;
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
    /* جلسة مُبطَلة لا تُجدَّد: وإلا كان إسقاط الجهاز الضائع مهلةَ ربع
       ساعة يستأنف بعدها من تلقاء نفسه. */
    if (claims.sid) {
      const session = await this.prisma.session.findUnique({ where: { id: claims.sid } });
      if (!session || session.revokedAt) {
        throw Errors.badRequest('SESSION_REVOKED', 'أُبطلت هذه الجلسة', 'Session revoked');
      }
      await this.prisma.session.update({ where: { id: claims.sid }, data: { lastSeenAt: new Date() } });
    }
    return issue(user.publicId, user.role, user.tokenVersion, claims.sid);
  }

  /**
   * الدخول بكلمة سرّ — للموظّفين وحدهم.
   *
   * رسالة الفشل واحدة مهما كان السبب: رقم غير موجود، أو بلا كلمة سرّ،
   * أو كلمة خاطئة. تمييزُها يحوّل نموذج الدخول إلى أداة تعداد: يجرّب
   * المهاجم أرقاماً حتى يعرف أيّها موظّف، ثم يركّز عليه وحده.
   */
  async loginWithPassword(phone: string, password: string, meta?: { userAgent?: string; ip?: string | null }) {
    const fail = () => Errors.badRequest('LOGIN_FAILED',
      'الرقم أو كلمة السرّ غير صحيحة', 'Invalid credentials');

    if (!SY_PHONE.test(phone) || !password) throw fail();

    const user = await this.prisma.user.findUnique({ where: { phoneE164: phone } });
    if (!user || user.deletedAt || !user.passwordHash || !STAFF_ROLES.has(user.role)) {
      throw fail();
    }

    const now = new Date();
    if (user.lockedUntil && user.lockedUntil > now) {
      const mins = Math.ceil((user.lockedUntil.getTime() - now.getTime()) / 60_000);
      throw Errors.badRequest('ACCOUNT_TEMP_LOCKED',
        `الحساب مقفل مؤقتاً — أعد المحاولة بعد ${mins} دقيقة`, 'Temporarily locked');
    }

    if (!(await verifyPassword(password, user.passwordHash))) {
      const attempts = user.failedLogins + 1;
      const locks = attempts >= MAX_PASSWORD_ATTEMPTS;
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          failedLogins: locks ? 0 : attempts,
          lockedUntil: locks ? new Date(now.getTime() + PASSWORD_LOCK_MINUTES * 60_000) : null,
        },
      });
      if (locks) {
        throw Errors.badRequest('ACCOUNT_TEMP_LOCKED',
          `خمس محاولات خاطئة — قُفل الحساب ${PASSWORD_LOCK_MINUTES} دقيقة`, 'Locked after 5 attempts');
      }
      throw fail();
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLogins: 0, lockedUntil: null },
    });

    const sid = await this.openSession(user.id, meta);
    const tokens = issue(user.publicId, user.role, user.tokenVersion, sid);
    return { ...tokens, user: { publicId: user.publicId, role: user.role, phone: user.phoneE164 } };
  }

  /** تغيير كلمة السرّ: تُبطل كل الجلسات — تغييرها إعلانُ أن القديمة لم تعد تُؤتمن */
  async changePassword(publicIdValue: string, current: string, next: string) {
    const user = await this.prisma.user.findUnique({ where: { publicId: publicIdValue } });
    if (!user) throw Errors.notFound('المستخدم');
    if (!STAFF_ROLES.has(user.role)) {
      throw Errors.badRequest('PASSWORD_NOT_APPLICABLE',
        'حسابات الزبائن تدخل برمز واتساب ولا كلمة سرّ لها', 'Password not applicable');
    }
    if (user.passwordHash && !(await verifyPassword(current, user.passwordHash))) {
      throw Errors.badRequest('CURRENT_PASSWORD_WRONG', 'كلمة السرّ الحالية غير صحيحة', 'Current password wrong');
    }
    const check = checkPasswordStrength(next);
    if (!check.ok) throw Errors.badRequest('PASSWORD_WEAK', check.reason!, 'Password too weak');

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await hashPassword(next),
        passwordSetAt: new Date(),
        failedLogins: 0, lockedUntil: null,
        tokenVersion: { increment: 1 },
      },
    });
    return { changed: true, note: 'أُبطلت كل الجلسات — سجّل الدخول من جديد.' };
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
    /* وصفوف الجلسات معها: رمزٌ أُبطل وجلسةٌ تبقى «نشطة» في قائمة
       أجهزتي تكذب على صاحبها في أخطر شاشة يملكها. */
    await this.prisma.session.updateMany({
      where: { userId: u.id, revokedAt: null }, data: { revokedAt: new Date() },
    });
    return { revoked: true, tokenVersion: u.tokenVersion };
  }
}

