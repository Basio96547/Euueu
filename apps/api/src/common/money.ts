/** المعادلة المرجعية — نسخة الخادم. المرجع: packages/ui/src/money.ts والفصل 7 §7.11 */
/* عشرة لا ألف: حُذف صفران من الليرة في 2026-01-01، وأصغر ورقة عشر ليرات */
export const CASH_STEP = 10;
export const roundCash = (syp: number) => Math.round(syp / CASH_STEP) * CASH_STEP;
export const toSypRaw = (usdCents: number, rate: number) => (usdCents * rate) / 100;

/** يُجمع بالسنتات ثم يُقرَّب مرة واحدة — لا تُجمع أرقام مقرَّبة أبداً. */
export function cashDue(linesUsdCents: number[], shippingUsdCents: number, rate: number) {
  const totalUsdCents = linesUsdCents.reduce((a, b) => a + b, 0) + shippingUsdCents;
  const raw = Math.round(toSypRaw(totalUsdCents, rate));
  const cashSyp = roundCash(raw);
  return { totalUsdCents, rawSyp: raw, cashSyp, roundingDiffSyp: cashSyp - raw };
}

/** TS-YYMM-NNNNNN */
export function orderNo(seq: number, at = new Date()) {
  const yy = String(at.getUTCFullYear()).slice(2);
  const mm = String(at.getUTCMonth() + 1).padStart(2, '0');
  return `TS-${yy}${mm}-${String(seq).padStart(6, '0')}`;
}

const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** معرّف عام غير زمني — لا يسرّب وقت الإنشاء ولا حجم الطلبات */
export function publicId(len = 12) {
  let s = '';
  for (let i = 0; i < len; i++) s += B32[Math.floor(Math.random() * B32.length)];
  return s;
}
