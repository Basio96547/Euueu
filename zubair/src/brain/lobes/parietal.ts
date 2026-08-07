/* ————— الفص الجُداري: الربط —————
 *
 * الصدغي يفهم الجملة، والحُصين يحفظها كما قيلت، وهذا الفص يفعل شيئاً ثالثاً
 * أهمّ منهما: يستخلص من الجملة **علاقة** تبقى بعد أن تُنسى الجملة نفسها. «القطة
 * حيوان» تُحفظ في الحُصين نصّاً، لكن ما ينفع زبير بعد شهر هو الحقيقة المجرّدة
 * «قطة ← حيوان» بثقةٍ يعرف مقدارها.
 *
 * ثلاثة قرارات حاكمة هنا، وكلها ضدّ الاختراع:
 *
 * ١) الاستخلاص أنماط عربية صريحة لا تخمين. الطرف الذي لا يتحقّق يُعاد `null`،
 *    لأن حقيقة ملفّقة أسوأ من لا حقيقة: زبير يجيب بها واثقاً فيتعلّم أبوه أن
 *    يكذّبه، وهذا أسوأ ما يمكن أن يحدث لطفل يتعلّم من أبيه وحده.
 *
 * ٢) الثقة تقاربية لا خطّية. التكرار يقرّبها من الواحد ولا يبلغه أبداً، فلا
 *    توجد في دماغه حقيقة لا تقبل النقض.
 *
 * ٣) التعارض لا يمحو. من علّمه «القطة حيوان» ثم قال «القطة نبات» لا يقلب
 *    معرفته من كلمة، بل يُحفظ المحمول الثاني بديلاً متنازعاً، والغالب هو الأعلى
 *    ثقة. الطفل يقلب معرفته بالإصرار لا بالمرّة الواحدة.
 */

import { hashCharFeatures, tokenize, QUESTION_WORDS, type Lexicon, type Percept } from '../core/text.js';
import { clamp, cosine, vec, type Vec } from '../core/tensor.js';
import { DIMS, type Fact, type Intent, type Lobe } from '../core/types.js';
import type { RelationKind } from './syntax.js';

/* ————— الأرقام المعلنة —————
 * كلها هنا في أعلى الملف لا مبثوثة في المنطق: عتبة مخفيّة داخل دالة عتبةٌ لا
 * يستطيع الأب مناقشتها. */

/** ثقة الحقيقة عند أول سماع. معتدلة بقصد: درس واحد يكفي ليعرف، ولا يكفي ليجزم. */
const INITIAL_CONFIDENCE = 0.6;

/** نصيب ما بقي من الطريق إلى الواحد في كل تكرار: c ← c + (1 − c) × ٠٫٣٥.
 *  الصيغة تقاربية فلا تتجاوز الواحد أبداً مهما كرّر الأب، ولا تحتاج قصراً. */
const REINFORCE_RATE = 0.35;

/** ما يبقى من الثقة بعد تكذيب واحد. القسوة مقصودة: كلمة «خطأ» من الأب أثقل من
 *  ثلاث تكرارات صحيحة، لأنها الإشارة الوحيدة التي لا يملكها زبير من نفسه. */
const CONTRADICT_FACTOR = 0.4;

/** دون هذه الثقة لا تبقى الحقيقة في دماغه: خير له أن يجهل من أن يعرف خطأ. */
const DOUBT_FLOOR = 0.2;

/** فرقُ ثقةٍ دونه يُعدّ النزاع قائماً. فوقه استقرّ الأب على قولٍ وانقضى. */
const CONTEST_LIVE = 0.15;

/**
 * أقلّ تشابه يُبيح نقل محمول إلى موضوع لم يُعلَّم قط.
 *
 * التعميم بلا عتبة تخريف: بلا هذا الرقم يصير كل مجهول «حيواناً» لأن شيئاً ما في
 * دماغه أقرب إليه من غيره — والأقرب ليس قريباً بالضرورة.
 *
 * والرقم مقيس لا مُقدَّر، وقد صُحّح بعد قياس: كان ٠٫٥٥ فكان **فوق الإشارة
 * كلها**، فلم يعمّم زبير قط ولا مرة واحدة — ميزة موثّقة لا تعمل. القياس على
 * ملامح الحروف في ٤٨ بُعداً يعطي: كلمات الجذر الواحد ٠٫٣٤–٠٫٤٠ (متوسط ٠٫٣٧٥)،
 * وكلمات لا صلة بينها ‎-0.04‎ في المتوسط وأعلاها ٠٫٢٣. فالعتبة الصادقة بينهما:
 * فوق أعلى ضجيج مرصود بهامش، ودون متوسط الجذر الواحد.
 */
const GENERALIZE_THRESHOLD = 0.3;

/**
 * وأقرب شبيه لا يكفي أن يتجاوز العتبة، بل يجب أن يسبق الذي بعده بهذا الهامش.
 *
 * السبب أن أقصى قيمة بين مرشّحين ترتفع بعددهم وحده: دماغ فيه مئة حقيقة سيجد
 * فيها ما يبلغ ٠٫٣ بالمصادفة لا بالشبه. والهامش يسأل سؤالاً آخر: هل هذا شبيهٌ
 * **مميَّز** أم أن الكل متساوٍ في بعده؟ فإن تساووا فلا شبه أصلاً.
 */
