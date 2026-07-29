/**
 * منح دور لمستخدم (أو إنشاؤه إن لم يوجد).
 *
 *   pnpm --filter @talisham/api grant-role +963900000001 ADMIN "مدير المتجر"
 *
 * تسجيل الدخول برمز OTP يُنشئ حساب زبون فقط — وهذا مقصود:
 * لا يجوز أن يمنح أحدٌ نفسَه صلاحية إدارية من الواجهة.
 * الترقية تتم من الخادم عبر هذا السكربت وحده.
 */
import { PrismaClient, UserRole } from '@prisma/client';
import { randomBytes } from 'node:crypto';

const prisma = new PrismaClient();
const SY_PHONE = /^\+9639[0-9]{8}$/;
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Base32 (Crockford) بلا I O U L

function publicId(): string {
  const b = randomBytes(12);
  let out = '';
  for (let i = 0; i < 12; i++) out += ALPHABET[b[i]! % 32];
  return out;
}

async function main() {
  const [phone, roleArg, ...nameParts] = process.argv.slice(2);
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

  const verb = existing ? (existing.role === role ? 'بقي' : `رُقّي من ${existing.role} إلى`) : 'أُنشئ بدور';
  console.log(`${verb} ${user.role}: ${user.phoneE164} (${user.publicId})`);
  if (existing && existing.role !== role) {
    console.log(`أُبطلت جلساته السابقة — token_version = ${user.tokenVersion}`);
  }
  console.log('الدخول: اطلب رمزاً من /auth/otp/request بهذا الرقم ثم أكّده.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
