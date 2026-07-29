/**
 * منح دور لمستخدم (أو إنشاؤه إن لم يوجد).
 *
 *   pnpm --filter @talisham/api grant-role +963900000001 ADMIN "مدير المتجر"
 *   pnpm --filter @talisham/api grant-role +963900000001 ADMIN "الاسم" --password
 *
 * مع --password تُقرأ كلمة السرّ من المدخل لا من سطر الأوامر: الوسائط
 * تبقى في سجل الصدفة وفي `ps` لكل من على الجهاز.
 *
 * تسجيل الدخول برمز OTP يُنشئ حساب زبون فقط — وهذا مقصود:
 * لا يجوز أن يمنح أحدٌ نفسَه صلاحية إدارية من الواجهة.
 * الترقية تتم من الخادم عبر هذا السكربت وحده.
 */
import { PrismaClient, UserRole } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { checkPasswordStrength, hashPassword } from '../src/common/password.js';

const prisma = new PrismaClient();
const SY_PHONE = /^\+9639[0-9]{8}$/;
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Base32 (Crockford) بلا I O U L

function publicId(): string {
  const b = randomBytes(12);
  let out = '';
  for (let i = 0; i < 12; i++) out += ALPHABET[b[i]! % 32];
  return out;
}

async function readSecret(prompt: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try { return (await rl.question(prompt)).trim(); }
  finally { rl.close(); }
}

async function main() {
  const argv = process.argv.slice(2);
  const wantsPassword = argv.includes('--password');
  const rest = argv.filter((a) => a !== '--password');
  const [phone, roleArg, ...nameParts] = rest;
  const fullName = nameParts.join(' ') || null;

  if (!phone || !roleArg) {
    console.error('الاستخدام: grant-role <+9639XXXXXXXX> <ROLE> [الاسم]');
    console.error(`الأدوار: ${Object.keys(UserRole).join(' | ')}`);
    process.exit(1);
  }
  if (!SY_PHONE.test(phone)) {
    console.error(`رقم غير صالح: ${phone} — الصيغة المطلوبة +9639XXXXXXXX`);
    process.exit(1);
  }
  if (!(roleArg in UserRole)) {
    console.error(`دور غير معروف: ${roleArg}`);
    console.error(`الأدوار: ${Object.keys(UserRole).join(' | ')}`);
    process.exit(1);
  }
  const role = roleArg as UserRole;

  const existing = await prisma.user.findUnique({ where: { phoneE164: phone } });

  // تغيير الدور يُبطل الجلسات القائمة: رمز صادر بدور قديم يجب ألا يبقى صالحاً
  const user = existing
    ? await prisma.user.update({
        where: { phoneE164: phone },
        data: {
          role,
          deletedAt: null,
          tokenVersion: existing.role === role ? existing.tokenVersion : { increment: 1 },
          ...(fullName ? { fullName } : {}),
        },
      })
    : await prisma.user.create({
        data: { publicId: publicId(), phoneE164: phone, role, fullName },
      });

  if (wantsPassword) {
    const pw = process.env.STAFF_PASSWORD ?? await readSecret('كلمة السرّ الجديدة: ');
    const check = checkPasswordStrength(pw);
    if (!check.ok) { console.error(`كلمة السرّ مرفوضة: ${check.reason}`); process.exit(1); }
    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await hashPassword(pw),
        passwordSetAt: new Date(),
        failedLogins: 0, lockedUntil: null,
        // ضبط كلمة سرّ يُبطل الجلسات القائمة كتغييرها سواءً بسواء
        tokenVersion: { increment: 1 },
      },
    });
    console.log('ضُبطت كلمة السرّ وأُبطلت الجلسات السابقة.');
  }

  const verb = existing ? (existing.role === role ? 'بقي' : `رُقّي من ${existing.role} إلى`) : 'أُنشئ بدور';
  console.log(`${verb} ${user.role}: ${user.phoneE164} (${user.publicId})`);
  if (existing && existing.role !== role) {
    console.log(`أُبطلت جلساته السابقة — token_version = ${user.tokenVersion}`);
  }
  console.log(wantsPassword
    ? 'الدخول: من لوحة التحكم بالرقم وكلمة السرّ، أو برمز واتساب.'
    : 'الدخول: اطلب رمزاً من /auth/otp/request بهذا الرقم ثم أكّده.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