const GENERALIZE_MARGIN = 0.05;

/** وسم الميراث كما يُكتب في `taughtBy`. يُعاد هنا نصّاً لا استيراداً كي لا
 *  يعتمد فصٌّ معرفيّ على ملفّ محتوى. */
const HERITAGE_MARK = 'الميراث';

/**
 * مصادرُ دون الأب: تُزاح بكلمته من أول مرة ولا تنازعه.
 *
 * والميراثُ عربيةُ محيطٍ عامّة، والمقروءُ كتابٌ لا يسمع الجواب فيصحّحه. وكلاهما
 * ينفع حتى يتكلّم الأب، فإذا تكلّم فقولُه الفصل — ولا معنى لأن ينازعه كتابٌ
 * ثماني مرات قبل أن يُصدَّق. وهذا نصفُ «التعلّم السريع»: ألّا يُعاند ما قرأ.
 */
const WEAKER_SOURCES: ReadonlySet<string> = new Set([HERITAGE_MARK, 'المقروء']);

/** أقلّ عدد حروف يبقى بعد نزع أداة التعريف. «الآن» ← «ان» ليس تجريداً بل تشويه. */
const MIN_STEM = 3;

/* ————— الأنماط العربية —————
 *
 * الترتيب في القوائم لا معنى له، لكن ترتيب **فحصها** في `bind` معنيّ: الأطول
 * أولاً كي لا يُقتطع «عبارة عن» عند «عن». */

/** روابط الجملة الاسمية: ما قبلها موضوع وما بعدها محمول. */
const LINKERS: ReadonlySet<string> = new Set(['هو', 'هي', 'هما', 'هم', 'يعني', 'تعني', 'معناها', 'معناه']);

/** الرابط المركّب «عبارة عن» — بعد التطبيع تصير التاء المربوطة هاءً. */
const COMPOUND_LINKER: readonly [string, string] = ['عباره', 'عن'];

/** أسماء الإشارة: «هذه تفاحة» تعليمٌ بالإشارة لا جملة اسمية. */
const DEMONSTRATIVES: ReadonlySet<string> = new Set([
  'هذا', 'هذه', 'هذي', 'هاد', 'هادا', 'هاي', 'هيدا', 'هيدي', 'هاذا', 'ذا',
]);

/** أفعال التسمية التي تتوسّط الإشارة ومحمولها: «هذه تُسمّى تفاحة». */
const NAMING_VERBS: ReadonlySet<string> = new Set([
  'تسمي', 'يسمي', 'تسميها', 'يسميها', 'نسميها', 'بنسميها', 'اسمها', 'اسمه', 'سميها',
]);

/** حروف وأدوات لا تكون طرفاً في علاقة، فتُقتطع من حافّتي كل جانب. */
const EDGE_PARTICLES: ReadonlySet<string> = new Set([
  'ال', 'و', 'ف', 'ب', 'ل', 'ك', 'في', 'من', 'عن', 'علي', 'الي', 'مع', 'عند',
  'هو', 'هي', 'كان', 'يكون', 'تكون', 'بيكون', 'صار', 'يصير', 'زي', 'مثل',
]);

/** ما لا يصلح موضوعاً ولا محمولاً بحال. أدوات الاستفهام تُستوردَ من الحاسّة
 *  فلا تُكتب القائمة مرّتين ولا تتباعد النسختان مع الوقت. */
const NON_NOMINAL: ReadonlySet<string> = new Set([
  ...QUESTION_WORDS,
  ...EDGE_PARTICLES,
  ...DEMONSTRATIVES,
  'انا', 'انت', 'انتي', 'انتم', 'احنا', 'نحن', 'هم', 'هما', 'هن',
  'الذي', 'التي', 'اللي', 'الذين',
  'احسنت', 'صح', 'تمام', 'برافو', 'مضبوط', 'صحيح', 'خطا', 'غلط', 'لا', 'مو', 'ليس',
  'مرحبا', 'سلام', 'السلام', 'هلا', 'اهلا', 'صباح', 'مساء', 'باي',
  'نعم', 'ايوا', 'اوك', 'شكرا', 'عفوا', 'يا',
]);

/** أدوات التعريف الملتصقة، الأطول أولاً كي لا يُنزع «ال» من «وال». */
const ARTICLE_PREFIXES: readonly string[] = ['وال', 'فال', 'بال', 'كال', 'ال', 'لل'];

/** القصود التي يجوز عندها قبول الجملة الاسمية بلا رابط — انظر `bind`. */
const TEACHING_INTENTS: ReadonlySet<Intent> = new Set<Intent>(['TEACH_FACT', 'TEACH_WORD', 'TEACH_NAME']);

/* ————— بنية الحقيقة في الذاكرة ————— */

/** حقيقة واحدة ومحمولها البديل المتنازع معها. */
interface FactRecord {
  main: Fact;
  /** المحمول الثاني الذي علّمه الأب مخالفاً. لا يُمحى الأول لأجله بل يتنازعان. */
  alt: Fact | null;
  /** نوع العلاقة — جزءٌ من هوية السجل لا وصفٌ له */
  relation: RelationKind;
}

