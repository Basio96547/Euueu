/* ————— منطقة النحو والصرف —————
 *
 * في الدماغ الحقيقي يقع تحليل بنية الجملة في شبكة حول منطقة بروكا (الجزء
 * المثلثي والجبهي السفلي)، منفصلةً عن فهم المفردات في الصدغي. ولذلك يوجد مريض
 * يفهم الكلمات ولا يفكّ تركيب الجملة، وآخر بالعكس. فالفصل هنا ليس ترتيباً
 * برمجياً بل تشريح.
 *
 * وهذا الفص هو مفتاح خمسة عيوب كانت في زبير، وكلها من أصل واحد: أنه لا يعرف
 * نحواً.
 *
 *  ١) لم يفرّق الصفة من الجنس، فكانت «القطة حيوان» و«القطة صغيرة» تتقاتلان
 *     على موضع واحد، فتهدم إحداهما الأخرى. والطفل يعرف أن القطة حيوانٌ **و**
 *     صغيرة معاً.
 *  ٢) قرأ النفي تصحيحاً: «القطة ليست نبات» كان يفهمها «أخطأتَ» لا معرفةً.
 *  ٣) لم يعرف الضمير على مَن يعود، فانكسر التعليم على أكثر من دور.
 *  ٤) لم يعرف ماذا يطلب السؤال، فيُجيب عن «وين دمشق؟» بجنسها لا بمكانها.
 *  ٥) ولم يعرف نفسه: «اسمك زبير» كانت حقيقةً كسائر الحقائق لا معرفةً بذاته.
 *
 * والتحليل هنا **صرفيّ سطحي** لا نحو كامل: لا إعراب ولا جذور ولا معجم صرفي.
 * علامات العربية الظاهرة تكفي لهذا القدر: أداة التعريف، وتاء التأنيث، وعلامات
 * التثنية والجمع، وحروف المضارعة، والقوائم المغلقة (الحروف والضمائر والأدوات).
 * وما لا تُبيّنه العلامة يُترك مجهولاً ولا يُخمَّن — لأن إعراباً مخترعاً أسوأ
 * من لا إعراب.
 */

import type { Percept } from '../core/text.js';
import type { Lobe } from '../core/types.js';

/* ————— أقسام الكلمة ————— */
export type PartOfSpeech = 'اسم' | 'فعل' | 'حرف' | 'مجهول';
export type Gender = 'مذكر' | 'مؤنث' | 'مجهول';
export type NumberForm = 'مفرد' | 'مثنى' | 'جمع' | 'مجهول';

export interface WordForm {
  word: string;
  pos: PartOfSpeech;
  gender: Gender;
  number: NumberForm;
  /** معرَّف بأل أو ضميرٍ أو عَلَم */
  definite: boolean;
  /** الكلمة بعد نزع أداة التعريف — مفتاح الحقائق */
  stem: string;
}

/* ————— ما يطلبه السؤال —————
 * أهمّ ما في هذا الفص عملياً: أن يعرف زبير **نوع الجواب** الذي يُنتظر منه. */
export type QuestionKind =
  | 'جنس'      // ما / شو: ما هذا الشيء
  | 'شخص'      // من / مين
  | 'مكان'     // أين / وين
  | 'زمان'     // متى
  | 'عدد'      // كم
  | 'كيفية'    // كيف
  | 'سبب'      // لماذا / ليش
  | 'اختيار'   // أي
  | 'تصديق';   // هل / أ: جوابه نعم أو لا

export type SentenceKind = 'اسمية' | 'فعلية' | 'استفهام' | 'نفي' | 'أمر' | 'نداء' | 'مفردة';

/** نوع العلاقة بين طرفي الجملة — يُصدَّر لأن الفص الجُداري يُفهرس به حقائقه. */
export type RelationKind = 'جنس' | 'صفة' | 'فعل' | 'ملك';

