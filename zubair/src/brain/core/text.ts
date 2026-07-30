/* ————— الحاسّة ومنطقة شكل الكلمة —————
 *
 * هذا أول ما يلمس كلامك في دماغ زبير. وظيفته أن يحوّل حرفاً كتبتَه على جوالك
 * إلى شيء يستطيع باقي الدماغ التفكير به: رموز مطبّعة، ورقم لكل كلمة يعرفها،
 * ومتجه ملامح لكل كلمة لم يسمعها في حياته.
 *
 * القرار المركزي هنا أن الكلمة المجهولة لا تُرمى ولا تُعامل رمزاً واحداً
 * («UNK» كما تفعل الشبكات الجاهزة)، بل تُمثَّل بشكل حروفها. لأن الطفل الذي
 * يسمع «يكتب» أول مرة وقد سمع «كاتب» قبلها لا يبدأ من الصفر: شكل الكلمة
 * نفسه دليل على معناها في لغة اشتقاقية كالعربية. هذا هو الفرق بين دماغ
 * يخمّن ودماغ ينتظر أن تُعلّمه كل صورة من صور الجذر على حدة.
 */

import { Embedding, type EmbeddingState } from './net.js';
import { Rng, norm, scaleInto, vec, type Vec } from './tensor.js';
import { DIMS, type Lobe } from './types.js';

/* ————— التطبيع ————— */

/* محارف اتجاه وصفر-عرض تلتصق بالنصّ المنسوخ من تطبيقات المحادثة. لا تُرى
 * بالعين لكنها تجعل «قطة» و«قطة» كلمتين مختلفتين في الخريطة. */
const INVISIBLE = /[​-‏؜﻿]/g;

/* التشكيل والمدّ القرآني: صوت لا معنى. «قِطَّة» و«قطة» كلمة واحدة عند زبير،
 * ولو لم نحذفها لصار لكل حركة معجم منفصل. المدى مأخوذ بالحرف من عقد التوصيل:
 * ً-ْ الحركات والسكون والشدّة، ٰ الألف الخنجرية، ۖ-ۭ
 * علامات الوقف والتجويد. تُكتب بالترميز لا بالحرف لأنها كلها غير مرئية. */
const DIACRITICS = /[ً-ْٰۖ-ۭ]/g;

/* التطويل («ســلام») زخرفة خطّية لا حرف. */
const TATWEEL = /ـ/g;

/* الألفات: آ أ إ ٱ ← ا. الأب يكتب على جوال بلا همزات نصف الوقت، ولو فرّقنا
 * بينها لصار «أسد» و«اسد» شيئين لا يجمعهما شيء. */
const ALEFS = /[آأإٱ]/g;
const YA_MAQSURA = /ى/g;
const TA_MARBUTA = /ة/g;

const ARABIC_INDIC_DIGITS = /[٠-٩۰-۹]/g;
const WHITESPACE = /\s+/g;

/** يوحّد الأرقام العربية-الهندية (٠-٩) والفارسية (۰-۹) إلى 0-9 كي يكون «٣» و«3» عدداً واحداً. */
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
  out = collapseRepeats(out);
  // العربية بلا حالة أحرف، والتصغير يخصّ ما يدخل من إنجليزية: «Zubair» و«zubair» اسم واحد
  return out.toLowerCase().replace(WHITESPACE, ' ').trim();
}

/* ————— التجزئة ————— */

/* كل ما ليس حرفاً ولا رقماً فاصلٌ. عقد التوصيل يسمّي الفواصل عدّاً (، ؛ ؟ ! . :
 * « » " ' ( ) - —) وكلها داخلة في هذا التعريف، ويكسب معها ما لم يُعدّ: الرموز
 * التعبيرية وعلامات الترقيم الغريبة. الأصل قائمة بيضاء لا سوداء، لأن ما نجهله
 * من الرموز أكثر ممّا نعرفه. */
const WORD_RUN = /[\p{L}\p{N}]+/gu;

/**
 * يفكّ الجملة إلى كلمات مطبّعة. لا يُحذف شيء لأنه «كلمة وظيفية»: أدوات
 * الاستفهام وحروف الجرّ هي حاملة القصد عند زبير، وحذفها — كما تفعل قوائم
 * الكلمات الموقوفة في معالجة النصوص — يمحو السؤال نفسه فيصير كلاماً عادياً.
 */
