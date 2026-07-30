/**
 * صورة المنتج المولَّدة.
 *
 * لا صور فوتوغرافية في الكتالوج بعد. وما كان يُعرض بدلها مربّعٌ رماديّ
 * فيه رسمُ هاتفٍ واحد — للهاتف، وللكابل، وللشاحن، وللساعة سواءً. فبدا
 * الموقع كأنه هيكلٌ لم يكتمل، وليس متجراً.
 *
 * البديل ليس صورةً مزيّفة: هو رسمٌ صريحُ أنه رسم، لكنه **يقول شيئاً**.
 * ثلاثة أشياء تُقرأ من مسافة الإبهام:
 *
 *   الشكل  ← نوع المنتج: هاتفٌ أم بطاريةٌ محمولة أم سمّاعة أم كابل.
 *   اللون  ← لون النسخة الحقيقيّ (`color_code` في الكتالوج): «تيتانيوم
 *            أزرق» يظهر أزرق، و«ذهبي» يظهر ذهبياً.
 *   الأرضية ← العلامة التجارية: تدرّجٌ ثابت لكل علامة، فبطاقات آبل
 *            تُميَّز عن بطاقات شاومي قبل قراءة الاسم.
 *
 * والرسم SVG مضمَّن في HTML: بلا طلب شبكة، وبلا قفزة تخطيط، ويرث
 * ألوان السمة الليلية والنهارية. ويوم تصل الصور الحقيقية تحلّ محلّه
 * ويبقى هو للاحتياط — لأن منتجاً بلا صورة سيبقى موجوداً دائماً.
 */

export type ArtKind =
  | 'phone' | 'phone-classic' | 'powerbank' | 'solar'
  | 'charger' | 'cable' | 'earbuds' | 'watch' | 'case';

/** الفئة → الشكل. الأدقّ يسبق: `power-banks` قبل `power`. */
const KIND_BY_CATEGORY: Array<[string, ArtKind]> = [
  ['power-banks', 'powerbank'],
  ['chargers', 'charger'],
  ['cables', 'cable'],
  ['power', 'solar'],
  ['audio', 'earbuds'],
  ['wearables', 'watch'],
  ['protection', 'case'],
  ['feature-phones', 'phone-classic'],
];

/** كلمات في الاسم تُصحّح الفئة: «شاحن شمسي» تحت `power` وليست بطارية */
const KIND_BY_WORD: Array<[RegExp, ArtKind]> = [
  [/شمسي|solar/i, 'solar'],
  [/كابل|cable/i, 'cable'],
  [/سماع|earbud|headphone|tws/i, 'earbuds'],
  [/ساعة|watch/i, 'watch'],
  [/جراب|غطاء|case|cover/i, 'case'],
  [/بطارية محمولة|power ?bank/i, 'powerbank'],
  [/شاحن|charger/i, 'charger'],
];

export function artKind(category: string, name: string): ArtKind {
  for (const [re, k] of KIND_BY_WORD) if (re.test(name)) return k;
  for (const [slug, k] of KIND_BY_CATEGORY) if (category === slug) return k;
  return 'phone';
}

/** درجة العلامة على عجلة الألوان — الأرضية وحدها، فلا تنافس لون الجهاز */
const BRAND_HUE: Record<string, number> = {
  apple: 205, samsung: 224, xiaomi: 22, honor: 196,
  infinix: 272, tecno: 158, realme: 44, nokia: 214,
};

export const brandHue = (brand: string) => BRAND_HUE[brand] ?? 200;

/** رمز اللون في الكتالوج → لونٌ فعليّ للجسم */
const BODY: Record<string, string> = {
  'natural-titanium': '#c4bdb1',
  'blue-titanium': '#66798c',
  midnight: '#232b38',
  blue: '#3f6cc4',
  navy: '#26314c',
  black: '#1c1f22',
  green: '#2f6b51',
  gray: '#878e92',
  white: '#e9ebea',
  cyan: '#2fb2c4',
  gold: '#cfa863',
};

export const bodyColor = (code: string | null | undefined) =>
  (code && BODY[code]) || '#59635f';

/** فاتحٌ أم داكن؟ الحدّ والتفاصيل تُقلب عليه حتى لا تختفي فوق جسمٍ أبيض */
export function isLight(hex: string): boolean {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.62;
}

/**
 * الأشكال. جميعها في إطار 0 0 120 120، ومركزها 60 — فتتبدّل الفئة
 * داخل البطاقة بلا أن يتزحزح شيء.
 *
 * `body` يُملأ بلون النسخة، و`line` يُرسَم فوقه بلون التباين، و`glow`
 * لمعةٌ خفيفة تعطي الجسم حجماً بلا تدرّجات ثقيلة.
 */
export interface Shape {
  /** الجسم — يُملأ بلون النسخة */
  body: string;
  /** خطوطٌ تُرسم فوق الجسم بلون التباين */
  line: string[];
  /** غائرٌ داكن: شاشة، أو فتحة جراب */
  screen?: string;
  /** تفصيلٌ ممتلئ لا مخطَّط: الجزيرة، مؤشّرات الشحن */
  mark?: string[];
}

