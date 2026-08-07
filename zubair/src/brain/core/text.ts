/* ————— الحاسّة ومنطقة شكل الكلمة —————
 *
 * هذا أول ما يلمس كلامك في دماغ زبير. وظيفته أن يحوّل حرفاً كتبتَه على جوالك
 * إلى شيء يستطيع باقي الدماغ التفكير به: رموز مطبّعة، ورقم لكل كلمة يعرفها،
 * ومتجه ملامح لكل كلمة لم يسمعها في حياته.
 *
 * القرار المركزي هنا أن الكلمة المجهولة لا تُرمى ولا تُعامَل رمزاً واحداً
 * («UNK» كما تفعل الشبكات الجاهزة)، بل تُمثَّل بشكل حروفها. لأن الطفل الذي
 * يسمع «يكتب» أول مرة وقد سمع «كاتب» قبلها لا يبدأ من الصفر: شكل الكلمة
 * نفسه دليل على معناها في لغة اشتقاقية كالعربية. هذا هو الفرق بين دماغ
 * يخمّن ودماغ ينتظر أن تُعلّمه كل صورة من صور الجذر على حدة.
 */

import { Embedding, type EmbeddingState } from './net.js';
import { Rng, checkedVec, norm, scaleInto, vec, type Vec } from './tensor.js';
import { DIMS, type Lobe } from './types.js';

/* ————— التطبيع ————— */

/* محارف اتجاه وصفر-عرض تلتصق بالنصّ المنسوخ من تطبيقات المحادثة. لا تُرى
 * بالعين لكنها تجعل كلمتين متطابقتين ظاهرياً كلمتين مختلفتين في الخريطة. */
const INVISIBLE = /[​-‏؜﻿]/g;

/* التشكيل والمدّ القرآني: صوت لا معنى، فلو لم نحذفه صار لكل حركة معجم منفصل.
 * تُكتب المدَيات بالترميز لا بالحرف لأن هذه المحارف غير مرئية في المحرِّر:
 * 064B-0652 الحركات والسكون والشدّة، و0670 الألف الخنجرية، و06D6-06ED
 * علامات الوقف والتجويد. المدَيات مأخوذة بالحرف من عقد التوصيل. */
const DIACRITICS = /[ً-ْٰۖ-ۭ]/g;

/* التطويل («ســلام») زخرفة خطّية لا حرف. */
const TATWEEL = /ـ/g;

/* الألفات: آ أ إ ٱ ← ا. الأب يكتب على جوال بلا همزات نصف الوقت، ولو فرّقنا
 * بينها لصار «أسد» و«اسد» شيئين لا يجمعهما شيء. الهمزة المستقلّة (ء) والهمزة
 * على واو أو ياء تبقى: حذفها يغيّر المعنى لا الإملاء. */
const ALEFS = /[آأإٱ]/g;
/* الياء المقصورة: «علي» و«على» صورتان لحرف واحد في كتابة الجوال. */
const YA_MAQSURA = /ى/g;
/* التاء المربوطة ← هاء، للمقارنة وحدها. النصّ المعروض يبقى في Percept.raw. */
const TA_MARBUTA = /ة/g;

/* الأرقام العربية-الهندية (٠-٩) والفارسية (۰-۹). */
const ARABIC_INDIC_DIGITS = /[٠-٩۰-۹]/g;
const WHITESPACE = /\s+/g;

/** يوحّد كل صور الأرقام إلى 0-9 كي يكون «٣» و«3» عدداً واحداً في المعجم. */
function foldDigits(text: string): string {
  return text.replace(ARABIC_INDIC_DIGITS, (digit) => {
    const code = digit.codePointAt(0) ?? 0x0660;
    const base = code >= 0x06f0 ? 0x06f0 : 0x0660;
    return String.fromCharCode(0x30 + (code - base));
  });
}

/**
 * يقلّص تكرار الحرف الواحد إلى مرّتين: «سلاااام» ← «سلاام».
 *
 * المدّ في الكتابة العربية عاطفة لا معنى، فلو تركناه صار لكل درجة انفعال
 * كلمة جديدة في المعجم. نُبقي حرفين لا حرفاً واحداً لأن التضعيف الحقيقي
 * موجود في العربية («مدّ» و«مد») والخلط بينهما يُفقد معنى.
 *
 * الأرقام مستثناة: «333» عدد لا مدّ، وتقليصه يغيّر القيمة.
 */
