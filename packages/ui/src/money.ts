import type { UsdCents, Syp } from '@talisham/types';

/**
 * وحدة التقريب النقدي.
 *
 * كانت ألفاً حين كانت الليرة قديمة. وفي أول كانون الثاني 2026 حُذف
 * صفران من العملة: كل مئة ليرة قديمة صارت ليرةً جديدة واحدة، وأصغر
 * ورقةٍ متداولة عشرُ ليرات. فألفُ القديمة هي عشرةُ الجديدة بالضبط —
 * القاعدة لم تتغيّر، وحدتُها وحدها هي التي تبدّلت معها العملة.
 *
 * وهذا رقمٌ واحد في مكانٍ واحد عمداً: لو كان مكتوباً بيده في عشرة
 * مواضع لبقي نصفها على القديم، ولاختلف ما يُعرض على البطاقة عمّا
 * يُطلب عند الباب — والفرق في المال لا يُغتفر مهما صغر.
 */
export const CASH_ROUNDING_STEP = 10;

/** يُقرَّب المبلغ النقدي لأقرب عشر ليرات (أصغر ورقة متداولة). */
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