/** ما يُكتب على جهاز الأب. أرقام ونصوص فقط: لا Float32Array ولا Map. */
export interface StoredFact {
  subject: string;
  object: string;
  confidence: number;
  taughtBy: string;
  lastSeenTick: number;
  altObject: string | null;
  altConfidence: number;
  /** نوع العلاقة — يُهمَل في الأدمغة المحفوظة قبل هذه الإضافة فتُقرأ «جنساً» */
  relation?: RelationKind;
}

/* نوع العلاقة يُستورَد من النحو ولا يُكتب هنا ثانيةً.
 *
 * كان مكتوباً في الملفّين معاً، فلمّا زِيدت «عدد» في أحدهما بقي الآخر على
 * أربعة — والنسختان تفترقان دائماً مع الوقت. وهذه ثالث قائمة تتكرّر في هذا
 * الدماغ فتفترق (سبقتها الحروف وأدوات الاستفهام)، والقاعدة صارت: ما يعرفه فصٌّ
 * لا يُعاد كتابته في فصٍّ آخر. */
export type { RelationKind };

export const RELATION_KINDS: readonly RelationKind[] = ['جنس', 'صفة', 'فعل', 'ملك', 'عدد'];

export interface ParietalState {
  facts: StoredFact[];
}

/* ————— أدوات نصّية ————— */

/** ينزع أداة التعريف إن بقي بعدها جذعٌ معتبر. */
function stripArticle(word: string): string {
  for (const prefix of ARTICLE_PREFIXES) {
    if (word.length >= prefix.length + MIN_STEM && word.startsWith(prefix)) {
      return word.slice(prefix.length);
    }
  }
  return word;
}

/**
 * مفتاح الحقيقة: أوّل رمز مطبَّع من النصّ بعد نزع أداة التعريف.
 *
 * يمرّ على `tokenize` نفسه الذي يبني رموز الحاسّة، فيصير «القطة» و«قطة!»
 * و«قطه» مفتاحاً واحداً. لو اختلف طريق المفتاح عن طريق التعليم صارت حقيقة
 * علّمها الأب لا يجدها ابنه.
 */
/**
 * مفتاح السجل: الموضوع ونوع العلاقة معاً.
 *
 * ضمُّ العلاقة إلى المفتاح هو ما يجعل «القطة حيوان» و«القطة صغيرة» تتعايشان
 * بدل أن تتقاتلا على موضع واحد. والفاصل محرفٌ لا يظهر في كلمة عربية فلا يلتبس.
 */
function recordKey(subject: string, relation: RelationKind): string {
  return `${subject}\u0000${relation}`;
}

function factKey(word: string): string {
  if (typeof word !== 'string') return '';
  return stripArticle(tokenize(word)[0] ?? '');
}

/** أهي كلمة معرَّفة بـ«ال»؟ الفعل العربي لا يقبل أداة التعريف، وهذا كل ما
 *  نملكه من صرف لنميّز الاسم من الفعل بلا محلّل صرفي. */
function isDefinite(word: string): boolean {
  return stripArticle(word) !== word;
}

export class Parietal implements Lobe<ParietalState> {
  readonly name = 'parietal';
  readonly ar = 'الفص الجُداري';
  readonly role = 'يستخلص من كلامك العلاقات: «س هو ص»، ويبني حقائق بثقة تتغيّر، ويعمّم على ما لم تعلّمه';

  private records = new Map<string, FactRecord>();

  /** عرض الحقائق الغالبة. يُبنى مرّة ويُبطَل عند كل تغيّر في العضوية أو الغلبة،
   *  لأن `metrics` تقرأ طوله في كل نبضة والبناء في كل مرّة عملٌ بلا مقابل. */
  private view: Fact[] | null = null;

  /** مخزنا متجهات التعميم. منفصلان لأن التشابه يقارن اثنين في اللحظة نفسها،
   *  ومخزن واحد يعني مقارنة متجه بنفسه. */
  private readonly queryVec: Vec = vec(DIMS.word);
  private readonly candidateVec: Vec = vec(DIMS.word);

  /* ————— الربط ————— */