function collapseRepeats(text: string): string {
  let out = '';
  let previous = '';
  let run = 0;
  // for..of يمرّ على نقاط الترميز لا على وحدات UTF-16، فلا يُقطع زوج بديل
  for (const ch of text) {
    if (ch === previous) run++;
    else {
      previous = ch;
      run = 1;
    }
    if (run <= 2 || (ch >= '0' && ch <= '9')) out += ch;
  }
  return out;
}

/**
 * الصورة المعيارية للمقارنة. النصّ الأصلي يبقى محفوظاً في `Percept.raw` لأن
 * لهجة الأب هي ما يتعلّم زبير أن يتكلّم به، والتطبيع يمحوها.
 */
export function normalizeArabic(text: string): string {
  if (typeof text !== 'string' || text.length === 0) return '';
  let out = text.replace(INVISIBLE, '').replace(DIACRITICS, '').replace(TATWEEL, '');
  out = out.replace(ALEFS, 'ا').replace(YA_MAQSURA, 'ي').replace(TA_MARBUTA, 'ه');
  out = foldDigits(out);
  // بعد حذف التشكيل لا قبله: «سلاـاام» بحركات متناثرة يجب أن يُقلَّص كأنه متّصل
  out = collapseRepeats(out);
  // العربية بلا حالة أحرف، والتصغير يخصّ ما يدخل من إنجليزية: «Zubair» و«zubair» اسم واحد
  return out.toLowerCase().replace(WHITESPACE, ' ').trim();
}

/* ————— التجزئة ————— */

/* كل ما ليس حرفاً ولا رقماً فاصلٌ. عقد التوصيل يسمّي الفواصل عدّاً (، ؛ ؟ ! . :
 * « » " ' ( ) - —) وكلها داخلة في هذا التعريف، ويكسب معها ما لم يُعدّ: الرموز
 * التعبيرية وعلامات الترقيم الغريبة. القائمة البيضاء أسلم من السوداء هنا لأن
 * ما نجهله من رموز لوحة المفاتيح أكثر ممّا نعرفه. */
const WORD_RUN = /[\p{L}\p{N}]+/gu;

/**
 * يفكّ الجملة إلى كلمات مطبّعة. لا يُحذف رمز لأنه «كلمة وظيفية»: أدوات
 * الاستفهام وحروف الجرّ هي حاملة القصد عند زبير، وحذفها — كما تفعل قوائم
 * الكلمات الموقوفة في معالجة النصوص — يمحو السؤال نفسه فيصير كلاماً عادياً.
 */
export function tokenize(text: string): string[] {
  const normalized = normalizeArabic(text);
  if (normalized.length === 0) return [];
  return normalized.match(WORD_RUN) ?? [];
}

/**
 * الكلمات كما كتبها الأب بلا تطبيع.
 *
 * التطبيع ضرورة للمقارنة («القطة» و«القطه» كلمة واحدة عنده)، لكنه ليس صورة
 * الكلمة الصحيحة: لو تكلّم زبير بالمطبَّع لقال «فاكهه» و«مدينه»، فيبدو ابناً
 * لا يعرف الإملاء وأبوه هو من كتبها صحيحة. فنحفظ الصورتين: المطبَّعة للفهم،
 * والأصلية للكلام.
 */
export function tokenizeSurface(text: string): string[] {
  if (typeof text !== 'string' || text.length === 0) return [];
  return text.match(WORD_RUN) ?? [];
}

/* ————— ملامح الحروف ————— */

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/**
 * FNV-1a بمِلح، مكتوبة بيدنا (لا مكتبة)، بخطوة خلط أخيرة.
 *
 * الخلط ضروري: البتات الدنيا في FNV الخام مرتبطة بآخر محرف ارتباطاً قوياً،
 * ونحن نأخذ رقم البُعد من البتات الدنيا (`h % out.length`) والإشارة من البتّ
 * الأعلى. بلا خلط تجتمع كل الثلاثيات المنتهية بالحرف نفسه في بُعد واحد.
 */
