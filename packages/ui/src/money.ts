import type { UsdCents, Syp } from '@talisham/types';

/** وحدة التقريب النقدي: الفئات الأصغر غير متداولة عملياً (الفصل 3). */
export const CASH_ROUNDING_STEP = 1000;

/** يُقرَّب المبلغ النقدي لأقرب 1000 ليرة. */
export const roundCash = (syp: number): Syp =>
  Math.round(syp / CASH_ROUNDING_STEP) * CASH_ROUNDING_STEP;

/**
 * المعادلة المرجعية الوحيدة للتحويل (الفصل 7 §7.11).
 * ممنوع إعادة كتابتها في أي مكان آخر.
 */
export const toSypRaw = (usdCents: UsdCents, rate: number): number =>
  (usdCents * rate) / 100;

/** سعر معروض على بطاقة أو صفحة — غير ملزِم. */
export const displaySyp = (usdCents: UsdCents, rate: number): Syp =>
  roundCash(toSypRaw(usdCents, rate));

/**
 * المبلغ المستحق نقداً: يُجمع بالسنتات ثم يُقرَّب **مرة واحدة**.
 * جمع أرقام مقرَّبة إفرادياً يعطي مبلغاً يخالف المستحق ويبدو للعميل تلاعباً.
 */
export function cashDue(lines: UsdCents[], shipping: UsdCents, rate: number) {
  const totalUsdCents = lines.reduce((a, b) => a + b, 0) + shipping;
  const raw = toSypRaw(totalUsdCents, rate);
  const rounded = roundCash(raw);
  return { totalUsdCents, rawSyp: Math.round(raw), cashSyp: rounded, roundingDiffSyp: rounded - Math.round(raw) };
}

const AR = 'ar-SY';
export const formatUsd = (c: UsdCents) =>
  (c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' $';
export const formatSyp = (s: Syp) => s.toLocaleString('en-US') + ' ل.س';

export const formatMoney = (usdCents: UsdCents, rate: number, pref: 'SYP' | 'USD') =>
  pref === 'USD' ? formatUsd(usdCents) : formatSyp(displaySyp(usdCents, rate));

/** صحة سعر الصرف — التقادم ليس حالة مسموحة (الفصل 3). */
export function fxHealth(validUntil: string, now = new Date()) {
  const end = new Date(validUntil).getTime();
  const hoursLeft = (end - now.getTime()) / 3_600_000;
  if (hoursLeft > 4) return 'FRESH' as const;
  if (hoursLeft > 0) return 'EXPIRING' as const;
  if (hoursLeft > -12) return 'STALE_MARGIN' as const;
  return 'STALE_HALT' as const;
}

export { AR };
