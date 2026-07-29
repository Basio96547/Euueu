/**
 * تطبيع البحث في الموقع الساكن.
 *
 * نسخة مصغَّرة مطابقة لـ `apps/api/src/common/arabic.ts` — وهي المرجع.
 * التكرار مقصود: الموقع يُبنى بلا واجهة برمجية أحياناً، ولا يستورد شيفرة
 * الخادم (اختلاف `rootDir` و`moduleResolution`)، وعشرون سطراً أهون من
 * اعتماد جديد في صفحة أصلها صفر JavaScript.
 */
const TASHKEEL = /[ؐ-ًؚ-ٰٟۖ-ۭ]/g;
const TATWEEL = /ـ/g;

export function normalizeAr(input: string): string {
  return input
    .replace(TASHKEEL, '')
    .replace(TATWEEL, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** مجموعات المرادفات — كل مجموعة تُكتب في فهرس المنتج كاملةً وقت البناء */
export const SYNONYM_GROUPS: string[][] = [
  ['جوال', 'موبايل', 'تلفون', 'هاتف', 'mobile', 'phone'],
  ['ايفون', 'iphone', 'ابل', 'apple'],
  ['سامسونج', 'سامسونغ', 'samsung', 'جالكسي', 'galaxy'],
  ['شاومي', 'شياومي', 'xiaomi', 'ريدمي', 'redmi'],
  ['بطاريه', 'باور بانك', 'powerbank', 'شاحن متنقل'],
  ['شاحن', 'charger', 'ادابتر'],
  ['سماعه', 'سماعات', 'earbuds', 'headphones'],
  ['مستعمل', 'سكند هاند', 'used'],
  ['مجدد', 'ريفربش', 'refurbished'],
];

/**
 * يوسّع نصاً بمرادفاته: يُستدعى وقت البناء على نص المنتج، فيصير البحث
 * في المتصفح مطابقةَ نصٍّ بسيطة بلا جدول مرادفات ولا حساب.
 */
export function expandText(text: string): string {
  const n = normalizeAr(text);
  const extra = new Set<string>();
  for (const group of SYNONYM_GROUPS) {
    const norm = group.map(normalizeAr);
    if (norm.some((t) => n.includes(t))) norm.forEach((t) => extra.add(t));
  }
  return [n, ...extra].join(' ');
}