function fnv1a(text: string, salt: number): number {
  let h = (FNV_OFFSET ^ salt) >>> 0;
  for (let i = 0; i < text.length; i++) {
    h = (h ^ text.charCodeAt(i)) >>> 0;
    h = Math.imul(h, FNV_PRIME) >>> 0;
  }
  h = (h ^ (h >>> 15)) >>> 0;
  h = Math.imul(h, 0x2545f491) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  return h >>> 0;
}

/* حروف العلّة والمدّ التي يحشرها الصرف العربي بين حروف الجذر. حذفها يُخرج
 * «هيكل» الكلمة: «كاتب» ← «كتب» و«يكتب» ← «كتب». هذه القناة الثانية هي ما
 * يجعل صورتي الجذر الواحد متقاربتين قبل أن يتعلّم زبير أيّاً منهما. */
const WEAK_LETTERS = /[اوي]/g;

/* وزن قناة الهيكل أقلّ من قناة الحروف الكاملة: الهيكل تخمين صرفي قد يخطئ،
 * فـ«يمين» هيكلها «من» وهي ليست من جذرها. رفع الوزن إلى ‎0.9‎ يزيد شبه الجذر
 * الواحد قليلاً لكنه يرفع شبه «من»/«يمين» من صفر إلى ‎0.13‎ في القياس — والثمن
 * أغلى من الربح: تعميم على شبه زائف يصير تخريفاً حين يجيب زبير منه. */
const SKELETON_WEIGHT = 0.6;

/* مِلح مختلف لكل قناة: القناتان فضاءان منفصلان في الجدول نفسه، وإلا زاحمت
 * ثلاثيات الهيكل ثلاثيات الحروف في البُعد ذاته بالمصادفة. */
const SALT_FULL = 0x0000;
const SALT_SKELETON = 0x9e37;

/* كل ثلاثية توزَّع على أربعة أبعاد بأربعة هاشات مستقلّة، ووزن كل بصمة ‎1/√4‎
 * كي يبقى طول المتجه كما هو.
 *
 * العدد مقيس لا مُختار: على خمسين كلمة عربية (منها خمسة عشر زوجاً من جذر
 * واحد) في ٤٨ بُعداً، بقي ضجيج الاصطدام كما هو تقريباً (rms ≈ ‎0.15‎) لكن أضعف
 * زوج صرفي ارتفع من ‎-0.24‎ ببصمة واحدة إلى ‎-0.08‎ بأربع. السبب أن البصمة
 * الواحدة تجعل اصطداماً واحداً كافياً لمحو ثلاثية مشتركة كاملة، وأربع بصمات
 * توزّع الخطر فلا يُفقد الشبه بمصادفة واحدة. */
const PROBES = 4;
const PROBE_SCALE = 1 / Math.sqrt(PROBES);
/* فرق المِلح بين بصمة وأخرى: عدد أوّليّ كبير كي لا تتقارب حالات البدء فتتشابه
 * البصمات الأربع على السلاسل القصيرة. */
const PROBE_SALT_STEP = 0x1000193;

function scatter(out: Vec, gram: string, weight: number, salt: number): void {
  for (let p = 0; p < PROBES; p++) {
    const h = fnv1a(gram, salt + p * PROBE_SALT_STEP);
    const index = h % out.length;
    // الإشارة من البتّ الأعلى: نصف الملامح سالب، فتُلغي الاصطدامات بعضها في
    // المتوسط بدل أن تتراكم شبهاً زائفاً — هذه فائدة «الإشارة الموزّعة»
    const sign = (h >>> 31) & 1 ? -1 : 1;
    out[index]! += sign * weight * PROBE_SCALE;
  }
}

/** يوزّع ثلاثيات «^كلمة$» على الأبعاد. الحدّان يميّزان البادئة واللاحقة عن الوسط. */
function scatterTrigrams(out: Vec, word: string, weight: number, salt: number): void {
  const chars = Array.from(`^${word}$`);
  for (let i = 0; i + 3 <= chars.length; i++) {
    scatter(out, `${chars[i]!}${chars[i + 1]!}${chars[i + 2]!}`, weight, salt);
  }
}