export function tokenize(text: string): string[] {
  const normalized = normalizeArabic(text);
  if (normalized.length === 0) return [];
  return normalized.match(WORD_RUN) ?? [];
}

/* ————— ملامح الحروف ————— */

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/**
 * FNV-1a بمِلح، مكتوبة بيدنا (لا مكتبة)، بخطوة خلط أخيرة.
 *
 * الخلط ضروري: البتات الدنيا في FNV الخام مرتبطة بآخر محرف ارتباطاً قوياً،
 * ونحن نأخذ رقم البُعد من البتات الدنيا (`h % out.length`) والإشارة من البتّ
 * الأعلى. بلا خلط تصير الثلاثيات المنتهية بالحرف نفسه في بُعد واحد دائماً.
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

/* حروف العلّة والمدّ التي تحشرها الصرف العربي بين حروف الجذر. حذفها يُخرج
 * «هيكل» الكلمة: «كاتب» ← «كتب» و«يكتب» ← «كتب». هذه القناة الثانية هي ما
 * يجعل صورتي الجذر الواحد متقاربتين قبل أن يتعلّمهما. */
const WEAK_LETTERS = /[اوي]/g;

/* وزن قناة الهيكل أقلّ من قناة الحروف الكاملة: الهيكل تخمين صرفي قد يخطئ
 * («يمين» ليست من جذر «من»)، فلا يجوز أن يطغى على الشكل الفعلي للكلمة. */
const SKELETON_WEIGHT = 0.6;

/* مِلح مختلف لكل قناة: القناتان فضاءان منفصلان في الجدول نفسه، وإلا زاحمت
 * ثلاثيات الهيكل ثلاثيات الحروف في البُعد ذاته بالمصادفة. */
const SALT_FULL = 0x00;
const SALT_SKELETON = 0x9e37;

/* كل ثلاثية توزّع على بُعدين بهاشين مستقلّين بوزن ‎1/√2‎ لكل منهما. السبب
 * إحصائي: الاصطدام في جدول من ٤٨ بُعداً يُدخل ضجيجاً على التشابه، وتوزيع
 * الملمح على بُعدين يقسم تباين هذا الضجيج تقريباً بالنصف بلا زيادة الأبعاد. */
const PROBES = 2;
const PROBE_SCALE = 1 / Math.SQRT2;

function scatter(out: Vec, gram: string, weight: number, salt: number): void {
  for (let p = 0; p < PROBES; p++) {
    const h = fnv1a(gram, salt + p * 0x1000193);
    const index = h % out.length;
    // الإشارة من البتّ الأعلى: نصف الملامح سالب فتُلغي الاصطدامات بعضها في
    // المتوسط بدل أن تتراكم زيفاً — هذه فائدة «الإشارة الموزّعة»
    const sign = (h >>> 31) & 1 ? -1 : 1;
    out[index]! += sign * weight * PROBE_SCALE;
  }
}

/** يوزّع ثلاثيات «^كلمة$» على أبعاد المتجه. الحدّان يميّزان البادئة واللاحقة عن الوسط. */
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
}

/* أدوات لا تكون إلا استفهاماً، فحضورها في أي موضع سؤال. */
const QUESTION_TOOLS_STRONG: readonly string[] = [
  'ماذا', 'شو', 'مين', 'كيف', 'ليش', 'لماذا', 'هل', 'اين', 'وين', 'متي',
];

/* أدوات مشتركة: «من» جرٌّ أيضاً («من البيت»)، و«ما» نفيٌ في الشامية («ما بعرف»)،
 * و«كم» خبريّة. الاستفهام في العربية يتصدّر الجملة، فنقبلها في أول رمزين فقط.
 * بلا هذا القيد يصير كل كلام الأب سؤالاً، فيجيب زبير حيث كان يجب أن يتعلّم. */
const QUESTION_TOOLS_AMBIGUOUS: readonly string[] = ['ما', 'من', 'كم'];
const AMBIGUOUS_WINDOW = 2;

/** الأدوات كلها — يفيد منها جذع الدماغ وبروكا فلا تُكتب القائمة مرّتين. */
export const QUESTION_WORDS: readonly string[] = [
  ...QUESTION_TOOLS_STRONG,
  ...QUESTION_TOOLS_AMBIGUOUS,
];

/* وزن ملامح الحروف في التمثيل الابتدائي لكلمة جديدة. الباقي من التهيئة
 * العشوائية: صفر عشوائية يعني أن كلمتين تصطدم ملامحهما تصيران كلمة واحدة
 * لا يفرّقهما الدماغ أبداً، وكل العشوائية تعني بداية بلا أي تخمين صرفي. */
