/**
 * بيانات المتجر المنظَّمة.
 *
 * محرك البحث لا يقرأ الصفحة كما يقرؤها الإنسان: يقرأ ما يُصرَّح به.
 * وما لا يُصرَّح به يُستنتَج أو يُهمَل — والاستنتاج في سوقٍ صغير يُخطئ.
 *
 * ما هنا حقائق يعرفها المتجر عن نفسه فقط، ولا يُخترع منها شيء: بياناتٌ
 * منظَّمة كاذبة أسوأ من غيابها — تُصحَّح في نتائج البحث بعد أشهر، ويقصد
 * الزبون عنواناً لا وجود له. فالحقل الذي لا نعرفه يبقى فارغاً ومعلَّماً،
 * وعنوانُ المحل هو الفارغ الوحيد الباقي.
 */

export const SITE = {
  name: 'تالي شام',
  nameEn: 'Talisham',
  /** الوصف الذي يظهر تحت الرابط في نتائج البحث حين لا وصفَ أدقّ للصفحة */
  tagline: 'متجر الهواتف الجوالة في سوريا — دفع عند الاستلام',
  city: 'دمشق',
  country: 'SY',
  countryName: 'سوريا',
  locale: 'ar_SY',
  lang: 'ar',
  /** يُملأ حين يُعرف: عنوان المحل ونطاق التسليم */
  streetAddress: null as string | null,
  /** الرقم المعلَن — بصيغة E.164 كما تطلبه schema.org */
  telephone: '+963993223887',
  whatsapp: '963993223887',
  founded: '2026',
} as const;

/** المرجع الثابت للمتجر ككيان — تُشير إليه بقية الأنواع بدل تكرارها */
export const ORG_ID = '#store';

export function organizationLd(base: string) {
  const addr: Record<string, string> = {
    '@type': 'PostalAddress',
    addressLocality: SITE.city,
    addressCountry: SITE.country,
  };
  if (SITE.streetAddress) addr.streetAddress = SITE.streetAddress;

  return {
    '@type': ['Organization', 'OnlineStore'],
    '@id': `${base}/${ORG_ID}`,
    name: SITE.name,
    alternateName: SITE.nameEn,
    url: `${base}/`,
    logo: { '@type': 'ImageObject', url: `${base}/og.png`, width: 1200, height: 630 },
    image: `${base}/og.png`,
    description: SITE.tagline,
    address: addr,
    areaServed: [
      { '@type': 'City', name: SITE.city },
      { '@type': 'Country', name: SITE.countryName },
    ],
    currenciesAccepted: 'SYP, USD',
    paymentAccepted: 'نقداً عند الاستلام',
    ...(SITE.telephone ? { telephone: SITE.telephone } : {}),
    contactPoint: {
      '@type': 'ContactPoint',
      contactType: 'customer service',
      telephone: SITE.telephone,
      availableLanguage: ['ar', 'en'],
      areaServed: SITE.country,
    },
    sameAs: [`https://wa.me/${SITE.whatsapp}`],
  };
}

/**
 * صندوق بحثٍ داخل نتيجة البحث نفسها.
 * صفحة ‎/search‎ تقرأ ‎?q=‎ أصلاً، فالتصريح هنا وصفٌ لما يعمل لا وعدٌ به.
 */
export function websiteLd(base: string) {
  return {
    '@type': 'WebSite',
    '@id': `${base}/#site`,
    url: `${base}/`,
    name: SITE.name,
    inLanguage: 'ar-SY',
    publisher: { '@id': `${base}/${ORG_ID}` },
    potentialAction: {
      '@type': 'SearchAction',
      target: { '@type': 'EntryPoint', urlTemplate: `${base}/search?q={search_term_string}` },
      'query-input': 'required name=search_term_string',
    },
  };
}

/**
 * فتات المسار.
 * محرك البحث يعرضه بدل الرابط الطويل تحت العنوان، فيقرأ الزائر موضع
 * الصفحة من الشجرة قبل أن يضغط — وهذا وحده يرفع نسبة الضغط.
 */
export function breadcrumbLd(base: string, trail: Array<[string, string]>) {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: trail.map(([name, path], i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name,
      item: `${base}${path}`,
    })),
  };
}

/** قائمة منتجاتٍ مرتّبة — تُستعمل في صفحات الفئات والواجهة */
export function itemListLd(
  base: string,
  items: Array<{ slug: string; name: string; usdCents: number; inStock: boolean }>,
) {
  return {
    '@type': 'ItemList',
    numberOfItems: items.length,
    itemListElement: items.map((p, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      item: {
        '@type': 'Product',
        name: p.name,
        url: `${base}/p/${p.slug}/`,
        offers: {
          '@type': 'Offer',
          priceCurrency: 'USD',
          price: (p.usdCents / 100).toFixed(2),
          availability: p.inStock
            ? 'https://schema.org/InStock'
            : 'https://schema.org/OutOfStock',
        },
      },
    })),
  };
}

export function faqLd(qa: Array<{ q: string; a: string }>) {
  return {
    '@type': 'FAQPage',
    mainEntity: qa.map(({ q, a }) => ({
      '@type': 'Question',
      name: q,
      acceptedAnswer: { '@type': 'Answer', text: a },
    })),
  };
}

/**
 * تسلسلٌ آمن للوضع داخل وسم `<script>`.
 *
 * `JSON.stringify` يهرّب علامة الاقتباس والشرطة المائلة الخلفية، ولا
 * يهرّب `<` ولا `/`. فاسمُ منتجٍ فيه `</script>` يُنهي الوسم قبل أوانه،
 * وما بعده يصير HTML حيّاً في الصفحة:
 *
 *     <script type="application/ld+json">{"name":"</script><img onerror=…>
 *
 * وسياسة المحتوى لا تردّه: `script-src` فيها `'unsafe-inline'`، فمعالجُ
 * `onerror` المحقون يعمل. والأسماء تأتي من الكتالوج، أي أن مدير كتالوجٍ
 * واحداً يستطيع أن يسرق جلسة صاحب المتجر من صفحةٍ عامّة.
 *
 * والهروب هنا داخل نصّ JSON: `<` تُقرأ `<` عند التحليل، فالبيانات
 * تصل كما هي ولا يُنهي شيءٌ الوسم. وU+2028/2029 تُهرَّب لأنهما فاصلا
 * سطرٍ في جافاسكربت وليسا كذلك في JSON.
 */
export const jsonForScript = (value: unknown) =>
  JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');

/** يلفّ الأنواع في رسمٍ واحد: رسمٌ واحد أصحّ من خمسة منفصلة لا تعرف بعضها */
export const graph = (base: string, nodes: unknown[]) =>
  jsonForScript({ '@context': 'https://schema.org', '@graph': nodes.filter(Boolean) });
