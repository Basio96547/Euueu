import { Injectable, type NestMiddleware, HttpStatus } from '@nestjs/common';
import { ApiError } from './errors.js';

type Rule = { limit: number; windowSec: number; by: 'ip' | 'user' | 'phone' };

/**
 * حدود المعدل — القيم من جدول الفصل 9 وهو مصدرها الوحيد.
 * التنفيذ في الذاكرة كافٍ لعقدة واحدة؛ ومع تعدد العقد يُستبدل المخزن
 * بـ Redis دون تغيير الجدول.
 */
const RULES: Array<[RegExp, string, Rule]> = [
  [/^\/api\/v1\/auth\/otp\/request$/, 'POST', { limit: 5, windowSec: 3600, by: 'phone' }],
  [/^\/api\/v1\/auth\/otp\/request$/, 'POST', { limit: 20, windowSec: 3600, by: 'ip' }],
  [/^\/api\/v1\/auth\/otp\/verify$/, 'POST', { limit: 5, windowSec: 900, by: 'phone' }],
  [/^\/api\/v1\/orders$/, 'POST', { limit: 5, windowSec: 3600, by: 'ip' }],
  [/^\/api\/v1\/search/, 'GET', { limit: 60, windowSec: 60, by: 'ip' }],
  [/^\/api\/v1\/warranties\/verify/, 'GET', { limit: 20, windowSec: 3600, by: 'ip' }],
  [/^\/api\/v1\/orders\/[^/]+\/track/, 'GET', { limit: 10, windowSec: 3600, by: 'ip' }],
  [/^\/api\/v1\/admin\/fx$/, 'POST', { limit: 20, windowSec: 86400, by: 'ip' }],
  [/^\/api\/v1\/courier\//, 'POST', { limit: 300, windowSec: 3600, by: 'ip' }],
];

/** الحد الافتراضي العام: غير مقصود لأي عملية حساسة */
const DEFAULT: Rule = { limit: 60, windowSec: 60, by: 'ip' };

const buckets = new Map<string, { count: number; resetAt: number }>();

@Injectable()
export class RateLimitMiddleware implements NestMiddleware {
  use(req: any, res: any, next: () => void) {
    const path: string = req.originalUrl?.split('?')[0] ?? req.url;
    const method: string = req.method;
    const matched = RULES.filter(([re, m]) => m === method && re.test(path)).map(([, , r]) => r);
    const rules = matched.length ? matched : [DEFAULT];

    const now = Date.now();
    let strictest: { rule: Rule; bucket: { count: number; resetAt: number } } | null = null;

    for (const rule of rules) {
      const subject =
        rule.by === 'phone' ? String(req.body?.phone ?? 'anon')
        : rule.by === 'user' ? String(req.user?.sub ?? req.ip)
        : String(req.ip ?? req.socket?.remoteAddress ?? 'anon');
      const key = `${method}:${path}:${rule.by}:${subject}:${rule.limit}`;

      let b = buckets.get(key);
      if (!b || b.resetAt <= now) { b = { count: 0, resetAt: now + rule.windowSec * 1000 }; buckets.set(key, b); }
      b.count++;
      if (!strictest || rule.limit - b.count < strictest.rule.limit - strictest.bucket.count) {
        strictest = { rule, bucket: b };
      }
    }

    if (strictest) {
      const { rule, bucket } = strictest;
      const remaining = Math.max(0, rule.limit - bucket.count);
      res.setHeader('RateLimit-Limit', rule.limit);
      res.setHeader('RateLimit-Remaining', remaining);
      res.setHeader('RateLimit-Reset', Math.ceil((bucket.resetAt - now) / 1000));
      if (bucket.count > rule.limit) {
        res.setHeader('Retry-After', Math.ceil((bucket.resetAt - now) / 1000));
        throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'RATE_LIMITED',
          { ar: 'محاولات كثيرة — انتظر قليلاً', en: 'Too many requests' },
          { retryAfterSec: Math.ceil((bucket.resetAt - now) / 1000) });
      }
    }

    // كنس دوري بسيط حتى لا تتضخم الذاكرة
    if (buckets.size > 10_000) {
      for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
    }
    next();
  }
}