export interface Parse {
  words: WordForm[];
  kind: SentenceKind;
  /** ما يطلبه السؤال، وnull لغير السؤال */
  asks: QuestionKind | null;
  /** أفي الجملة نفي؟ «ليست» و«ما» و«لا» و«لم» و«لن» */
  negated: boolean;
  /** طرفا الجملة الاسمية إن تبيّنا */
  topic: string | null;
  comment: string | null;
  /** أالمحمول صفةٌ أم جنس؟ به تتعايش «حيوان» و«صغيرة» بدل أن تتقاتلا */
  relation: RelationKind | null;
  /** الضمير الظاهر إن وُجد، وجنسه وعدده — به يُعرَف على مَن يعود */
  pronoun: { word: string; gender: Gender; number: NumberForm } | null;
  /** كلمة العدد إن وُجدت */
  count: number | null;
}

/* ————— القوائم المغلقة —————
 * الحرف في العربية قسمٌ مغلق: لا يُشتقّ ولا يُزاد، فيُحصى إحصاءً. */

const PARTICLES: ReadonlySet<string> = new Set([
  'في', 'من', 'الي', 'علي', 'عن', 'مع', 'عند', 'حتي', 'منذ', 'خلال', 'بين', 'تحت', 'فوق',
  'قبل', 'بعد', 'ضد', 'نحو', 'حول', 'دون', 'سوي', 'لدي', 'ل', 'ب', 'ك', 'و', 'ف', 'ثم',
  'او', 'ام', 'لكن', 'بل', 'ان', 'اذا', 'لو', 'كي', 'حين', 'لما', 'قد', 'سوف', 'س', 'يا',
  'الا', 'اما', 'انما', 'كل', 'بعض', 'غير', 'مثل', 'زي', 'كما', 'هيك', 'هكذا',
]);

const NEGATIONS: ReadonlySet<string> = new Set([
  'لا', 'لم', 'لن', 'ليس', 'ليست', 'ليسوا', 'ما', 'مو', 'مش', 'ولا', 'غير', 'بدون',
]);

/** الضمائر المنفصلة بجنسها وعددها — بها يُعرَف على مَن يعود الكلام. */
const PRONOUNS: ReadonlyMap<string, { gender: Gender; number: NumberForm; person: 1 | 2 | 3 }> = new Map([
  ['انا', { gender: 'مجهول', number: 'مفرد', person: 1 }],
  ['نحن', { gender: 'مجهول', number: 'جمع', person: 1 }],
  ['احنا', { gender: 'مجهول', number: 'جمع', person: 1 }],
  ['انت', { gender: 'مذكر', number: 'مفرد', person: 2 }],
  ['انتي', { gender: 'مؤنث', number: 'مفرد', person: 2 }],
  ['انتم', { gender: 'مذكر', number: 'جمع', person: 2 }],
  ['هو', { gender: 'مذكر', number: 'مفرد', person: 3 }],
  ['هي', { gender: 'مؤنث', number: 'مفرد', person: 3 }],
  ['هما', { gender: 'مجهول', number: 'مثنى', person: 3 }],
  ['هم', { gender: 'مذكر', number: 'جمع', person: 3 }],
  ['هن', { gender: 'مؤنث', number: 'جمع', person: 3 }],
]);

const DEMONSTRATIVES: ReadonlyMap<string, { gender: Gender; number: NumberForm }> = new Map([
  ['هذا', { gender: 'مذكر', number: 'مفرد' }],
  ['هذه', { gender: 'مؤنث', number: 'مفرد' }],
  ['هذي', { gender: 'مؤنث', number: 'مفرد' }],
  ['هاد', { gender: 'مذكر', number: 'مفرد' }],
  ['هادا', { gender: 'مذكر', number: 'مفرد' }],
  ['هاي', { gender: 'مؤنث', number: 'مفرد' }],
  ['هيدا', { gender: 'مذكر', number: 'مفرد' }],
  ['هيدي', { gender: 'مؤنث', number: 'مفرد' }],
  ['هؤلاء', { gender: 'مجهول', number: 'جمع' }],
  ['هدول', { gender: 'مجهول', number: 'جمع' }],
]);

