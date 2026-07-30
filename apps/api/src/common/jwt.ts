import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';

/*
  مفتاح توقيع الجلسات.

  كانت له قيمة افتراضية تسقط إليها الشيفرة صامتةً، وهي مكتوبة في مستودعٍ
  يقرؤه من شاء: من يعرفها يوقّع لنفسه رمز مدير. وقياسُ الإنتاج أثبت أن
  السرّ لم يكن مضبوطاً أصلاً — أي أن المتجر عمل أياماً بمفتاحٍ منشور.

  والحلّ ليس أن يتوقّف المتجر حتى يضبطه صاحبه: عطلٌ كامل ثمنٌ باهظ لخطأ
  إعداد، وصاحب المحل قد يكون نائماً. المفتاح يُولَّد عشوائياً عند أول
  طلب ويُحفظ في KV، فيبقى ثابتاً بين النشرات ولا يعرفه أحد — لا نحن ولا
  قارئ المستودع.

  وترتيب المصادر مقصود: سرُّ المنصّة أولاً إن ضُبط، فهو الأصل ويُدار
  ويُدوَّر بأدواتها. ثم المولَّد المحفوظ. والافتراضي للتطوير المحلي وحده.
  وضبطُ السرّ لاحقاً يُبطل الجلسات القائمة — وهو الصواب: مفتاحٌ تبدّل
  يعني جلسات وُقِّعت بغيره.
*/
const DEV_SECRET = 'dev_only_change_me';
let SECRET = process.env.JWT_SECRET ?? DEV_SECRET;

/** هل ما زلنا على الافتراضي؟ يستعمله الـWorker ليقرّر التوليد */
export const usingDefaultSecret = () => SECRET === DEV_SECRET;

/** يُضبط مرة واحدة عند أول طلب في العزلة، قبل أي توقيع أو تحقّق */
export function setSecret(s: string) {
  if (s && s !== DEV_SECRET) SECRET = s;
}

const b64u = (b: Buffer | string) =>
  Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

export interface Claims {
  sub: string;          // معرّف المستخدم العام
  role: string;
  tv: number;           // نسخة الرمز — رفعها يُبطل كل الجلسات فوراً
  jti: string;
  /// معرّف الجلسة: يسمح بإسقاط جهاز واحد بدل إخراج صاحبه من كل أجهزته
  sid?: string;
  exp: number;
  typ: 'access' | 'refresh';
}

function sign(payload: Claims) {
  const head = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64u(JSON.stringify(payload));
  const mac = b64u(createHmac('sha256', SECRET).update(`${head}.${body}`).digest());
  return `${head}.${body}.${mac}`;
}

export function issue(sub: string, role: string, tv: number, sid?: string) {
  const now = Math.floor(Date.now() / 1000);
  /* معرّف رمز التحديث يُعاد مع الرمز: الجلسة تحفظه لتعرف أيُّ رمزٍ هو
     الصالح الآن. وبدونه لا تدوير — إذ لا سبيل إلى تمييز الجديد من
     القديم، وكلاهما موقَّعٌ توقيعاً صحيحاً. */
  const refreshJti = randomUUID();
  return {
    accessToken: sign({ sub, role, tv, sid, jti: randomUUID(), exp: now + 15 * 60, typ: 'access' }),
    refreshToken: sign({ sub, role, tv, sid, jti: refreshJti, exp: now + 30 * 86400, typ: 'refresh' }),
    expiresIn: 15 * 60,
    refreshJti,
  };
}

export function verify(token: string): Claims | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [head, body, mac] = parts as [string, string, string];
  const expected = createHmac('sha256', SECRET).update(`${head}.${body}`).digest();
  const got = unb64u(mac);
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) return null;
  try {
    const claims = JSON.parse(unb64u(body).toString()) as Claims;
    if (claims.exp < Math.floor(Date.now() / 1000)) return null;
    return claims;
  } catch { return null; }
}