/**
 * شكل الكلمة كمتجه بطول `out.length`: ثلاثيات حروفها وثلاثيات هيكلها،
 * موزّعة بهاش ثابت بإشارة، ثم مسوّاة الطول إلى واحد.
 *
 * التسوية لازمة لأن الكلمة الطويلة تُنتج ثلاثيات أكثر، فبلا تسوية يصير
 * التشابه الجيبي بين كلمتين دالّة على طولهما لا على شبههما.
 */
export function hashCharFeatures(word: string, out: Vec): Vec {
  out.fill(0);
  if (out.length === 0) return out;
  const normalized = normalizeArabic(word);
  if (normalized.length === 0) return out;

  scatterTrigrams(out, normalized, 1, SALT_FULL);
  // الهيكل يُضاف حتى لو ساوى الكلمة (جذر مجرّد كـ«كتب») كي تبقى القناة الثانية
  // مأهولة في الطرفين، فيلتقي المجرّد بالمشتقّ في البُعد نفسه
  const skeleton = normalized.replace(WEAK_LETTERS, '');
  if (skeleton.length > 0) scatterTrigrams(out, skeleton, SKELETON_WEIGHT, SALT_SKELETON);

  const length = norm(out);
  if (length > 0) scaleInto(out, 1 / length);
  return out;
}

/* ————— الإدراك ————— */

export interface Percept {
  /** نصّك كما كتبته */
  raw: string;
  /** بعد التطبيع */
  tokens: string[];
  /** ‎-1 لكل كلمة لم يعرفها بعد */
  ids: number[];
  unknown: string[];
  /** بُعد DIMS.word لكل كلمة (للمجهول: ملامح حروفه) */
  tokenVecs: Vec[];
  /** بُعد DIMS.word — متوسط ملامح حروف المجهول */
  charBag: Vec;
  /** من علامة الاستفهام أو أدواتها */
  isQuestion: boolean;
}

export interface LexiconState {
  dim: number;
  words: string[];
  counts: number[];
  embedding: EmbeddingState;
  /** صور الكلمات كما كتبها الأب: [المطبَّع، [[الصورة، العدد]]].
   *  اختياري كي تبقى الأدمغة المحفوظة قبل هذه الإضافة صالحة للاستعادة. */
  surfaces?: Array<[string, Array<[string, number]>]>;
}

/* أدوات لا تكون إلا استفهاماً، فحضورها في أي موضع من الجملة سؤال. */
const QUESTION_TOOLS_STRONG: readonly string[] = [
  'ماذا', 'شو', 'مين', 'كيف', 'ليش', 'لماذا', 'هل', 'اين', 'وين', 'متي',
];

/* أدوات مشتركة: «من» جرٌّ أيضاً («خرجت من البيت»)، و«ما» نفيٌ في الشامية
 * («ما بعرف»)، و«كم» خبريّة («أعطيتك كم قلم»). الاستفهام بها يتصدّر الجملة في
 * العربية، فلا تُقبل إلا رمزاً أوّل. جرّبنا رمزين فصار «خرجت من البيت» سؤالاً،
 * وهذا أسوأ خطأ ممكن هنا: يجيب زبير حيث كان يجب أن يتعلّم.
 *
 * ملاحظة: «أين» و«متى» مكتوبتان بعد التطبيع («اين» و«متي») لأن المقارنة تجري
 * على الرموز المطبّعة لا على ما كتبه الأب. */
const QUESTION_TOOLS_AMBIGUOUS: readonly string[] = ['ما', 'من', 'كم'];
const AMBIGUOUS_WINDOW = 1;

/** الأدوات كلها — يفيد منها جذع الدماغ وبروكا فلا تُكتب القائمة مرّتين. */
export const QUESTION_WORDS: readonly string[] = [
  ...QUESTION_TOOLS_STRONG,
  ...QUESTION_TOOLS_AMBIGUOUS,
];

/* وزن ملامح الحروف في التمثيل الابتدائي لكلمة جديدة. الباقي من التهيئة
 * العشوائية: صفر عشوائية يعني أن كلمتين اصطدمت ملامحهما تصيران كلمة واحدة
 * لا يفرّقها الدماغ أبداً، وكلّ عشوائية يعني بداية بلا أي تخمين صرفي. */
const MORPHOLOGY_PRIOR = 0.8;