/** أدوات الاستفهام وما يطلب كلٌّ منها. هذا هو قلب «يميّز السؤال من الجواب». */
const QUESTION_TOOLS: ReadonlyMap<string, QuestionKind> = new Map([
  ['ما', 'جنس'], ['ماذا', 'جنس'], ['شو', 'جنس'], ['ايش', 'جنس'], ['شنو', 'جنس'], ['شو_هو', 'جنس'],
  ['من', 'شخص'], ['مين', 'شخص'],
  ['اين', 'مكان'], ['وين', 'مكان'], ['فين', 'مكان'],
  ['متي', 'زمان'], ['امتي', 'زمان'],
  ['كم', 'عدد'], ['قديش', 'عدد'], ['كام', 'عدد'],
  ['كيف', 'كيفية'], ['شلون', 'كيفية'],
  ['لماذا', 'سبب'], ['ليش', 'سبب'], ['ليه', 'سبب'], ['لم', 'سبب'],
  ['اي', 'اختيار'], ['ايا', 'اختيار'],
  ['هل', 'تصديق'],
]);

/** أفعال شائعة لا تُبيّنها العلامات الصرفية وحدها. قائمة صغيرة بقصد: ما لا
 *  تُبيّنه العلامة يُترك مجهولاً، والاختراع أسوأ من الجهل. */
const KNOWN_VERBS: ReadonlySet<string> = new Set([
  'كان', 'صار', 'راح', 'اجا', 'جاء', 'قال', 'اكل', 'شرب', 'نام', 'قام', 'مشي',
  'ركض', 'لعب', 'درس', 'كتب', 'قرا', 'فتح', 'سكر', 'حب', 'كره', 'شاف', 'سمع',
  'عرف', 'فهم', 'نسي', 'تذكر', 'اعطي', 'اخذ', 'وقف', 'جلس', 'خرج', 'دخل',
]);

/** مؤنثات لا تنتهي بتاء: تُحصى لأن العلامة تخذل فيها. */
const FEMININE_BY_USE: ReadonlySet<string> = new Set([
  'ام', 'بنت', 'اخت', 'شمس', 'نار', 'ارض', 'يد', 'عين', 'اذن', 'رجل', 'نفس',
  'دار', 'حرب', 'ريح', 'بير', 'سما', 'سماء', 'قدم', 'سن', 'كاس', 'روح',
]);

/** الصفات الشائعة: بها يُعرَف أن المحمول صفةٌ لا جنس. */
const ADJECTIVE_HINTS: ReadonlySet<string> = new Set([
  'كبير', 'صغير', 'طويل', 'قصير', 'حلو', 'مر', 'جميل', 'قبيح', 'سريع', 'بطيء',
  'قوي', 'ضعيف', 'غالي', 'رخيص', 'جديد', 'قديم', 'نظيف', 'وسخ', 'بارد', 'سخن',
  'حار', 'دافي', 'ثقيل', 'خفيف', 'عالي', 'واطي', 'واسع', 'ضيق', 'منيح', 'جيد',
  'سيء', 'ذكي', 'غبي', 'طيب', 'شرير', 'مفتوح', 'مسكر', 'فاضي', 'مليان', 'صعب', 'سهل',
]);

/** أسماء الأعداد إلى عشرين، وبها يُفهَم جواب «كم». */
const NUMBER_WORDS: ReadonlyMap<string, number> = new Map([
  ['صفر', 0], ['واحد', 1], ['واحده', 1], ['اثنان', 2], ['اثنين', 2], ['تنين', 2],
  ['ثلاثه', 3], ['تلاته', 3], ['اربعه', 4], ['خمسه', 5], ['سته', 6], ['سبعه', 7],
  ['ثمانيه', 8], ['تمانيه', 8], ['تسعه', 9], ['عشره', 10], ['احدعش', 11], ['اتنعش', 12],
  ['عشرين', 20], ['ثلاثين', 30], ['مئه', 100], ['الف', 1000],
]);

/** ألفاظ المِلك بضمائرها، ومَن تُسنِد المِلك إليه. الصور مطبَّعة كما تصل من
 *  الحاسّة: الهمزات ألفاً، والتاء المربوطة هاءً. */
