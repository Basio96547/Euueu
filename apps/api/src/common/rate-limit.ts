import type { MiddlewareHandler } from 'hono';
import { HttpStatus } from './http-status.js';
import { ApiError } from './errors.js';
import { kv } from './kv.js';

type Rule = { limit: number; windowSec: number; by: 'ip' | 'user' | 'phone' };

/**
 * حدود المعدل — القيم من جدول الفصل 9 وهو مصدرها الوحيد.
 * العدّاد في KV لا في ذاكرة العملية: نسختان بعدّادين منفصلين تعنيان
 * ضِعف الحدّ المكتوب — وهو حدٌّ لا يحمي شيئاً. وعلى Worker العزلات
 * كثيرة بطبعها، فالمخزن المشترك هناك شرطُ صحّةٍ لا تحسين.
 */
const RULES: Array<[RegExp, string, Rule]> = [
  [/^\/api\/v1\/auth\/otp\/request$/, 'POST', { limit: 5, windowSec: 3600, by: 'phone' }],
  [/^\/api\/v1\/auth\/otp\/request$/, 'POST', { limit: 20, windowSec: 3600, by: 'ip' }],
  [/^\/api\/v1\/auth\/otp\/verify$/, 'POST', { limit: 5, windowSec: 900, by: 'phone' }],
  // تخمين كلمة السرّ أرخص من تخمين رمز: الحدّ أضيق والنافذة أطول
  [/^\/api\/v1\/auth\/password\/login$/, 'POST', { limit: 10, windowSec: 900, by: 'phone' }],
  [/^\/api\/v1\/auth\/password\/login$/, 'POST', { limit: 30, windowSec: 900, by: 'ip' }],
  [/^\/api\/v1\/orders$/, 'POST', { limit: 5, windowSec: 3600, by: 'ip' }],
  [/^\/api\/v1\/search/, 'GET', { limit: 60, windowSec: 60, by: 'ip' }],
  [/^\/api\/v1\/warranties\/verify/, 'GET', { limit: 20, windowSec: 3600, by: 'ip' }],
  [/^\/api\/v1\/orders\/[^/]+\/track/, 'GET', { limit: 10, windowSec: 3600, by: 'ip' }],
  [/^\/api\/v1\/admin\/fx$/, 'POST', { limit: 20, windowSec: 86400, by: 'ip' }],
  [/^\/api\/v1\/courier\//, 'POST', { limit: 300, windowSec: 3600, by: 'ip' }],
];

/** الحد الافتراضي العام: غير مقصود لأي عملية حساسة */
const DEFAULT: Rule = { limit: 60, windowSec: 60, by: 'ip' };

/**
 * مضاعِف للبيئات غير الإنتاجية.
 * فحص من طرف إلى طرف يُنشئ عشرات الطلبات في دقائق، وهو سلوك يجب أن
 * يوقفه الحدُّ في الإنتاج. فبدل إضعاف القاعدة نفسها — وهو ما يُنسى
 * ويُشحن — يُرفع السقف بمتغيّر بيئة يبقى واحداً حيث يهمّ.
 * ويُتجاهل في الإنتاج مهما ضُبط: القاعدة هناك ليست محلّ تفاوض.
 */
function factor(env: Record<string, unknown>) {
  return env.NODE_ENV === 'production'
    ? 1
    : Math.max(1, Number(env.RATE_LIMIT_FACTOR ?? 1));
}

function clientIp(c: any): string {
  return (
    c.req.header('cf-connecting-ip') ??
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
    c.env?.remoteAddr ??
    'anon'
  );
}

export const rateLimit = (env: Record<string, unknown>): MiddlewareHandler =>
  async (c, next) => {
    const path = new URL(c.req.url).pathname;
    const method = c.req.method;
    const f = factor(env);
    const matched = RULES.filter(([re, m]) => m === method && re.test(path)).map(([, , r]) => r);
    const rules = (matched.length ? matched : [DEFAULT])
      .map((r) => (f === 1 ? r : { ...r, limit: r.limit * f }));

    /* الموضوع «هاتف» يُقرأ من الجسم، وقراءته هنا تستهلك التيار.
       Hono يخزّن الجسم المقروء مؤقتاً فيبقى متاحاً للمعالِج بعدها. */
    let phone = 'anon';
    if (rules.some((r) => r.by === 'phone')) {
      try {
        const body = await c.req.raw.clone().json();
        phone = String((body as any)?.phone ?? 'anon');
      } catch { /* جسم غير JSON: يبقى مجهولاً ويُحسب بالـIP */ }
    }

    const store = kv();
    const ip = clientIp(c);
    let strictest: { rule: Rule; count: number } | null = null;

    for (const rule of rules) {
      const subject = rule.by === 'phone' ? phone : ip;
      const key = `rl:${method}:${path}:${rule.by}:${subject}:${rule.limit}`;

      /* الزيادة ذرّية في المخزن حيث يدعمها: القراءة ثم الكتابة تسمحان
         لطلبين متزامنين بقراءة العدّاد نفسه فيمرّان معاً فوق الحدّ. */
      const count = await store.incr(key, rule.windowSec);
      if (!strictest || rule.limit - count < strictest.rule.limit - strictest.count) {
        strictest = { rule, count };
      }
    }

    if (strictest) {
      const { rule, count } = strictest;
      const remaining = Math.max(0, rule.limit - count);
      c.header('RateLimit-Limit', String(rule.limit));
      c.header('RateLimit-Remaining', String(remaining));
      c.header('RateLimit-Reset', String(rule.windowSec));
      if (count > rule.limit) {
        c.header('Retry-After', String(rule.windowSec));
        throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'RATE_LIMITED',
          { ar: 'محاولات كثيرة — انتظر قليلاً', en: 'Too many requests' },
          { retryAfterSec: rule.windowSec });
      }
    }

    await next();
  };