/**
 * مفتاح الكلمة في خريطة المعجم: أوّل رمز يُخرجه المجزِّئ.
 *
 * ليس التطبيع وحده: الفصوص الأخرى تنادي المعجم بكلمة قد تكون ملتصقة بترقيم
 * («قطة!») أو محفوفة بمسافة، ومفاتيح الخريطة تأتي كلها من `tokenize`. لو
 * اختلف طريق المفتاح عن طريق التخزين صارت كلمة يعرفها زبير لا يجدها.
 */
function wordKey(word: string): string {
  return tokenize(word)[0] ?? '';
}

/** علامة الاستفهام أوّلاً، ثم الأدوات: العلامة قاطعة والأدوات مرجّحة. */
function detectQuestion(normalized: string, tokens: readonly string[]): boolean {
  if (normalized.includes('؟') || normalized.includes('?')) return true;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (QUESTION_TOOLS_STRONG.includes(token)) return true;
    if (i < AMBIGUOUS_WINDOW && QUESTION_TOOLS_AMBIGUOUS.includes(token)) return true;
  }
  return false;
}

/**
 * المعجم: ما يعرفه زبير من كلمات، وتمثيل كل كلمة، وكم مرّة سمعها منك.
 *
 * ينمو بكلامك ولا يُبنى سلفاً: هذا الفص لا يملك قائمة مفردات عربية جاهزة،
 * وكل كلمة فيه دخلت من فمك.
 */
export class Lexicon implements Lobe<LexiconState> {
  readonly name = 'lexicon';
  readonly ar = 'منطقة شكل الكلمة';
  readonly role = 'يطبّع كلامك ويجزّئه كلمات ويمنح كلاً منها تمثيلاً، ويخمّن الغريبة من شكل حروفها';

  readonly embedding: Embedding;

  /** لكل كلمة مطبَّعة: صورها الأصلية كما كتبها الأب وعدد مرات كلٍّ منها */
  private surfaces = new Map<string, Map<string, number>>();

  private index = new Map<string, number>();
  private wordList: string[] = [];
  private counts: number[] = [];

  constructor(rng?: Rng) {
    // بذرة ثابتة لا Math.random: دماغ يبدأ من البذرة نفسها يمكن إثبات تعلّمه
    this.embedding = new Embedding(DIMS.word, rng ?? new Rng(0x2ec17));
  }

  get size(): number {
    return this.wordList.length;
  }

  idOf(word: string): number {
    const key = wordKey(word);
    if (key.length === 0) return -1;
    return this.index.get(key) ?? -1;
  }

  /**
   * يُنشئ تمثيلاً لكلمة جديدة ويعيد رقمها (أو رقمها القديم إن كان يعرفها).
   *
   * التمثيل الابتدائي ليس عشوائياً محضاً بل مزيج من ملامح حروف الكلمة: كلمة
   * تُسمع أول مرة تبدأ قريبة ممّا يشبهها صرفياً، فيصير التعميم ممكناً من
   * اللحظة الأولى بدل أن ينتظر دروساً تُقرّبها.
   */
  learn(word: string): number {
    const key = wordKey(word);
    // مدخل بلا حرف ولا رقم («؟» أو مسافة) ليس كلمة، ولا يجوز أن يشغل صفّاً
    if (key.length === 0) return -1;
    const known = this.index.get(key);
    if (known !== undefined) return known;

    const id = this.embedding.grow();
    // احتراس من حالة محفوظة عطبة تركت الجدولين غير متساويين: نردم الفرق بلا
    // استثناء، فرمي استثناء هنا يعني فقدان الدماغ كله
    while (this.wordList.length < id) {
      this.wordList.push('');
      this.counts.push(0);
    }
    const features = hashCharFeatures(key, vec(DIMS.word));
    const row = this.embedding.get(id);
    for (let i = 0; i < row.length; i++) {
      row[i] = MORPHOLOGY_PRIOR * features[i]! + (1 - MORPHOLOGY_PRIOR) * row[i]!;
    }
    this.wordList.push(key);
    this.counts.push(0);
    this.index.set(key, id);
    return id;
  }

  wordOf(id: number): string | null {
    return this.wordList[id] ?? null;
  }

  /* بلا نسخة: الجُداري يمرّ على كل الكلمات في كل تعميم، ونسخ مئات الكلمات في
   * كل نبضة كلفة بلا مقابل. النوع `readonly` هو العقد الذي يحمي القائمة. */
  words(): readonly string[] {
    return this.wordList;
  }