const POSSESSION: ReadonlyMap<string, 'الأب' | 'زبير' | 'غيره'> = new Map([
  /* «إلي» ليست هنا وإن كانت تعني المِلك في الشامية: تطبيعها يجعلها «الي» وهي
   * صورة «إلى» نفسها، فلو قُبلت لصار «ذهبت إلى البيت» مِلكاً وأورث غيرةً كاذبة. */
  ['عندي', 'الأب'], ['معي', 'الأب'], ['املك', 'الأب'], ['بملك', 'الأب'],
  ['عندك', 'زبير'], ['معك', 'زبير'], ['الك', 'زبير'], ['عندكي', 'زبير'], ['معكي', 'زبير'],
  ['عنده', 'غيره'], ['عندها', 'غيره'], ['عندهم', 'غيره'], ['عندهن', 'غيره'],
  ['معه', 'غيره'], ['معها', 'غيره'], ['معهم', 'غيره'],
  ['الها', 'غيره'], ['الهم', 'غيره'], ['يملك', 'غيره'], ['تملك', 'غيره'],
]);

const ARTICLES: readonly string[] = ['وال', 'فال', 'بال', 'كال', 'ال', 'لل'];

export interface SyntaxState {
  parsed: number;
}

export class Syntax implements Lobe<SyntaxState> {
  readonly name = 'syntax';
  readonly ar = 'منطقة النحو';
  readonly role = 'يفكّ تركيب جملتك: اسمٌ أم فعل، سؤالٌ أم خبر، نفيٌ أم إثبات، وما نوع الجواب المطلوب';

  private parsed = 0;

  /* ————— الصرف: الكلمة الواحدة ————— */

  /** ينزع أداة التعريف إن بقي بعدها جذعٌ معتبر — «الآن» ليست «آن». */
  private strip(word: string): string {
    for (const article of ARTICLES) {
      if (word.length >= article.length + 3 && word.startsWith(article)) {
        return word.slice(article.length);
      }
    }
    return word;
  }

  /** تحليل صرفي لكلمة واحدة بعلاماتها الظاهرة. */
  classify(word: string): WordForm {
    const stem = this.strip(word);
    const definite = stem !== word;

    if (PRONOUNS.has(word)) {
      const info = PRONOUNS.get(word)!;
      return { word, pos: 'اسم', gender: info.gender, number: info.number, definite: true, stem: word };
    }
    if (DEMONSTRATIVES.has(word)) {
      const info = DEMONSTRATIVES.get(word)!;
      return { word, pos: 'اسم', gender: info.gender, number: info.number, definite: true, stem: word };
    }
    if (QUESTION_TOOLS.has(word) || PARTICLES.has(word) || NEGATIONS.has(word)) {
      return { word, pos: 'حرف', gender: 'مجهول', number: 'مجهول', definite: false, stem: word };
    }

    const pos = this.partOfSpeech(word, stem, definite);
    /* الجنس يُقرأ لكل ما ليس فعلاً ولا حرفاً، لا للاسم المؤكَّد وحده: علامات
     * الاسمية تخذل كثيراً من الأسماء العربية («حيوان» و«بنت» لا علامة فيهما)،
     * فلو حُصر الجنس في المؤكَّد لضاع جنس أكثر الكلمات — والضمير يعود بالجنس. */
    return {
      word,
      pos,
      gender: pos === 'فعل' || pos === 'حرف' ? 'مجهول' : this.genderOf(stem),
      number: this.numberOf(stem),
      definite,
      stem,
    };
  }