  /**
   * يستخلص «س ← ص» من جملة واحدة بأنماط عربية صريحة.
   *
   * الجملة الاستفهامية تُرفض قبل كل نمط: السؤال لا يُثبت شيئاً، و«ما هي القطة؟»
   * لو مرّت على نمط «س هي ص» أنتجت حقيقة «ما ← قطة». موضوع السؤال يستخرجه
   * المُوصِل من أوزان انتباه المهاد لا من هنا.
   *
   * والجملة الاسمية بلا رابط («دمشق مدينة») أضعف الأدلّة كلها، فلا تُقبل إلا
   * حين يقول القصدُ إن الأب يُعلّم. الأنماط ذات الرابط تدلّ على نفسها فلا
   * تحتاج إذناً من القصد.
   */
  bind(percept: Percept, intent: Intent): { subject: string | null; object: string | null } {
    const empty = { subject: null, object: null };
    const tokens: readonly string[] | undefined = percept?.tokens;
    if (!Array.isArray(tokens) || tokens.length < 2) return empty;
    if (percept.isQuestion) return empty;

    const n = tokens.length;

    // ١) «س عبارة عن ص» — الرابط المركّب أولاً كي لا يُقرأ «عن» وحده
    for (let i = 1; i + 2 < n; i++) {
      if (tokens[i] === COMPOUND_LINKER[0] && tokens[i + 1] === COMPOUND_LINKER[1]) {
        return this.split(tokens, 0, i, i + 2, n);
      }
    }

    // ٢) «هذه ص» و«هذه تُسمّى ص» — تعليم بالإشارة. يُفحَص قبل الجملة الاسمية
    //    لأن «هذه تفاحة» كلمتان اسميّتان في الظاهر وليست جملة اسمية
    const first = tokens[0]!;
    if (DEMONSTRATIVES.has(first)) {
      let start = 1;
      while (start < n && (NAMING_VERBS.has(tokens[start]!) || LINKERS.has(tokens[start]!))) start++;
      const object = this.headOf(tokens, start, n);
      // الموضوع هو لفظة الإشارة نفسها: ما يشير إليه الأب ليس في الجملة، وكل ما
      // نملكه منه هذه اللفظة. ولذلك تُبنى مباشرة ولا تمرّ على فحص الاسمية الذي
      // يرفض أسماء الإشارة
      return object === null ? empty : { subject: first, object };
    }

    // ٣) روابط الجملة الاسمية المفردة: «س هو ص» و«س هي ص» و«س يعني ص»
    for (let i = 1; i + 1 < n; i++) {
      if (LINKERS.has(tokens[i]!)) return this.split(tokens, 0, i, i + 1, n);
    }

    // ٤) «س من ص». «من» رابط مشترك: في «خرجت من البيت» ليس رابطاً بل حرف جرّ
    //    لفعل، فلا نقبله إلا إذا كان الطرف الأيسر معرَّفاً بـ«ال». هذا يُفقدنا
    //    «دمشق من سوريا»، والفقد أرخص من فبركة «خرجت ← بيت»
    for (let i = 1; i + 1 < n; i++) {
      if (tokens[i] !== 'من') continue;
      if (!isDefinite(tokens[0]!)) break;
      return this.split(tokens, 0, i, i + 1, n);
    }

    // ٥) الجملة الاسمية بلا رابط: كلمتان اسميّتان وقصدٌ يقول إنه يُعلّم
    if (n === 2 && TEACHING_INTENTS.has(intent)) {
      return this.split(tokens, 0, 1, 1, 2);
    }

    return empty;
  }

  /** يبني الطرفين من مجالين من الرموز، ويرفض التطابق: «القطة هي القطة» ليست
   *  حقيقة بل ترديد، وحفظها يجعل زبير يجيب عن السؤال بالسؤال. */
  private split(tokens: readonly string[], ls: number, le: number, rs: number, re: number):
    { subject: string | null; object: string | null } {
    const subject = this.headOf(tokens, ls, le);
    const object = this.headOf(tokens, rs, re);
    if (subject === null || object === null || subject === object) return { subject: null, object: null };
    return { subject, object };
  }

  /**
   * رأس الجانب: أوّل كلمة معتبرة بعد قطع الحروف الزائدة من الحافّتين، مجرّدةً
   * من أداة التعريف.
   *
   * ولماذا الأولى لا الأخيرة: العربية تقدّم رأس المركّب على وصفه («القطة
   * الصغيرة» رأسها «قطة»)، فالأولى هي المحمول عليه لا الأخيرة.
   */
  private headOf(tokens: readonly string[], start: number, end: number): string | null {
    let s = start;
    let e = end;
    while (s < e && EDGE_PARTICLES.has(tokens[s]!)) s++;
    while (e > s && EDGE_PARTICLES.has(tokens[e - 1]!)) e--;
    if (s >= e) return null;
    const head = stripArticle(tokens[s]!);
    // حرف واحد ليس كلمة، وما كان أداةً لا يصير موضوعاً بنزع أداة التعريف عنه
    if (head.length < 2 || NON_NOMINAL.has(head) || NON_NOMINAL.has(tokens[s]!)) return null;
    return head;
  }

  /* ————— الحقائق ————— */

