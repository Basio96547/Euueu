import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

/** promisify يفقد التحميل الزائد ذا الخيارات، فيُلَفّ يدوياً */
const scryptAsync = (
  pw: string | Buffer, salt: string | Buffer, keylen: number,
  opts: { N: number; r: number; p: number },
): Promise<Buffer> =>
  new Promise((res, rej) =>
    scrypt(pw, salt, keylen, { ...opts, maxmem: 64 * 1024 * 1024 }, (e, k) => (e ? rej(e) : res(k))));

/**
 * تجزئة كلمات سرّ الموظّفين — scrypt من مكتبة Node القياسية.
 *
 * لا bcrypt ولا argon2: كلاهما اعتماد ثنائي يُبنى عند التثبيت ويكسر
 * النشر على معمارية مختلفة، وscrypt المدمج كافٍ لعشرات الحسابات
 * الإدارية بمعاملات مضبوطة صراحةً.
 *
 * لكل كلمة ملحٌ خاص بها: بلا ملح تُكشف كلمتان متطابقتان لموظّفَين
 * بمجرد النظر إلى الجدول، وتُهزم القائمة كلها بجدول قوس قزح واحد.
 *
 * المعاملات مكتوبة داخل التجزئة نفسها، فرفعها لاحقاً لا يُبطل الكلمات
 * القديمة — كلٌّ تُتحقَّق بالمعاملات التي أُنشئت بها.
 */
const N = 16384;   // كلفة المعالجة
const r = 8;
const p = 1;
const KEYLEN = 64;

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(plain.normalize('NFKC'), salt, KEYLEN, { N, r, p });
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  try {
    const [algo, sN, sr, sp, salt64, key64] = stored.split('$');
    if (algo !== 'scrypt') return false;
    const key = Buffer.from(key64!, 'base64');
    const candidate = await scryptAsync(
      plain.normalize('NFKC'),
      Buffer.from(salt64!, 'base64'),
      key.length,
      { N: Number(sN), r: Number(sr), p: Number(sp) },
    );
    // مقارنة ثابتة الزمن: المقارنة العادية تُسرّب طول البادئة الصحيحة
    return candidate.length === key.length && timingSafeEqual(candidate, key);
  } catch {
    return false;
  }
}

export interface PasswordCheck { ok: boolean; reason?: string }

/**
 * الحد الأدنى للقبول.
 * ليس تعقيداً مصطنعاً برموز وأرقام إلزامية — ذلك يدفع الناس إلى
 * «Password1!» ثم إلى ورقة ملصقة على الشاشة. الطول هو ما يهمّ فعلاً،
 * ومنعُ أسوأ الشائع يكفي للباقي.
 */
const COMMON = new Set([
  '12345678', '123456789', 'password', 'password1', 'qwerty123',
  'admin123', '11111111', 'talisham', 'talisham1',
]);

export function checkPasswordStrength(plain: string): PasswordCheck {
  const v = plain.normalize('NFKC');
  if (v.length < 10) {
    return { ok: false, reason: 'كلمة السرّ عشرة محارف على الأقل' };
  }
  if (v.length > 200) {
    return { ok: false, reason: 'كلمة السرّ أطول من اللازم' };
  }
  if (COMMON.has(v.toLowerCase())) {
    return { ok: false, reason: 'كلمة السرّ شائعة جداً — اختر غيرها' };
  }
  if (/^(.)\1+$/.test(v)) {
    return { ok: false, reason: 'كلمة السرّ محرف واحد مكرَّر' };
  }
  return { ok: true };
}