  /**
   * قسم الكلمة من علاماتها.
   *
   * الترتيب معنيّ: أداة التعريف أقطع علامة في العربية على الاسمية — الفعل لا
   * يقبلها بحال. ثم تاء التأنيث وعلامات الجمع، ثم حروف المضارعة. وما لم تُبيّنه
   * علامة يبقى مجهولاً: لا يُخمَّن قسمُ كلمةٍ بالحدس.
   */
  private partOfSpeech(word: string, stem: string, definite: boolean): PartOfSpeech {
    if (definite) return 'اسم';
    if (KNOWN_VERBS.has(word)) return 'فعل';
    if (ADJECTIVE_HINTS.has(stem)) return 'اسم';
    if (NUMBER_WORDS.has(word)) return 'اسم';

    // علامات الاسم: تاء مربوطة (تصير هاءً بالتطبيع)، وجمع سالم، ونسبة
    if (/ه$/.test(word) && word.length >= 4) return 'اسم';
    if (/(ات|ون|ين|ان)$/.test(word) && word.length >= 5) return 'اسم';
    if (/^(م|ت)[^ا-ي]{0,1}/.test(word) && /(ه|ات|ين)$/.test(word)) return 'اسم';

    /* حروف المضارعة: ي/ت/ن/أ في أول فعل مضارع ثلاثيّ أو رباعيّ. والشرط على
     * الطول لازم: «يد» و«تين» و«نار» أسماء تبدأ بحرف مضارعة صورةً لا حقيقة. */
    if (/^[يتنا].{2,4}$/.test(word) && !/ه$/.test(word)) {
      // «بيبقي» و«بيروح» في الشامية: الباء قبل المضارع
      return 'فعل';
    }
    if (/^ب[يتن].{2,3}$/.test(word)) return 'فعل';
    // علامات الماضي: تاء الفاعل وواو الجماعة ونا
    if (/(ت|تو|وا|نا)$/.test(word) && word.length >= 4 && !/ه$/.test(word)) return 'فعل';

    return 'مجهول';
  }

  private genderOf(stem: string): Gender {
    if (FEMININE_BY_USE.has(stem)) return 'مؤنث';
    // التاء المربوطة تصير هاءً بعد التطبيع، وهي أظهر علامات التأنيث
    if (/ه$/.test(stem) && stem.length >= 3) return 'مؤنث';
    if (/(اء|ي)$/.test(stem) && stem.length >= 4) return 'مؤنث';
    if (/ات$/.test(stem)) return 'مؤنث';
    return 'مذكر';
  }

  private numberOf(stem: string): NumberForm {
    if (/(ان|ين)$/.test(stem) && stem.length >= 5) return 'مثنى';
    if (/(ون|ات)$/.test(stem) && stem.length >= 4) return 'جمع';
    if (/^(هم|هن|هؤلاء|هدول|نحن|احنا|انتم)$/.test(stem)) return 'جمع';
    return 'مفرد';
  }

  /* ————— النحو: الجملة ————— */