  /**
   * صورة الكلمة كما يكتبها الأب — بها يتكلّم زبير فلا يبدو جاهلاً بالإملاء.
   *
   * تُجرَّب ثلاث محاولات بالترتيب: الكلمة نفسها، ثم معرَّفةً بـ«ال» (لأن الفص
   * الجُداري يُسقط التعريف من مفاتيح الحقائق فيصير المفتاح «قطه» والأب كتب
   * «القطة»)، ثم الكلمة كما هي إن لم يُسمع لها صورة قط.
   */
  pretty(word: string): string {
    if (typeof word !== 'string' || word.length === 0) return '';
    const direct = this.bestSurface(word);
    if (direct) return direct;
    const definite = this.bestSurface(`ال${word}`);
    // نُسقط «ال» من الصورة المسموعة كي يبقى ما يعيده الجُداري مطابقاً لما طلبه
    if (definite && definite.length > 2) return definite.replace(/^(ال|أل|ٱل)/, '');
    return word;
  }

  /**
   * الصورة كما قيلت كاملةً، بأداة تعريفها إن سُمعت بها.
   *
   * و`pretty` تُسقط الأداة عمداً كي يبقى ما يعيده الجُداري مطابقاً لما طلبه،
   * وهذا صواب في المطابقة وخطأ في الكلام: «بحر أزرق» كلامُ طفل، و«البحر أزرق»
   * كلام شاب. فيُفصَل الاستعمالان.
   */
  asSaid(word: string): string {
    if (typeof word !== 'string' || word.length === 0) return '';
    const definite = this.bestSurface(`ال${word}`);
    if (definite) return definite;
    /* والصور المطابقة لتطبيعها لا تُحفَظ (لا فائدة في حفظها)، فتُبنى بناءً:
     * إن كان يعرف «البحر» رمزاً فقد سمعها معرَّفة، فيقولها كما سمعها. */
    if (this.idOf(`ال${word}`) >= 0) return `ال${word}`;
    return this.pretty(word);
  }

  private bestSurface(normalized: string): string | null {
    const seen = this.surfaces.get(normalized);
    if (!seen || seen.size === 0) return null;
    let best: string | null = null;
    let most = 0;
    for (const [surface, count] of seen) {
      if (count > most) {
        most = count;
        best = surface;
      }
    }
    return best;
  }