  /**
   * يُثبّت حقيقة أو يقوّيها.
   *
   * التوقيع لا يقبل `null`، ومدخلٌ لا يبقى منه حرف («؟» أو مسافة) ليس حقيقة.
   * فنُعيد وصفاً عابراً بثقة صفر ولا نُخزّنه: الرمي هنا يعني إسقاط النبضة كلها،
   * وتخزينه يعني حقيقة بمفتاح فارغ تظهر في عدّاد ما يعرفه الأب زوراً.
   */
  /**
   * حفظ علاقة بين طرفين.
   *
   * ونوع العلاقة جزءٌ من المفتاح لا وصفٌ زائد، وهذا إصلاح عطل حقيقي: كانت
   * «القطة حيوان» و«القطة صغيرة» تتنازعان موضعاً واحداً فتهدم الثانية الأولى،
   * فيخسر زبير معرفةً كلما زاده أبوه معرفة. وهما جوابان لسؤالين مختلفين
   * («ما القطة؟» و«كيف القطة؟») فحقّهما موضعان.
   */
  learnFact(subject: string, object: string, tick: number, taughtBy: string, relation: RelationKind = 'جنس'): Fact {
    const s = factKey(subject);
    const o = factKey(object);
    const at = Number.isFinite(tick) ? tick : 0;
    const by = typeof taughtBy === 'string' && taughtBy.trim().length > 0 ? taughtBy.trim() : 'أبوه';

    if (s.length === 0 || o.length === 0 || s === o) {
      return { subject: s, object: o, confidence: 0, taughtBy: by, lastSeenTick: at };
    }

    const key = recordKey(s, relation);
    const record = this.records.get(key);
    if (!record) {
      const main: Fact = { subject: s, object: o, confidence: INITIAL_CONFIDENCE, taughtBy: by, lastSeenTick: at };
      this.records.set(key, { main, alt: null, relation });
      this.view = null;
      return main;
    }

    if (record.main.object === o) {
      record.main.confidence = reinforced(record.main.confidence);
      record.main.lastSeenTick = at;
      record.main.taughtBy = by;
      return record.main;
    }

    /* وكلمةُ الأب تعلو الموروث من أول مرة، ولا تُنازعه.
     *
     * والفرق بينهما فرقُ **مصدرٍ** لا فرقُ ثقة: الموروث عربيةُ محيطٍ عامّة،
     * وكلامُ الأب خبرٌ عن هذا الشيء بعينه في بيتهما. فمن ورِث «القطة أليفة» ثم
     * قال له أبوه «القطة شرسة» فالثانية أولى، ولا معنى لأن ينازع محيطُه أباه
     * ثماني مرات قبل أن يصدّقه. وهذا نصف «التعلّم السريع»: ألّا يُعاند ما وُرِث. */
    if (WEAKER_SOURCES.has(record.main.taughtBy) && !WEAKER_SOURCES.has(by)) {
      record.alt = null;
      record.main = { subject: s, object: o, confidence: INITIAL_CONFIDENCE, taughtBy: by, lastSeenTick: at };
      this.view = null;
      return record.main;
    }

    // محمول مخالف: يُحفظ بديلاً ويُنازع الغالب على الثقة
    if (record.alt && record.alt.object === o) {
      record.alt.confidence = reinforced(record.alt.confidence);
      record.alt.lastSeenTick = at;
      record.alt.taughtBy = by;
    } else {
      // بديل واحد لا أكثر: محمول ثالث مختلف يعني أن الأب يبدّل بلا إصرار،
      // والأحدث أولى بالتنازع من متروك قديم
      record.alt = { subject: s, object: o, confidence: INITIAL_CONFIDENCE, taughtBy: by, lastSeenTick: at };
    }
    this.settle(s, record);
    return record.main;
  }

  /**
   * يُصحّح نوع العلاقة بما تعلّمه من قبل، لا بقائمة صفاتٍ مكتوبة.
   *
   * قوائم الصفات لا تنتهي: «شرسة» لم تكن فيها، فقُرئت جنساً، فمحت «القطة
   * حيوان». والعلامة الصرفية عاجزة هنا حقاً — «شرسة» و«فاكهة» سواء في الصورة.
   *
   * لكن الدماغ يملك ما هو أوثق من القائمة: **ما استُعمل جنساً من قبل**. فـ
   * «حيوان» و«فاكهة» و«مهنة» أجناسٌ لعشرات الأشياء عنده، و«شرسة» لم تكن جنساً
   * لشيء قط. فإن كان للموضوع جنسٌ معروف وجاء محمولٌ لم يكن جنساً لشيء، فهو
   * صفة. وهذا تصحيحٌ **يتحسّن بالتعلّم** لا يجمد على قائمة.
   */
  refineRelation(subject: string, object: string, relation: RelationKind): RelationKind {
    if (relation !== 'جنس') return relation;
    const s = factKey(subject);
    const o = factKey(object);
    if (!this.records.has(recordKey(s, 'جنس'))) return relation;
    return this.isCategory(o) ? 'جنس' : 'صفة';
  }

  /** أاستُعمل هذا اللفظ جنساً لشيءٍ من قبل؟ */
  isCategory(word: string): boolean {
    const o = factKey(word);
    if (o.length === 0) return false;
    for (const record of this.records.values()) {
      if (record.relation === 'جنس' && record.main.object === o) return true;
    }
    return false;
  }

  /** ما يعرفه عن هذا الموضوع الآن، أو `null`. المفتاح يُطبَّع كما يُطبَّع في
   *  التعليم، فيجد «القطه» ما تعلّمه من «القطة». */
  lookup(subject: string, relation: RelationKind = 'جنس'): Fact | null {
    const record = this.records.get(recordKey(factKey(subject), relation));
    return record ? record.main : null;
  }

  /** كل ما يعرفه عن موضوع واحد بأنواع علاقاته — «القطة حيوان وصغيرة وتأكل». */
  lookupAll(subject: string): Array<{ relation: RelationKind; fact: Fact }> {
    const s = factKey(subject);
    const out: Array<{ relation: RelationKind; fact: Fact }> = [];
    for (const relation of RELATION_KINDS) {
      const record = this.records.get(recordKey(s, relation));
      if (record) out.push({ relation, fact: record.main });
    }
    return out;
  }

