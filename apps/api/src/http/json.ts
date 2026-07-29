/**
 * تسلسل الاستجابة.
 *
 * كل مبلغ في المخطَّط `BigInt` (سنتات الدولار والليرة)، و`JSON.stringify`
 * يرمي عليه استثناءً. الحلّ ليس تحويل الأنواع في مئة موضع بل مُسلسِلٌ
 * واحد: الأعداد ضمن المدى الآمن تُكتب أرقاماً، وما تجاوزه يُكتب نصاً
 * حفاظاً على الدقّة — ورقمٌ يُقصّ صامتاً في متجرٍ أسوأ من رقمٍ نصّي.
 */
export function stringify(value: unknown): string {
  return JSON.stringify(value, (_k, v) => {
    if (typeof v === 'bigint') {
      return v <= BigInt(Number.MAX_SAFE_INTEGER) && v >= BigInt(Number.MIN_SAFE_INTEGER)
        ? Number(v)
        : v.toString();
    }
    return v;
  });
}

const HEADERS = { 'content-type': 'application/json; charset=utf-8' };

/** استجابة JSON بالمُسلسِل أعلاه — تُستعمل بدل `c.json` في كل مسار */
export function send(c: any, payload: unknown, status = 200) {
  return c.body(stringify(payload), status, HEADERS);
}