  /** يقرن كل رمز مطبَّع بصورته الأصلية. لا يُقرن إلا إن تطابق العددان: تفاوتهما
   *  يعني أن التطبيع دمج رمزين أو فصلهما، والقرن حينها يُنسب صورة لكلمة أخرى. */
  private rememberSurfaces(raw: string, tokens: readonly string[]): void {
    const surfaceTokens = tokenizeSurface(raw);
    if (surfaceTokens.length !== tokens.length) return;
    for (let i = 0; i < tokens.length; i++) {
      const key = tokens[i]!;
      const surface = surfaceTokens[i]!;
      if (surface === key) continue; // لا شيء يُحفظ: الصورة هي المطبَّع نفسه
      let seen = this.surfaces.get(key);
      if (!seen) {
        seen = new Map<string, number>();
        this.surfaces.set(key, seen);
      }
      seen.set(surface, (seen.get(surface) ?? 0) + 1);
      // صورتان أو ثلاث تكفيان: الأب لا يكتب الكلمة بعشر صور، والحدّ يمنع نمو
      // ملف الدماغ بأخطاء مطبعية عابرة
      if (seen.size > 4) {
        const kept = [...seen.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
        this.surfaces.set(key, new Map(kept));
      }
    }
  }

  countOf(word: string): number {
    const id = this.idOf(word);
    if (id < 0) return 0;
    return this.counts[id] ?? 0;
  }

  /**
   * أكثر ما يقوله الأب. منه تتعلّم بروكا أسلوبه لاحقاً: بادئاته المتكرّرة
   * وكلماته المحبوبة. الكلمات التي لم تُسمع في جملة (عدّادها صفر) تُستثنى
   * لأنها ليست من كلامه بل من تعليم مباشر أو من استعادة معجم.
   */
  topWords(n: number): Array<{ word: string; count: number }> {
    const limit = Math.max(0, Math.floor(n));
    if (limit === 0) return [];
    const heard: Array<{ word: string; count: number }> = [];
    for (let id = 0; id < this.wordList.length; id++) {
      const count = this.counts[id] ?? 0;
      if (count > 0) heard.push({ word: this.wordList[id]!, count });
    }
    // ترتيب Array.sort مستقرّ في المواصفة، فتساوي العدّادين يُفكّ بالأقدم
    // تعلّماً — ترتيب ثابت بلا عشوائية كي يكون الخرج قابلاً للاختبار
    heard.sort((a, b) => b.count - a.count);
    return heard.slice(0, limit);
  }

  /**
   * الإدراك الكامل لجملة واحدة.
   *
   * `learnNew=false` لا يغيّر شيئاً في المعجم: لا كلمة تُنشأ ولا عدّاد يرتفع.
   * هذا شرط قياس التعميم بلا تسريب — لو نما المعجم أثناء التقييم صار الاختبار
   * يقيس الحفظ لا التعميم.
   */
  perceive(text: string, learnNew: boolean): Percept {
    const raw = typeof text === 'string' ? text : '';
    const tokens = tokenize(raw);
    if (learnNew) this.rememberSurfaces(raw, tokens);
    const ids: number[] = [];
    const unknown: string[] = [];
    const tokenVecs: Vec[] = [];
    const charBag = vec(DIMS.word);
    const features = vec(DIMS.word);

    for (const token of tokens) {
      // الرموز خارجة من tokenize مطبّعة أصلاً، فلا نطبّع مرّتين في كل نبضة
      let id = this.index.get(token) ?? -1;
      if (id < 0) {
        // «مجهول» يعني: لم يكن في معجمه قبل هذه الجملة. حتى لو أنشأناه الآن
        // فهو كلمة بلا معنى بعد، ومنه يرتفع فضوله ومنه يسأل
        unknown.push(token);
        hashCharFeatures(token, features);
        for (let i = 0; i < charBag.length; i++) charBag[i]! += features[i]!;
        if (learnNew) id = this.learn(token);
      }
      if (learnNew && id >= 0) this.counts[id] = (this.counts[id] ?? 0) + 1;
      ids.push(id);
      // نسخة لا الصفّ نفسه: فصٌّ يكتب في المتجه الذي استلمه لا يجوز أن يُتلف
      // ذاكرة كلمة في المعجم
      tokenVecs.push(id >= 0 ? this.embedding.get(id).slice() : features.slice());
    }

    // متوسط لا مجموع: مقدار الحصيلة يجب ألّا يكبر بعدد المجهولات، فالعدد نفسه
    // يسافر مستقلاً إلى الوطاء (unknownCount). القسمة على واحد لا تفعل شيئاً.
    if (unknown.length > 1) scaleInto(charBag, 1 / unknown.length);

    return {
      raw,
      tokens,
      ids,
      unknown,
      tokenVecs,
      charBag,
      isQuestion: detectQuestion(normalizeArabic(raw), tokens),
    };
  }

  save(): LexiconState {
    return {
      dim: DIMS.word,
      words: this.wordList.slice(),
      counts: this.counts.slice(),
      embedding: this.embedding.save(),
      surfaces: [...this.surfaces.entries()].map(([key, seen]) => [key, [...seen.entries()]]),
    };
  }

  /**
   * استعادة المعجم. كل شيء هنا مبنيّ على ألّا يُرمى استثناء ولا تُقبل حالة
   * نصف صحيحة: الحالة المطابقة تُحمَّل كاملة، وأي شكّ يُترك المعجم كما هُيّئ.
   * معجم نصف محمَّل (كلمات بلا تمثيلات) أسوأ من معجم فارغ.
   */
  load(state: LexiconState): void {
    try {
      const candidate: unknown = state;
      if (candidate === null || typeof candidate !== 'object') return;
      const raw = candidate as Partial<LexiconState>;
      if (raw.dim !== DIMS.word) return;

      const words = raw.words;
      const counts = raw.counts;
      const embedding: Partial<EmbeddingState> | null | undefined = raw.embedding;
      if (!Array.isArray(words) || !Array.isArray(counts)) return;
      if (embedding === null || embedding === undefined || typeof embedding !== 'object') return;
      if (embedding.dim !== DIMS.word) return;
      if (!words.every((word) => typeof word === 'string')) return;

      /* التمثيلات: مضغوطةً كتلةً واحدة، أو صفوفاً في الأدمغة المحفوظة قبل
       * الضغط. والفحص **بعد** الفكّ لا قبله — وNaN واحد في تمثيل كلمة يُفسد
       * كل حساب يمرّ عليه بلا أثر ظاهر. */
      let vectors: Float32Array | null = null;
      if (typeof embedding.packed === 'string') {
        /* وعددُ الصفوف يُفحَص صراحةً: الفكُّ يقتطع ما زاد بلا شكوى، فبلا هذا
         * الفحص يُقرأ معجمُ ثلاث كلماتٍ على أنه معجمُ كلمتين — وتُنسَب
         * تمثيلاتٌ إلى كلماتٍ ليست لها. */
        if (embedding.count !== words.length) return;
        vectors = checkedVec(embedding.packed, words.length * DIMS.word);
      } else if (Array.isArray(embedding.rows)) {
        // مفردات وتمثيلات غير متساوية: لا نعرف أي كلمة لأي صفّ، فالتجاهل أسلم
        if (embedding.rows.length !== words.length) return;
        const flat = new Float32Array(words.length * DIMS.word);
        for (let i = 0; i < embedding.rows.length; i++) {
          const row: unknown = embedding.rows[i];
          if (!Array.isArray(row) || row.length !== DIMS.word) return;
          /* والصفُّ القديم يُنظَّف ولا يُردّ: عددٌ واحد NaN في ملفٍّ قديم لا
           * يجوز أن يُفقد المعجم كلَّه، وتصفيرُ خانةٍ أهون من فقدان الكلمات.
           * أما الكتلة المضغوطة فتُردّ كلُّها — لأن عطبها عطبُ ترميزٍ لا
           * عطبُ قيمة، ولا يُوثَق بجزءٍ منها. */
          for (let j = 0; j < DIMS.word; j++) {
            const v: unknown = row[j];
            flat[i * DIMS.word + j] = typeof v === 'number' && Number.isFinite(v) ? v : 0;
          }
        }
        vectors = flat;
      }
      if (!vectors) return;

      const rows: number[][] = [];
      for (let i = 0; i < words.length; i++) {
        rows.push(Array.from(vectors.subarray(i * DIMS.word, (i + 1) * DIMS.word)));
      }

      const safeCounts = rows.map((_, i) => {
        const c = counts[i];
        return typeof c === 'number' && Number.isFinite(c) && c > 0 ? Math.floor(c) : 0;
      });

      // لا تبديل قبل أن يجتاز كل شيء الفحص: هنا فقط تُمسّ الحالة
      this.embedding.load({ dim: DIMS.word, rows });
      this.wordList = words.slice();
      this.counts = safeCounts;
      this.index = new Map<string, number>();
      for (let id = 0; id < this.wordList.length; id++) {
        const word = this.wordList[id]!;
        if (word.length > 0) this.index.set(word, id);
      }

      // الصور اختيارية: دماغ محفوظ قبل هذه الإضافة يبقى صالحاً، وأسوأ ما يحدث
      // أن يتكلّم بالصورة المطبَّعة حتى يسمع الكلمة من أبيه مرة أخرى
      this.surfaces = new Map<string, Map<string, number>>();
      if (Array.isArray(state.surfaces)) {
        for (const entry of state.surfaces) {
          if (!Array.isArray(entry) || typeof entry[0] !== 'string' || !Array.isArray(entry[1])) continue;
          const seen = new Map<string, number>();
          for (const pair of entry[1]) {
            if (!Array.isArray(pair) || typeof pair[0] !== 'string') continue;
            const count = typeof pair[1] === 'number' && Number.isFinite(pair[1]) ? Math.max(1, Math.floor(pair[1])) : 1;
            seen.set(pair[0], count);
          }
          if (seen.size > 0) this.surfaces.set(entry[0], seen);
        }
      }
    } catch {
      // حارس أخير: المدخل ملفٌّ على جهاز الأب وقد يكون أي شيء. فقدان درس
      // أهون من فقدان دماغ.
    }
  }
}