  /**
   * تكذيب الأب لمحمول بعينه.
   *
   * لا يُمحى المحمول فور التكذيب بل تُهدَم ثقته، فإن أصرّ الأب سقطت الحقيقة
   * كلها. وإن كان تحت المكذَّب بديلٌ أقوى منه بعد الهدم انتقلت الغلبة إليه —
   * وهذا تحديداً كيف يُصحّح الطفل معرفته: لا بكلمة واحدة، ولا بلا نهاية.
   */
  /**
   * في أي خزانةٍ يعرف هذا الموضوع؟ وnull لمن لا يعرفه في واحدة.
   *
   * تقرؤها جملةُ الاستدراك: «لا، المرنجل آلة» تُصحّح ما عنده عن المرنجل، فلا
   * يُعاد تصنيف «آلة» من جديد — بل تُوضع حيث كانت التي تستدرك عليها. وترتيب
   * الخزائن هنا ترتيبُ رجحان: الجنس أوّلُ ما يُقصد بالتصحيح، ثم الصفة، ثم
   * الفعل.
   */
  relationOf(subject: string): RelationKind | null {
    const s = factKey(subject);
    for (const relation of RELATION_KINDS) {
      if (this.records.has(recordKey(s, relation))) return relation;
    }
    return null;
  }

  /**
   * أثمّة نزاعٌ **قائم** على هذا الموضوع في هذه الخزانة؟
   *
   * تقرؤها المراجعة: المتنازَع فيه لا يُجزَم به، لأن الأب قال فيه قولين ولم
   * يستقرّ. لكنّ **وجود** محمولٍ بديل ليس نزاعاً قائماً: من قال «فاكهة» مرّةً
   * ثم «خضار» ثلاثاً فقد استقرّ، والبديل أثرٌ لا منازِع.
   *
   * وقد قِيس الفرق: بعدّ كل بديلٍ نزاعاً سقط بابُ «النفي والتصحيح» من ٨٩٪ إلى
   * ٥٦٪ — صار زبير يُقرّ بجهله بما أصرّ عليه أبوه ثلاث مرات. فالنزاع قائمٌ
   * حين يتقارب الاثنان، ومنقضٍ حين يفترقان.
   */
  isContested(subject: string, relation: RelationKind = 'جنس'): boolean {
    return this.disputeOf(subject, relation) === 'قائم';
  }

  /**
   * حالُ النزاع على هذا الموضوع: لا نزاع، أو نزاعٌ انقضى، أو نزاعٌ قائم.
   *
   * والثلاثة تختلف في الحكم لا في الدرجة: ما لم يُنازَع قطّ يُقال جزماً، وما
   * نُوزع ثم استقرّ يُقال ظنّاً — لأن أباه غيّر رأيه فيه مرّة، وقد يغيّره
   * ثانية — وما النزاع فيه قائمٌ لا يُقال.
   */
  disputeOf(subject: string, relation: RelationKind = 'جنس'): 'لا نزاع' | 'انقضى' | 'قائم' {
    const record = this.records.get(recordKey(factKey(subject), relation));
    if (!record?.alt) return 'لا نزاع';
    return record.main.confidence - record.alt.confidence < CONTEST_LIVE ? 'قائم' : 'انقضى';
  }

  contradict(subject: string, wrongObject: string, relation?: RelationKind): void {
    const s = factKey(subject);
    const o = factKey(wrongObject);
    if (s.length === 0 || o.length === 0) return;
    // بلا علاقة محدّدة: يُكذَّب المحمول أينما وُجد — الأب ينفي معنىً لا موضعاً
    if (!relation) {
      for (const kind of RELATION_KINDS) this.contradict(subject, wrongObject, kind);
      return;
    }
    const record = this.records.get(recordKey(s, relation));
    if (!record) return;

    if (record.main.object === o) record.main.confidence *= CONTRADICT_FACTOR;
    else if (record.alt && record.alt.object === o) record.alt.confidence *= CONTRADICT_FACTOR;
    else return; // تكذيب محمول لم يقله زبير لا يهدم ما قاله

    // المفتاح الكامل لا الموضوع وحده: بغيره تهوي الثقة ولا تُحذف الحقيقة أبداً
    this.settle(recordKey(s, relation), record);
  }

  /** الحقائق الغالبة. الكائنات حيّة لا نسخاً — كما `Lexicon.words()` — فلا
   *  يجوز لفصٍّ أن يكتب فيها، والنوع `readonly` هو العقد الذي يحمي القائمة. */
  get facts(): readonly Fact[] {
    if (!this.view) this.view = Array.from(this.records.values(), (record) => record.main);
    return this.view;
  }