export function shape(kind: ArtKind): Shape {
  switch (kind) {
    case 'phone':
      return {
        body: 'M40 8h40a11 11 0 0 1 11 11v82a11 11 0 0 1-11 11H40a11 11 0 0 1-11-11V19A11 11 0 0 1 40 8z',
        /* الشاشة بحافةٍ متساوية حول الجسم، والجزيرة فوقها كما في الأجهزة اليوم */
        screen: 'M40 14h40a6 6 0 0 1 6 6v80a6 6 0 0 1-6 6H40a6 6 0 0 1-6-6V20a6 6 0 0 1 6-6z',
        line: [],
        mark: ['M54 20h12a3.5 3.5 0 0 1 0 7H54a3.5 3.5 0 0 1 0-7z'],
      };
    case 'phone-classic':
      return {
        body: 'M43 10h34a8 8 0 0 1 8 8v84a8 8 0 0 1-8 8H43a8 8 0 0 1-8-8V18a8 8 0 0 1 8-8z',
        screen: 'M43 22h34a4 4 0 0 1 4 4v30a4 4 0 0 1-4 4H43a4 4 0 0 1-4-4V26a4 4 0 0 1 4-4z',
        line: ['M45 70h9M56 70h8M66 70h9', 'M45 82h9M56 82h8M66 82h9', 'M45 94h9M56 94h8M66 94h9'],
      };
    case 'powerbank':
      return {
        body: 'M32 26h56a9 9 0 0 1 9 9v50a9 9 0 0 1-9 9H32a9 9 0 0 1-9-9V35a9 9 0 0 1 9-9z',
        line: [
          'M35 84h6M45 84h6M55 84h6M65 84h6',
          'M78 38v10',
        ],
        mark: ['M35 40h20a4 4 0 0 1 0 8H35a4 4 0 0 1 0-8z'],
      };
    case 'solar':
      return {
        body: 'M22 30h76a6 6 0 0 1 6 6v48a6 6 0 0 1-6 6H22a6 6 0 0 1-6-6V36a6 6 0 0 1 6-6z',
        line: ['M60 30v60', 'M16 50h88', 'M16 70h88', 'M38 30v60', 'M82 30v60'],
      };
    case 'charger':
      return {
        body: 'M40 34h40a10 10 0 0 1 10 10v34a10 10 0 0 1-10 10H40a10 10 0 0 1-10-10V44a10 10 0 0 1 10-10z',
        line: ['M48 34V20M72 34V20'],
        mark: ['M52 88h16a3 3 0 0 1 0 6H52a3 3 0 0 1 0-6z'],
      };
    case 'cable':
      return {
        body: 'M24 30h16a4 4 0 0 1 4 4v9a4 4 0 0 1-4 4H24a4 4 0 0 1-4-4v-9a4 4 0 0 1 4-4z'
            + 'M80 73h16a4 4 0 0 1 4 4v9a4 4 0 0 1-4 4H80a4 4 0 0 1-4-4v-9a4 4 0 0 1 4-4z',
        line: ['M32 47c0 22 8 26 28 26s28 4 28 0', 'M26 30v-6h12v6', 'M82 90v6h12v-6'],
      };
    case 'earbuds':
      return {
        /* العلبة، ثم السمّاعتان فوقها — بجسمٍ واحد لأن لونهما واحد */
        body: 'M34 56h52a12 12 0 0 1 12 12v20a12 12 0 0 1-12 12H34a12 12 0 0 1-12-12V68a12 12 0 0 1 12-12z'
            + 'M40 16a9 9 0 0 1 9 9v12a9 9 0 0 1-18 0V25a9 9 0 0 1 9-9z'
            + 'M80 16a9 9 0 0 1 9 9v12a9 9 0 0 1-18 0V25a9 9 0 0 1 9-9z',
        line: ['M22 78h76', 'M40 46v10', 'M80 46v10'],
      };
    case 'watch':
      return {
        body: 'M38 32h44a10 10 0 0 1 10 10v36a10 10 0 0 1-10 10H38a10 10 0 0 1-10-10V42a10 10 0 0 1 10-10z',
        screen: 'M34 40h52v40H34z',
        line: ['M44 32V14h32v18', 'M44 88v18h32V88', 'M92 52v14'],
      };
    case 'case':
      return {
        body: 'M40 14h40a10 10 0 0 1 10 10v72a10 10 0 0 1-10 10H40a10 10 0 0 1-10-10V24a10 10 0 0 1 10-10z',
        screen: 'M37 22h46v76H37z',
        line: ['M46 30a7 7 0 1 0 0 14 7 7 0 0 0 0-14', 'M64 30a7 7 0 1 0 0 14 7 7 0 0 0 0-14'],
      };
  }
}
