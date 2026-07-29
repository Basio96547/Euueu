/**
 * تطبيع النص العربي للبحث (الفصل 6).
 * المشتري يكتب «ايفون» و«آيفون» و«أيفون» ويقصد الشيء نفسه،
 * ويكتب «موبايل» و«تلفون» ويقصد «جوال».
 */
const TASHKEEL = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/g;
const TATWEEL = /\u0640/g;

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

/**
 * مرادفات Meilisearch أحادية الاتجاه، فيُولَّد الجدول في الاتجاهين آلياً.
 */
const GROUPS: string[][] = [
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

export function buildSynonyms(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const g of GROUPS) {
    const norm = g.map(normalizeAr);
    for (const term of norm) out[term] = norm.filter((t) => t !== term);
  }
  return out;
}

/** يوسّع الاستعلام بمرادفاته — لمسار الاحتياط على PostgreSQL */
export function expandQuery(q: string): string[] {
  const n = normalizeAr(q);
  const syn = buildSynonyms();
  const words = n.split(' ').filter(Boolean);
  const terms = new Set<string>(words);
  for (const word of words) for (const s of syn[word] ?? []) terms.add(s);
  return [...terms];
}

/**
 * المصطلحات العامة استعلامات تصفّحية لا لفظية: من يكتب «جوال» يريد فئة
 * الهواتف لا منتجاً اسمه «جوال» — ولا يوجد منتج بهذا الاسم أصلاً.
 */
const GENERIC_TO_CATEGORIES: Array<[string[], string[]]> = [
  [['جوال', 'موبايل', 'تلفون', 'هاتف', 'mobile', 'phone'],
   ['smartphones', 'feature-phones', 'used-refurbished']],
  [['شاحن', 'charger', 'ادابتر'], ['chargers']],
  [['بطاريه', 'باور بانك', 'powerbank'], ['power-banks']],
  [['سماعه', 'سماعات', 'earbuds', 'headphones'], ['audio']],
  [['جراب', 'كفر', 'حمايه', 'case'], ['protection']],
  [['ساعه', 'ساعات', 'smartwatch'], ['wearables']],
  [['كابل', 'وصله', 'cable'], ['cables']],
];

/** يعيد الفئات المقصودة إن كان الاستعلام مصطلحاً عاماً، وإلا مصفوفة فارغة */
export function categoriesForQuery(q: string): string[] {
  const terms = new Set(normalizeAr(q).split(' ').filter(Boolean));
  const out = new Set<string>();
  for (const [words, cats] of GENERIC_TO_CATEGORIES) {
    if (words.map(normalizeAr).some((w) => terms.has(w))) cats.forEach((c) => out.add(c));
  }
  return [...out];
}