  /**
   * أخٌ في الجنس: شيءٌ آخر يعرف أنه من جنس هذا الشيء نفسه.
   *
   * وبه يسأل زبير أنفع أسئلته وأصدقها طفولةً: «القطة حيوان… والكلب كمان
   * حيوان؟». وهذا ليس استظهاراً بل **اختبار قاعدة**: الطفل يبني الصنف في ذهنه
   * فيمتحنه على شيء آخر، ومن جواب أبيه يعرف حدَّ الصنف. ولولا هذا الأخ لبقي
   * سؤاله عن كلمةٍ مفردة معلّقة لا عن معرفةٍ تُبنى.
   */
  sibling(subject: string, relation: RelationKind = 'جنس'): Fact | null {
    const s = factKey(subject);
    const record = this.records.get(recordKey(s, relation));
    if (!record) return null;
    const category = record.main.object;

    let best: Fact | null = null;
    for (const other of this.records.values()) {
      const fact = other.main;
      if (fact.subject === s || fact.object !== category) continue;
      // الأوثق أولى: أخٌ يشكّ فيه لا يصلح لامتحان قاعدة
      if (!best || fact.confidence > best.confidence) best = fact;
    }
    return best;
  }

  /* ————— التعميم ————— */

  /**
   * موضوع لم يُعلَّم قط: يُبحث عن أقرب موضوع معروف بتشابه التمثيل، ويُنقل محموله
   * بثقة مخفوضة بمقدار بُعد الشبه (ثقة الأصل × التشابه).
   *
   * ولا يُخزَّن الناتج: التعميم تخمين لا معرفة، وتخزينه يجعل تخمين اليوم حقيقةً
   * لا تُناقَش غداً — وهذا هو الباب الذي يدخل منه التخريف إلى الدماغ.
   */
  generalize(subject: string, lexicon: Lexicon): { fact: Fact; similarity: number } | null {
    const s = factKey(subject);
    if (s.length === 0 || this.records.size === 0) return null;
    // ما يعرفه لا يُخمَّن: الحقيقة الصريحة أصدق من أقرب شبيه بها
    if (this.records.has(recordKey(s, 'جنس'))) return null;

    const query = this.wordVector(s, lexicon, this.queryVec);
    let best: Fact | null = null;
    let bestSimilarity = -Infinity;
    let runnerUp = -Infinity;
    for (const record of this.records.values()) {
      // التعميم على الجنس وحده: الصفة لا تُنقَل بالشبه («قطة صغيرة» لا تعني
      // أن كل ما يشبه القطة صغير)، والفعل كذلك
      if ((record.relation ?? 'جنس') !== 'جنس') continue;
      const candidate = this.wordVector(record.main.subject, lexicon, this.candidateVec);
      const similarity = cosine(query, candidate);
      if (!Number.isFinite(similarity)) continue;
      if (similarity > bestSimilarity) {
        runnerUp = bestSimilarity;
        bestSimilarity = similarity;
        best = record.main;
      } else if (similarity > runnerUp) {
        runnerUp = similarity;
      }
    }

    if (!best || bestSimilarity < GENERALIZE_THRESHOLD) return null;
    // شبيه واحد فقط في دماغه: لا منافس يُقاس عليه التميّز، فتكفي العتبة
    if (runnerUp > -Infinity && bestSimilarity - runnerUp < GENERALIZE_MARGIN) return null;

    return {
      fact: {
        subject: s,
        object: best.object,
        confidence: clamp(best.confidence * bestSimilarity, 0, 1),
        // الإفصاح عن مصدر التخمين لازم: الأب يرى أن هذا ليس درساً منه بل قياس
        taughtBy: `تعميم عن «${best.subject}»`,
        lastSeenTick: best.lastSeenTick,
      },
      similarity: bestSimilarity,
    };
  }

  /**
   * تمثيل كلمة: الصفّ المتعلّم إن عرفها المعجم، وإلا ملامح حروفها.
   *
   * يُجرَّب المفتاح المجرّد ثم المعرَّف بـ«ال» لأن الحقائق تُخزَّن مجرّدة
   * («قطة») والمعجم قد يعرف الكلمة كما سمعها («القطة»). بلا هذه المحاولة الثانية
   * يُهدَر التمثيل الذي تعلّمه فعلاً ويُقاس الشبه على الحروف وحدها.
   *
   * والخلط بين القناتين مقبول: التمثيل الابتدائي لأي كلمة في المعجم مبنيّ على
   * ملامح حروفها بوزن غالب، فالفضاءان ليسا غريبين.
   */
  /**
   * متجه كلمة للمقارنة. الشرط الحاكم: **الطرفان في فضاء واحد**.
   *
   * كان هنا سقوطٌ إلى `idOf('ال' + word)` حين لا يعرف المعجم الكلمة مجرّدة —
   * والمعجم لا يعرفها مجرّدة أبداً تقريباً، لأن الأب يقول «القطة» فيحفظها
   * المعجم «القطه» بينما مفتاح الحقيقة «قطه» بلا أداة. فكان الجُداري يقيس ملامح
   * حروف كلمةٍ مجرّدة مقابل تمثيلٍ متعلَّمٍ لكلمةٍ معرَّفة، وأداة التعريف تُبدّل
   * ثلاثيات الحروف كلها: قِسته فبلغ التشابه ٠٫٠٢٥ حيث كان يجب أن يبلغ ٠٫٣٤.
   * فلم يعمّم زبير قط، والعتبة لم تكن وحدها السبب.
   *
   * فلا يُؤخذ التمثيل المتعلَّم إلا لكلمة يعرفها المعجم بصورتها هذه بعينها، وإلا
   * فملامح الحروف للطرفين معاً — أضعف إشارةً وأصدق مقارنةً.
   */
  private wordVector(word: string, lexicon: Lexicon, out: Vec): Vec {
    const id = lexicon.idOf(word);
    if (id >= 0 && lexicon.embedding.has(id)) {
      const row = lexicon.embedding.get(id);
      if (row.length === out.length) return row;
    }
    return hashCharFeatures(word, out);
  }