const MORPHOLOGY_PRIOR = 0.8;

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
    const key = normalizeArabic(word);
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
    const key = normalizeArabic(word);
    if (key.length === 0) return -1;
    const known = this.index.get(key);
    if (known !== undefined) return known;

    const id = this.embedding.grow();
    // احتراس من حالة محفوظة عطبة تركت الجدولين غير متساويين: نردم الفرق بلا
    // استثناء، فرمي الاستثناء هنا يعني فقدان الدماغ كله
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

  words(): readonly string[] {
    return this.wordList;
  }

  countOf(word: string): number {
    const id = this.idOf(word);
    if (id < 0) return 0;
    return this.counts[id] ?? 0;
  }

  /**
   * أكثر ما يقوله الأب. منه تتعلّم بروكا أسلوبه لاحقاً: بادئاته المتكرّرة
   * وكلماته المحبوبة. الكلمات التي لم تُسمع في جملة (عدّادها صفر) تُستثنى
   * لأنها ليست من كلامه بل من تعليم مباشر.
   */
  topWords(n: number): Array<{ word: string; count: number }> {
    const limit = Math.max(0, Math.floor(n));
    if (limit === 0) return [];
    const heard: Array<{ word: string; count: number }> = [];
    for (let id = 0; id < this.wordList.length; id++) {
      const count = this.counts[id] ?? 0;
      if (count > 0) heard.push({ word: this.wordList[id]!, count });
    }
    // ترتيب Array.sort مستقرّ في المواصفة، فالتساوي في العدّاد يُفكّ بالأقدم
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

    if (unknown.length > 1) scaleInto(charBag, 1 / unknown.length);

    ids.length === tokens.length;
    const normalized = normalizeArabic(raw);
    return {
      raw,
      tokens,
      ids,
      unknown,
      tokenVecs,
      charBag,
      isQuestion: detectQuestion(normalized, tokens),
    };
  }

  save(): LexiconState {
    return {
      dim: DIMS.word,
      words: this.wordList.slice(),
      counts: this.counts.slice(),
      embedding: this.embedding.save(),
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
      const embedding = raw.embedding as Partial<EmbeddingState> | undefined | null;
      if (!Array.isArray(words) || !Array.isArray(counts)) return;
      if (!embedding || typeof embedding !== 'object') return;
      if (embedding.dim !== DIMS.word || !Array.isArray(embedding.rows)) return;
      // مفردات وتمثيلات غير متساوية: لا نعرف أي كلمة لأي صفّ، فالتجاهل أسلم
      if (embedding.rows.length !== words.length) return;
      if (!words.every((word) => typeof word === 'string')) return;

      const rows: number[][] = [];
      for (const row of embedding.rows) {
        if (!Array.isArray(row) || row.length !== DIMS.word) return;
        // قيمة غير عددية تصير NaN في Float32Array، وNaN واحد في تمثيل كلمة
        // يُفسد كل حساب يمرّ عليه لاحقاً بلا أثر ظاهر
        rows.push(row.map((x) => (typeof x === 'number' && Number.isFinite(x) ? x : 0)));
      }

      const savedMoments = Array.isArray(embedding.moments) ? embedding.moments : [];
      const moments = rows.map((_, i) => {
        const m = savedMoments[i];
        if (!Array.isArray(m) || m.length !== DIMS.word) return new Array<number>(DIMS.word).fill(0);
        return m.map((x) => (typeof x === 'number' && Number.isFinite(x) ? x : 0));
      });

      const safeCounts = rows.map((_, i) => {
        const c = counts[i];
        return typeof c === 'number' && Number.isFinite(c) && c > 0 ? Math.floor(c) : 0;
      });

      // لا تبديل قبل أن يجتاز كل شيء الفحص: هنا فقط تُمسّ الحالة
      this.embedding.load({ dim: DIMS.word, rows, moments });
      this.wordList = words.slice();
      this.counts = safeCounts;
      this.index = new Map<string, number>();
      for (let id = 0; id < this.wordList.length; id++) {
        const word = this.wordList[id]!;
        if (word.length > 0) this.index.set(word, id);
      }
    } catch {
      // حارس أخير: المدخل من ملف على جهاز الأب وقد يكون أي شيء. فقدان درس
      // أهون من فقدان دماغ.
    }
  }
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