  parse(percept: Percept): Parse {
    this.parsed++;
    const tokens = percept.tokens;
    const words = tokens.map((token) => this.classify(token));

    const empty: Parse = {
      words, kind: 'مفردة', asks: null, negated: false,
      topic: null, comment: null, relation: null, pronoun: null, count: null,
    };
    if (tokens.length === 0) return empty;

    /* ١. الاستفهام: الأداة أولاً، فإن غابت فعلامة الاستفهام.
     * والأدوات الملتبسة («ما» و«من» و«كم») لا تُقبل إلا أول الجملة — «خرجت من
     * البيت» ليست سؤالاً، و«ما أكلت» نفيٌ في الشامية لا استفهام. */
    let asks: QuestionKind | null = null;
    const first = tokens[0]!;
    const ambiguous = first === 'ما' || first === 'من' || first === 'كم';
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i]!;
      const kind = QUESTION_TOOLS.get(token);
      if (!kind) continue;
      const isAmbiguous = token === 'ما' || token === 'من' || token === 'كم' || token === 'لم';
      if (isAmbiguous && i > 0) continue;
      asks = kind;
      break;
    }
    if (asks === null && percept.isQuestion) asks = 'جنس';

    /* ٢. النفي: يُفحَص بعد الاستفهام لأن «ما» تصلح للاثنين. فإن كانت أول
     * الجملة وبعدها فعل فهي نفي، وإن كانت أولها وبعدها اسم فهي استفهام. */
    let negated = false;
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i]!;
      if (!NEGATIONS.has(token)) continue;
      if (token === 'ما' && i === 0 && asks !== null) continue;
      // «لا» وحدها جواب لا نفيٌ في جملة
      if (token === 'لا' && tokens.length === 1) continue;
      negated = true;
      break;
    }
    if (negated && asks !== null && !ambiguous) asks = null;

    /* ٣. الضمير الظاهر: أول ضمير غائب في الجملة — عليه يُبنى الإرجاع. */
    let pronoun: Parse['pronoun'] = null;
    for (const form of words) {
      const info = PRONOUNS.get(form.word);
      if (info && info.person === 3) {
        pronoun = { word: form.word, gender: info.gender, number: info.number };
        break;
      }
    }

    /* ٤. العدد */
    let count: number | null = null;
    for (const token of tokens) {
      const digits = Number(token);
      if (Number.isFinite(digits) && token.length <= 6) {
        count = digits;
        break;
      }
      const named = NUMBER_WORDS.get(token);
      if (named !== undefined) {
        count = named;
        break;
      }
    }

    /* ٥. نوع الجملة وطرفاها */
    const kind = this.sentenceKind(words, asks, negated);
    const { topic, comment, relation } = this.bindSides(words, negated);

    return { words, kind, asks, negated, topic, comment, relation, pronoun, count };
  }

  private sentenceKind(words: readonly WordForm[], asks: QuestionKind | null, negated: boolean): SentenceKind {
    if (words.length === 1) return 'مفردة';
    if (asks !== null) return 'استفهام';
    if (negated) return 'نفي';
    if (words[0]?.word === 'يا') return 'نداء';
    if (words[0]?.pos === 'فعل') return 'فعلية';
    return 'اسمية';
  }

  /**
   * طرفا الجملة الاسمية ونوع العلاقة بينهما.
   *
   * ونوع العلاقة هو الإصلاح الجوهري هنا: «القطة حيوان» جنسٌ، و«القطة صغيرة»
   * صفة، و«القطة تأكل» فعل. وكانت الثلاثة تُحفَظ في موضع واحد فتتقاتل: يعلّمه
   * أبوه أن القطة حيوان ثم أنها صغيرة، فتهدم الثانية الأولى. والطفل يعرفهما
   * معاً لأنهما جوابان لسؤالين مختلفين.
   */
  private bindSides(words: readonly WordForm[], negated: boolean):
    { topic: string | null; comment: string | null; relation: Parse['relation'] } {
    const content = words.filter((w) => w.pos !== 'حرف' || DEMONSTRATIVES.has(w.word));
    if (content.length < 2) return { topic: null, comment: null, relation: null };

    const left = content[0]!;
    // الطرف الأيمن: أول كلمة معنى بعد الأولى، متجاوزاً الروابط والنفي
    let right: WordForm | null = null;
    for (let i = 1; i < content.length; i++) {
      const candidate = content[i]!;
      if (LINKING_WORDS.has(candidate.word)) continue;
      right = candidate;
      break;
    }
    if (!right || right.stem === left.stem) return { topic: null, comment: null, relation: null };

    let relation: Parse['relation'];
    if (right.pos === 'فعل') relation = 'فعل';
    else if (isAdjective(right.stem)) relation = 'صفة';
    else if (right.definite === false && left.definite && right.pos === 'اسم') relation = 'جنس';
    else relation = 'جنس';

    // النفي لا يُغيّر الطرفين بل يُغيّر معنى الرابطة، ويُعالَج فوق هذا الفص
    if (negated && relation === 'فعل') relation = 'فعل';

    return { topic: left.stem, comment: right.stem, relation };
  }

  /**
   * أيصلح هذا الجواب لهذا السؤال؟
   *
   * وهذا هو ما طلبه الأب صراحةً: أن يميّز السؤال من الجواب. سؤال «وين دمشق؟»
   * يطلب مكاناً، فجوابه «مدينة» جوابٌ عن سؤال آخر — ولو أجاب به لبدا كأنه لم
   * يسمع السؤال. والصدق أن يُقرّ بجهله.
   *
   * ويُعطى `answerCategory` من الفص الجُداري: جنسُ الجواب نفسه («مدينة» جنسها
   * «مكان»). وإن جُهل الجنس قُبِل الجواب: المنع بلا علم منعٌ ظالم.
   */
  answerFits(asks: QuestionKind | null, answer: string, answerCategory: string | null): boolean {
    if (asks === null) return true;
    const category = answerCategory;

    switch (asks) {
      case 'جنس':
        return true; // «ما هذا» يقبل أي جنس
      case 'شخص':
        return category === null || PERSON_CATEGORIES.has(category) || PERSON_CATEGORIES.has(answer);
      case 'مكان':
        return category === null || PLACE_CATEGORIES.has(category) || PLACE_CATEGORIES.has(answer);
      case 'زمان':
        return category === null || TIME_CATEGORIES.has(category) || TIME_CATEGORIES.has(answer);
      case 'عدد':
        return NUMBER_WORDS.has(answer) || Number.isFinite(Number(answer));
      case 'تصديق':
        return /^(نعم|ايوا|اي|لا|ما|مو)$/.test(answer);
      case 'سبب':
      case 'كيفية':
      case 'اختيار':
        /* هذه الثلاثة لا يملك زبير لها بنيةً بعد: لا سببية ولا كيفية في دماغه.
         * فيُردّ الجواب دائماً كي يُقرّ بجهله بدل أن يُجيب بجنسٍ لا صلة له. */
        return false;
    }
  }

  /**
   * محمولٌ بلا موضوع: كلمةٌ واحدة تُكمل ما قبلها.
   *
   * «القطة حيوان» ثم «صغيرة» — والثانية ليست جملةً ناقصة بل **حذفٌ**، وهو أشيع
   * ما يقع في كلام الناس: يُذكر الموضوع مرة ويُبنى عليه أدوارٌ بعده. والطفل
   * يفهمه من أول سنتَيه: يُقال له «الكرة حمراء» ثم «وكبيرة» فيعرف عمّن يُتكلَّم.
   *
   * وبلا هذا كان زبير يستقبل «صغيرة» جملةً مبتورةً لا موضوع لها، فيسأل «شو
   * هذا؟» عن كلمةٍ أبوه يشرح بها ما قاله قبل لحظة. رآه الأب في التطبيق.
   *
   * ويُشترط لصحّة الحمل: كلمةُ معنى واحدة لا أكثر، وألّا تكون سؤالاً ولا أداةً
   * ولا تحيّة. وما عدا ذلك يُترك — الحمل على غير موضعه أسوأ من تركه.
   */
  ellipsis(percept: Percept): { comment: string; relation: RelationKind } | null {
    if (percept.isQuestion) return null;
    const words = percept.tokens.map((token) => this.classify(token));
    const content = words.filter((w) => w.pos !== 'حرف' && !DEMONSTRATIVES.has(w.word)
      && !LINKING_WORDS.has(w.word) && !SOCIAL_WORDS.has(w.word));
    if (content.length !== 1) return null;

    const only = content[0]!;
    if (QUESTION_TOOLS.has(only.word) || NEGATIONS.has(only.word)) return null;
    if (PRONOUNS.has(only.word)) return null;
    // كلمة من حرفين لا تحمل معنىً محمولاً غالباً، وحملُها تخمينٌ لا فهم
    if (only.stem.length < 3) return null;

    const relation: RelationKind = only.pos === 'فعل'
      ? 'فعل'
      : isAdjective(only.stem) ? 'صفة' : 'جنس';
    return { comment: only.stem, relation };
  }

  /**
   * مَن يملك في هذه الجملة؟
   *
   * والمِلك في العربية لا يُقال بفعل غالباً بل بحرف وضمير متّصل: «عندي» و«معه»
   * و«إلها». فيُقرأ من هذه القائمة المغلقة لا من التركيب.
   *
   * وهذا هو مدخل الغيرة الوحيد في الدماغ كله: لا غيرة إلا مما عند غيره. والمرجع
   * مقلوب بحسب المتكلّم: «أنا عندي» يقولها الأب فالمالك أبوه، و«أنت عندك»
   * يقولها له فالمالك زبير نفسه — ولا يغار المرء مما عنده.
   */
  possession(percept: Percept): 'الأب' | 'زبير' | 'غيره' | null {
    for (const token of percept.tokens) {
      const owner = POSSESSION.get(token);
      if (owner) return owner;
    }
    return null;
  }

  /** وصفٌ عربي لما يطلبه السؤال — يظهر في أثر النبضة. */
  describeAsk(asks: QuestionKind | null): string {
    if (asks === null) return 'ليست سؤالاً';
    const map: Record<QuestionKind, string> = {
      جنس: 'يسأل عن جنس الشيء', شخص: 'يسأل عن شخص', مكان: 'يسأل عن مكان',
      زمان: 'يسأل عن وقت', عدد: 'يسأل عن عدد', كيفية: 'يسأل عن كيفية',
      سبب: 'يسأل عن سبب', اختيار: 'يسأل عن اختيار', تصديق: 'يسأل تصديقاً: نعم أو لا',
    };
    return map[asks];
  }

  get parseCount(): number {
    return this.parsed;
  }

  save(): SyntaxState {
    return { parsed: this.parsed };
  }

  load(state: SyntaxState): void {
    try {
      if (typeof state?.parsed === 'number' && Number.isFinite(state.parsed)) {
        this.parsed = Math.max(0, Math.floor(state.parsed));
      }
    } catch { /* لا معرفة تُفقَد: هذا الفص مُوَلَّد لا متعلَّم */ }
  }
}