  /* ————— ترتيب التنازع ————— */

  /** يُرجّح الأعلى ثقة، ويُسقط ما هوى دون العتبة. تُنادى بعد كل تغيّر في الثقة،
   *  فلا يوجد في الذاكرة محمولٌ غالبٌ وتحته أقوى منه. */
  private settle(key: string, record: FactRecord): void {
    const alt = record.alt;
    if (alt && alt.confidence > record.main.confidence) {
      record.alt = record.main;
      record.main = alt;
      this.view = null; // العرض يحمل مرجع الغالب القديم فيبطل بتبادلهما
    }
    if (record.alt && record.alt.confidence < DOUBT_FLOOR) record.alt = null;
    // الغالب هو الأعلى بعد الترجيح، فهبوطه دون العتبة يعني هبوط الاثنين
    if (record.main.confidence < DOUBT_FLOOR) {
      this.records.delete(key);
      this.view = null;
    }
  }

  /* ————— الحفظ والاستعادة ————— */

  save(): ParietalState {
    const facts: StoredFact[] = [];
    for (const record of this.records.values()) {
      facts.push({
        subject: record.main.subject,
        object: record.main.object,
        confidence: record.main.confidence,
        taughtBy: record.main.taughtBy,
        lastSeenTick: record.main.lastSeenTick,
        altObject: record.alt ? record.alt.object : null,
        altConfidence: record.alt ? record.alt.confidence : 0,
        relation: record.relation,
      });
    }
    return { facts };
  }

  /**
   * استعادة الحقائق. كل حقيقة تُفحَص وحدها وتُتجاهل بصمت إن عطبت: خسارة حقيقة
   * أهون من خسارة الدماغ، ورمي استثناء هنا يعني ألّا يُقلع زبير أبداً.
   */
  load(state: ParietalState): void {
    try {
      if (!state || !Array.isArray(state.facts)) return;
      const restored = new Map<string, FactRecord>();
      for (const raw of state.facts) {
        if (!raw || typeof raw !== 'object') continue;
        const s = factKey(typeof raw.subject === 'string' ? raw.subject : '');
        const o = factKey(typeof raw.object === 'string' ? raw.object : '');
        if (s.length === 0 || o.length === 0 || s === o) continue;
        const confidence = sane(raw.confidence);
        // ثقة دون العتبة في ملف محفوظ تعني حقيقةً كان يجب أن تُحذف: لا تُستعاد
        if (confidence < DOUBT_FLOOR) continue;
        const main: Fact = {
          subject: s,
          object: o,
          confidence,
          taughtBy: typeof raw.taughtBy === 'string' && raw.taughtBy.length > 0 ? raw.taughtBy : 'أبوه',
          lastSeenTick: Number.isFinite(raw.lastSeenTick) ? raw.lastSeenTick : 0,
        };
        const altObject = typeof raw.altObject === 'string' ? factKey(raw.altObject) : '';
        const altConfidence = sane(raw.altConfidence);
        const alt: Fact | null = altObject.length > 0 && altObject !== o && altConfidence >= DOUBT_FLOOR
          // البديل لا يجوز أن يكون أقوى من الغالب في ملف صحيح؛ إن كان فالملف
          // عطب، ونأخذ الأدنى منهما احتراساً بدل أن نقلب معرفته باستعادة
          ? { subject: s, object: altObject, confidence: Math.min(altConfidence, confidence), taughtBy: main.taughtBy, lastSeenTick: main.lastSeenTick }
          : null;
        /* نوع العلاقة اختياري في الملف: دماغ حُفظ قبل هذه الإضافة تُقرأ
         * حقائقه كلها «جنساً»، وهو ما كانت عليه فعلاً حين حُفظت. */
        const relation: RelationKind = RELATION_KINDS.includes(raw.relation as RelationKind)
          ? (raw.relation as RelationKind)
          : 'جنس';
        restored.set(recordKey(s, relation), { main, alt, relation });
      }
      this.records = restored;
      this.view = null;
    } catch {
      // حالة معطوبة بشكل لم نتوقّعه: تُترك الحقائق كما هي ولا يُرمى استثناء
    }
  }
}

/** الخطوة التقاربية نحو الواحد. مكتوبة مرّة لأنها تُستعمل للغالب وللبديل. */
function reinforced(confidence: number): number {
  const c = clamp(sane(confidence), 0, 1);
  return c + (1 - c) * REINFORCE_RATE;
}

/** ثقة من ملف محفوظ: غير العددي يصير صفراً بدل أن يصير NaN يسري في كل مقارنة. */
function sane(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? clamp(value, 0, 1) : 0;
}
