/**
 * قائمة نصية مخزَّنة JSON.
 * SQLite بلا مصفوفات بدائية، فتُخزَّن القوائم JSON — والقارئ يحوّلها مرة
 * واحدة هنا بدل أن يتناثر `as string[]` في كل موضع يقرؤها.
 */
export const strList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