/**
 * أصفةٌ هي؟ تُفحَص الكلمة ومذكّرها معاً.
 *
 * تاء التأنيث تصير هاءً بالتطبيع، فـ«صغيرة» تصل «صغيره» ولا تطابق «صغير» في
 * القائمة. ولو تُركت لصارت «القطة صغيرة» جنساً فتهدم «القطة حيوان» — وهو العطل
 * نفسه الذي بُني هذا الفص لإصلاحه.
 */
function isAdjective(stem: string): boolean {
  if (ADJECTIVE_HINTS.has(stem)) return true;
  if (stem.endsWith('ه') && ADJECTIVE_HINTS.has(stem.slice(0, -1))) return true;
  // جمع الصفة السالم: «صغار» و«كبيرين» تُردّان إلى مفردهما تقريباً
  if (/(ين|ون|ات)$/.test(stem) && ADJECTIVE_HINTS.has(stem.replace(/(ين|ون|ات)$/, ''))) return true;
  return false;
}

/** روابط تُتجاوز عند بناء الطرفين: ليست طرفاً ولا محمولاً. */
const LINKING_WORDS: ReadonlySet<string> = new Set([
  'هو', 'هي', 'هما', 'هم', 'يعني', 'تعني', 'عباره', 'عن', 'كان', 'صار', 'ليس', 'ليست', 'مو', 'مش', 'لا',
]);

/** ألفاظ اجتماعية لا تُحمَل على موضوع سابق: تحيّةٌ وشكرٌ ومدح، لا وصفٌ لشيء. */
const SOCIAL_WORDS: ReadonlySet<string> = new Set([
  'مرحبا', 'اهلا', 'هلا', 'السلام', 'عليكم', 'صباح', 'مساء', 'الخير', 'النور',
  'شكرا', 'احسنت', 'برافو', 'ممتاز', 'عظيم', 'تمام', 'طيب', 'حسنا', 'اوك',
  'نعم', 'ايوا', 'اي', 'خطا', 'غلط', 'صح', 'صحيح', 'وينك', 'كيفك', 'رجعت',
]);

const PERSON_CATEGORIES: ReadonlySet<string> = new Set(['انسان', 'مهنه', 'قريب', 'شخص', 'اسم']);
const PLACE_CATEGORIES: ReadonlySet<string> = new Set(['مكان', 'مدينه', 'بلد', 'طبيعه']);
const TIME_CATEGORIES: ReadonlySet<string> = new Set(['وقت', 'فصل', 'زمان', 'يوم', 'شهر']);

export { QUESTION_TOOLS, NEGATIONS, PRONOUNS };
