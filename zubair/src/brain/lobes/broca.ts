/* ————— منطقة بروكا: الكلام —————
 *
 * آخر فص في المسار وأول ما يراه الأب. غيره يفكّر، وهذا ينطق.
 *
 * وأهم ما فيه أنه **يتدرّج**: الوليد لا يُنتج جملة تامة، والطفل يسأل «ليش؟»،
 * واليافع يسأل «هل كل كذا كذا؟». لو أُعطي زبير من أول يوم لغةً كاملة لكان
 * برنامجاً يتنكّر في هيئة طفل، ولانكشف الكذب في أول جلسة. التدرّج هو الصدق.
 *
 * ويتعلّم لهجة أبيه: القوالب المدمجة نقطة بدء لا سقفاً. بعد شواهد كافية من
 * كلام الأب يقدّم ما تعلّمه على ما وُلد به.
 */

import type { Rng } from '../core/tensor.js';
import type { Lexicon } from '../core/text.js';
import type { Percept } from '../core/text.js';
import type { Recall } from './hippocampus.js';
import type { Understanding } from './temporal.js';
import type { Fact, Interoception, Lobe, Stage, Strategy, TickOutput } from '../core/types.js';
import type { Gender, PartOfSpeech } from './syntax.js';
import { MATURE_STAGE } from '../core/types.js';

/** قسمُ الكلمة كما يلزم للسؤال. والصفة زائدة على أقسام الصرف الثلاثة لأنها
 *  اسمٌ في الإعراب وتُسأل سؤالاً آخر: «شو صغيرة؟» لحن، و«شو قطة؟» صواب. */
export type AskForm = PartOfSpeech | 'صفة';

export interface SpeechRequest {
  strategy: Strategy;
  stage: Stage;
  percept: Percept;
  understanding: Understanding;
  recall: Recall;
  fact: Fact | null;
  generalized: { fact: Fact; similarity: number } | null;
  intero: Interoception;
  unknownWords: readonly string[];
  /** كلمات المعنى في جملة الأب — بها يُسأل، فأدواتُ السؤال ليست أشياءً يُسأل عنها */
  contentWords?: readonly string[];
  /** قسمُ كل كلمة في جملة الأب: اسمٌ أم فعل أم صفة. بلاه يُصاغ سؤالٌ ملحون */
  wordForms?: ReadonlyMap<string, AskForm>;
  /** موضوع الحوار الآن — عنه يسأل، لا عن كلمةٍ معلّقة في الفراغ */
  topic?: string | null;
  /** جنس كل كلمة، وجنس الموضوع — بهما تُتجنَّب صيغةٌ لا تُطابق */
  wordGenders?: ReadonlyMap<string, Gender>;
  topicGender?: Gender;
  /** أخٌ في الجنس لموضوع الحوار — به يسأل سؤال القاعدة: «والكلب كمان حيوان؟» */
  akin?: Fact | null;
  askedBefore: readonly string[];
  lexicon: Lexicon;
  selfName: string;
  rng: Rng;
  /** عبارة شعوره الآن إن بلغ شدّةً تُقال — تأتي من فص المشاعر */
  feelingAr?: string | null;
}

export interface Speech {
  text: string;
  kind: TickOutput['kind'];
  /** الكلمة التي سأل عنها — يُسجّلها الجبهي فلا يعيد السؤال نفسه */
  about: string | null;
}

export interface BrocaState {
  shami: number;
  fusha: number;
  totalWords: number;
  sentences: number;
  openers: Array<{ word: string; count: number }>;
}

/* ————— شواهد اللهجة ————— */
const SHAMI_MARKERS: readonly string[] = ['شو', 'هيك', 'منيح', 'كيفك', 'ليش', 'هلق', 'كتير', 'بدي', 'مو', 'شلون', 'هاد', 'هاي', 'لك', 'يلا'];
const FUSHA_MARKERS: readonly string[] = ['ماذا', 'هكذا', 'جيد', 'كيف', 'لماذا', 'الآن', 'كثيرا', 'اريد', 'ليس', 'هذا', 'هذه', 'نعم'];

/** أدنى عدد شواهد قبل أن يُقدّم لهجة على أخرى. أقلّ من ذلك تخمين لا تعلّم. */
const DIALECT_MIN = 3;

/** مقاطع الثغثغة: صامت + صائت، وهي أول ما ينطقه أي طفل في أي لغة. */
const BABBLE_CONSONANTS: readonly string[] = ['ب', 'م', 'د', 'ت', 'ن', 'ل', 'ك', 'ج'];
const BABBLE_VOWELS: readonly string[] = ['ا', 'و', 'ي'];

export class Broca implements Lobe<BrocaState> {
  readonly name = 'broca';
  readonly ar = 'منطقة بروكا';
  readonly role = 'يصوغ جملته العربية، ويتعلّم أسلوبك ولهجتك فيصير كلامه كلامك';

  private shami = 0;
  private fusha = 0;
  private totalWords = 0;
  private sentences = 0;
  private openers = new Map<string, number>();

  /* بروكا لا تملك عشوائية خاصة بها بقصد: تستلمها في كل طلب من الدماغ (req.rng)
   * كي يبقى كلام زبير قابلاً للإعادة بنفس البذرة — وهو شرط إثبات تعلّمه في
   * الاختبارات. فصٌّ يخفي مولّده العشوائي داخله لا يمكن اختبار كلامه. */

  /** أيّهما لهجته الآن: الشامية أم الفصحى — بحسب ما سمع من أبيه. */
  private get isShami(): boolean {
    if (this.shami + this.fusha < DIALECT_MIN) return true; // البدء بالشامية: الأب سوري
    return this.shami >= this.fusha;
  }

  private pick(options: readonly string[], rng: Rng): string {
    if (options.length === 0) return '';
    return options[rng.int(options.length)] ?? options[0]!;
  }

  speak(req: SpeechRequest): Speech {
    const speech = this.compose(req);
    // حدّ المرحلة حدٌّ فعليّ لا زينة: الوليد لا ينطق جملة مهما كان جوابه صحيحاً
    const trimmed = limitWords(speech.text, req.stage.maxWords);
    const body = trimmed.length > 0 ? trimmed : this.babble(req).text;
    return { ...speech, text: this.tint(body, req) };
  }

  /**
   * أثر الشعور في اللسان: كلمتان تُلحَقان، لا جملة تُستبدَل.
   *
   * ولا تدخلان في حدّ المرحلة بقصد: حدّ الكلمات حدُّ **تركيبٍ** — كم لفظاً
   * يستطيع أن ينظم في جملة واحدة. وعبارة الشعور ليست تركيباً بل صيحة، والطفل
   * الذي لا يُركّب جملتين يقول «آسف» و«خفت» من أول سنة.
   */
  private tint(text: string, req: SpeechRequest): string {
    const phrase = req.feelingAr;
    if (!phrase || text.length === 0 || text.includes(phrase)) return text;
    return text.endsWith('؟') ? `${text} ${phrase}` : `${text}، ${phrase}`;
  }

  /** أشاميٌّ لسانه الآن؟ يقرؤه فص المشاعر ليختار عبارة شعوره بلهجة أبيه. */
  get speaksShami(): boolean {
    return this.isShami;
  }

  private compose(req: SpeechRequest): Speech {
    switch (req.strategy) {
      case 'BABBLE': return this.babble(req);
      case 'ASK_QUESTION': return this.ask(req);
      case 'ANSWER_MEMORY': return this.answerFromMemory(req);
      case 'ANSWER_GENERAL': return this.answerByGeneralizing(req);
      case 'ADMIT': return this.admit(req);
      case 'ACKNOWLEDGE': return this.acknowledge(req);
      case 'GREET_BACK': return this.greet(req);
    }
  }

  /* ————— الثغثغة —————
   * من حروف سمعها فعلاً في كلام أبيه لا من حروف عشوائية: الوليد يُثغثغ بما سمع.
   * وأحياناً يُعيد جزءاً من كلمة قالها أبوه، وهذا أول أثر للتقليد. */
  private babble(req: SpeechRequest): Speech {
    const heard = req.percept.tokens.filter((t) => /[ء-ي]/.test(t));
    const rng = req.rng;

    if (heard.length > 0 && rng.next() < 0.4) {
      const word = heard[rng.int(heard.length)]!;
      const piece = word.slice(0, Math.max(2, Math.min(3, word.length)));
      return { text: `${piece}${piece}`, kind: 'babble', about: null };
    }

    const letters: string[] = [];
    for (const token of heard) for (const ch of token) letters.push(ch);
    const consonants = letters.length > 0 ? letters : BABBLE_CONSONANTS;

    const syllable = (): string => {
      const c = consonants[rng.int(consonants.length)] ?? 'ب';
      const v = BABBLE_VOWELS[rng.int(BABBLE_VOWELS.length)] ?? 'ا';
      return `${c}${v}`;
    };

    const count = 1 + rng.int(2);
    let out = '';
    for (let i = 0; i < count; i++) out += syllable();
    return { text: out, kind: 'babble', about: null };
  }

  /* ————— السؤال —————
   *
   * كانت أسئلته تُبنى بقالبٍ واحد يُحشى فيه أيُّ لفظٍ كان، فخرجت ملحونةً
   * وغريبة: «علّمني أكثر عن بيطير»، و«علّمني أكثر عن ضخم» — و«عن» لا يدخل على
   * فعلٍ ولا على صفةٍ مفردة في العربية. ولا يُصلحه تحسينُ القالب: الخلل أن
   * القالب لا يعرف **قسم الكلمة** ولا **موضوع الحوار**.
   *
   * والسؤال هنا يُبنى على ثلاثة:
   *
   *   ١) قسمُ ما يجهله: الاسم يُسأل عنه بـ«شو»، والصفةُ بـ«شو يعني» و«مين
   *      كمان»، والفعلُ بـ«ليش» و«كيف». وسؤالُ صفةٍ بـ«شو» لحنٌ لا طفولة.
   *   ٢) موضوعُ الحوار: «ليش القطة صغيرة؟» لا «ليش صغيرة؟». الطفل يسأل عن
   *      الشيء الذي بين يديه لا عن لفظٍ معلّق.
   *   ٣) ما يعرفه أصلاً: «القطة حيوان… والكلب كمان حيوان؟» — وهذا أصدق ما
   *      يسأله طفل، لأنه امتحانُ قاعدةٍ بناها لا استفهامٌ عن لفظ.
   *
   * والتدرّج باقٍ: الوليد يُعيد اللفظ باستفهام، والطفل في سنّ «ليش»، واليافع
   * يسأل عن الحدّ والفرق.
   */
  private ask(req: SpeechRequest): Speech {
    const rng = req.rng;
    const target = this.questionTarget(req);
    /* والموضوع يُقارَن بالمسؤول عنه بجذعيهما لا بصورتيهما: «الجمل» و«جمل»
     * شيءٌ واحد، فلولا نزع الأداة لخرج «الجمل متل جمل؟» — سؤالٌ عن تشابه
     * الشيء بنفسه، وهو أظهر ما يفضح قالباً يُحشى بلا فهم. */
    const topic = req.topic && !sameThing(req.topic, target)
      ? req.lexicon.pretty(req.topic)
      : null;

    if (target) {
      const pos: AskForm = req.wordForms?.get(target) ?? 'مجهول';
      const word = req.lexicon.pretty(target);
      /* الموضوع لا يُذكر مع الكلمة إلا إذا طابقها في التذكير والتأنيث: «كلب
       * دايماً صغيرة؟» لحنٌ لا يقوله طفلٌ عربي في أي سنّ. وحين لا تُطابق
       * تُستعمل صيغةٌ لا موضوع فيها — «مين كمان صغيرة؟» — فيبقى السؤال
       * سليماً ولا يُخترع تصريف. */
      const wordGender = req.wordGenders?.get(target) ?? 'مجهول';
      const agrees = topic !== null
        && (req.topicGender === undefined || req.topicGender === 'مجهول'
          || wordGender === 'مجهول' || req.topicGender === wordGender);
      return {
        text: this.pick(this.aboutWord(word, pos, agrees ? topic : null, req.stage.id), rng),
        kind: 'question',
        about: target,
      };
    }

    // لا يجهل لفظاً: فيسأل عمّا يعرف — امتحانَ قاعدةٍ أو استزادة
    if (topic) {
      return {
        text: this.pick(this.aboutTopic(topic, req, req.stage.id), rng),
        kind: 'question',
        about: req.topic ?? null,
      };
    }

    const open = this.isShami
      ? ['شو صار؟', 'وبعدين؟', 'شو هاد؟', 'في شي جديد؟']
      : ['ماذا حدث؟', 'ثم ماذا؟', 'ما هذا؟', 'هل من جديد؟'];
    return { text: this.pick(open, rng), kind: 'question', about: null };
  }

  /** سؤالٌ عن لفظٍ يجهله، مصوغٌ على قسمه الصرفي ومرحلته. */
  private aboutWord(word: string, pos: AskForm, topic: string | null, stage: number): readonly string[] {
    // الوليد لا يُركّب سؤالاً: يُعيد اللفظ باستفهام، وهذا أول سؤال في كل لغة
    if (stage === 0) return [`${word}؟`, 'شو؟'];

    const shami = this.isShami;

    /* بلا موضوعٍ مطابق لا يُستبدَل باسم إشارة: «هاد» مذكّر، فـ«هاد دايماً
     * صغيرة؟» لحنٌ كالذي فررنا منه. والسؤال بلا موضوع سليمٌ تامّ. */
    if (topic === null && (pos === 'صفة' || pos === 'فعل')) {
      if (stage <= 1) return [`${word}؟`, shami ? 'شو؟' : 'ماذا؟'];
      return shami
        ? [`شو يعني ${word}؟`, `مين كمان ${word}؟`, `${word}؟ ليش؟`]
        : [`ما معنى ${word}؟`, `من أيضاً ${word}؟`, `${word}؟ لماذا؟`];
    }

    const on = topic ?? (shami ? 'هاد' : 'هذا');

    if (pos === 'فعل') {
      /* الفعل لا يُسأل عنه بـ«شو» ولا يدخل عليه «عن»: يُسأل عن فاعله وسببه
       * وكيفيته. وهذا ما يفعله الطفل: «ليش بيطير؟» لا «شو بيطير؟». */
      if (stage === 1) return shami ? [`${word}؟`, 'ليش؟'] : [`${word}؟`, 'لماذا؟'];
      if (stage === 2) {
        return shami
          ? [`ليش ${on} ${word}؟`, `${on} ${word} كيف؟`, `شو يعني ${word}؟`]
          : [`لماذا ${on} ${word}؟`, `كيف ${on} ${word}؟`, `ما معنى ${word}؟`];
      }
      if (stage === 3) {
        return shami
          ? [`ليش ${on} ${word}؟`, `مين كمان ${word}؟`, `${on} دايماً ${word}؟`]
          : [`لماذا ${on} ${word}؟`, `من أيضاً ${word}؟`, `هل ${on} دائماً ${word}؟`];
      }
      return shami
        ? [`ليش ${on} ${word} ومو غير هيك؟`, `كل شي متل ${on} ${word}؟`, `شو بيصير لو ما ${word}؟`]
        : [`لماذا ${on} ${word} لا غير ذلك؟`, `هل كل مثله ${word}؟`, `ماذا يحدث لو لم ${word}؟`];
    }

    if (pos === 'صفة') {
      /* الصفة كذلك: «شو صغيرة؟» لحن. وأصدق ما يسأله الطفل عن صفة أن يمتحن
       * مداها: «مين كمان صغير؟» — يبني بها صنفاً لا يحفظ لفظاً. */
      if (stage === 1) return shami ? [`${word}؟`, `${on} ${word}؟`] : [`${word}؟`, `${on} ${word}؟`];
      if (stage === 2) {
        return shami
          ? [`شو يعني ${word}؟`, `ليش ${on} ${word}؟`, `مين كمان ${word}؟`]
          : [`ما معنى ${word}؟`, `لماذا ${on} ${word}؟`, `من أيضاً ${word}؟`];
      }
      if (stage === 3) {
        return shami
          ? [`شو يعني ${word}؟`, `مين كمان ${word}؟`, `${on} دايماً ${word}؟`]
          : [`ما معنى ${word}؟`, `من أيضاً ${word}؟`, `هل ${on} دائماً ${word}؟`];
      }
      return shami
        ? [`كل ${on} ${word}؟`, `شو الفرق بين ${word} وغيره؟`, `إيمتى بيصير ${on} مو ${word}؟`]
        : [`هل كل ${on} ${word}؟`, `ما الفرق بين ${word} وغيره؟`, `متى لا يكون ${on} ${word}؟`];
    }

    /* ما لم تُبيّن العلامةُ قسمَه: يُسأل عنه بما يصلح لكل قسم.
     *
     * و«عن» و«كل» و«شو» تُمنَع هنا بقصد: ثلاثتها تفترض الاسمية، فلو حُشي فيها
     * فعلٌ لم تُبيّنه العلامة خرج اللحن نفسه الذي بُني هذا كلُّه لإصلاحه. ومَن
     * لا يعرف قسم الكلمة يسأل سؤالاً محايداً — والحياد هنا صدقٌ لا عجز. */
    if (pos === 'مجهول') {
      if (stage <= 1) return [`${word}؟`, shami ? 'شو؟' : 'ماذا؟'];
      return shami
        ? [`شو يعني ${word}؟`, `${word} يعني شو؟`, `ليش قلت ${word}؟`]
        : [`ما معنى ${word}؟`, `${word} تعني ماذا؟`, `لماذا قلت ${word}؟`];
    }

    // اسمٌ مؤكَّد: هذا وحده ما يصحّ فيه «شو» و«عن» و«كل»
    if (stage === 1) return shami ? [`شو ${word}؟`, `${word}؟`] : [`ما ${word}؟`, `${word}؟`];
    if (stage === 2) {
      return shami
        ? [`شو يعني ${word}؟`, `${word} شو؟`, `وين ${word}؟`]
        : [`ما معنى ${word}؟`, `ما هي ${word}؟`, `أين ${word}؟`];
    }
    if (stage === 3) {
      return shami
        /* كلها استفهامٌ صريح: «حكيلي كمان عن كذا» طلبٌ لا سؤال، وكان يخرج بلا
         * علامة استفهام فيُعرَض على الأب سؤالاً وهو أمر. */
        ? [`شو يعني ${word} بالزبط؟`, `${word} متل ${on}؟`, `وشو كمان عن ${word}؟`]
        : [`ما معنى ${word} بالضبط؟`, `هل ${word} مثل ${on}؟`, `وماذا أيضاً عن ${word}؟`];
    }
    return shami
      ? [`شو الفرق بين ${word} و${on}؟`, `كل ${word} متل بعضها؟`, `ليش سمّوها ${word}؟`]
      : [`ما الفرق بين ${word} و${on}؟`, `هل كل ${word} سواء؟`, `لماذا سُمّيت ${word}؟`];
  }

  /**
   * سؤالٌ عمّا يعرفه: امتحانُ قاعدةٍ بناها، أو طلبُ استزادة.
   *
   * وامتحان القاعدة أنفع سؤال يسأله طفل: «القطة حيوان… والكلب كمان حيوان؟»
   * يمتحن به حدّ الصنف، فيتعلّم من جواب أبيه ما لا يتعلّمه من مئة درس مفرد.
   */
  private aboutTopic(topic: string, req: SpeechRequest, stage: number): readonly string[] {
    const shami = this.isShami;
    const akin = req.akin;

    if (akin && stage >= 2) {
      const other = req.lexicon.pretty(akin.subject);
      const category = req.lexicon.pretty(akin.object);
      return shami
        ? [`و${other} كمان ${category}؟`, `${topic} و${other} متل بعض؟`, `كل شي ${category} متل ${topic}؟`]
        : [`وهل ${other} أيضاً ${category}؟`, `هل ${topic} و${other} سواء؟`, `هل كل ${category} مثل ${topic}؟`];
    }

    if (stage <= 1) return shami ? [`${topic}؟`, 'وبعدين؟'] : [`${topic}؟`, 'ثم ماذا؟'];
    /* بلا «عن»: موضوع الحوار قد يكون لفظاً لم تُبيّن العلامةُ اسميّته، و«عن»
     * تفترض الاسم. قِيسَ فخرج «وشو كمان عن عرفتها؟». وهذه الصيغ تصلح لكل لفظ. */
    return shami
      ? [`و${topic} شو كمان؟`, `ليش ${topic}؟`, `${topic}؟ كيف يعني؟`]
      : [`و${topic} ماذا أيضاً؟`, `لماذا ${topic}؟`, `${topic}؟ كيف؟`];
  }

  /** ما يسأل عنه: مجهول حاضر لم يسأل عنه قبلاً، أو أقلّ كلماته سماعاً. */
  private questionTarget(req: SpeechRequest): string | null {
    for (const word of req.unknownWords) {
      if (!req.askedBefore.includes(word)) return word;
    }
    /* كل المجهول سُئل عنه: يسأل عن كلمة معروفة لكن قليلة السماع — يعرف لفظها
     * ولا يعرف معناها، وهذا حال الطفل مع أكثر ما يسمع.
     *
     * والبحث في كلمات المعنى وحدها: أدوات الاستفهام قليلة في كلام الأب فتفوز
     * بالنُّدرة، فيسأل «علّمني أكثر عن كيف» — سؤالٌ عن أداة سؤاله. رآه الأب. */
    const pool = req.contentWords ?? req.percept.tokens;
    let rarest: string | null = null;
    let fewest = Infinity;
    for (const token of pool) {
      if (req.askedBefore.includes(token)) continue;
      const count = req.lexicon.countOf(token);
      if (count > 0 && count < fewest) {
        fewest = count;
        rarest = token;
      }
    }
    return rarest;
  }

  /* ————— الجواب من ذاكرة صريحة ————— */
  private answerFromMemory(req: SpeechRequest): Speech {
    const raw = req.fact;
    if (!raw) return this.admit(req);
    // يتكلّم بصورة أبيه لا بالصورة المطبَّعة: «فاكهة» لا «فاكهه»
    const fact = { ...raw, subject: req.lexicon.pretty(raw.subject), object: req.lexicon.pretty(raw.object) };

    /* «علّمتني هيك» لا تُقال إلا لما علّمه أبوه بنفسه.
     *
     * وهذا ليس تدقيقاً لغوياً بل صدقاً: زبير يرث عربية محيطه كما يرثها الطفل،
     * فلو نسب الموروث إلى أبيه لأوهمه أنه علّمه ما لم يعلّمه — وأفسد المقياس
     * الوحيد الذي يعرف به الأب أن تعليمه ينفع. والمصدر مكتوب في الحقيقة نفسها. */
    const fromFather = raw.taughtBy.includes('أبوه');
    const plain = [`${fact.object}`, `${fact.subject} ${fact.object}`];

    /* الشابّ يُخبر ولا يستأذن: لا «هو» حشواً بين الطرفين، ولا «صح؟» في آخر خبر
     * يعرفه. وحشوُ «هو» طفوليّ في العربية المنطوقة: «البحر أزرق» لا «بحر هو
     * أزرق». والجملة الاسمية عربيةٌ بلا رابطة أصلاً. */
    if (req.stage.id >= MATURE_STAGE) {
      const said = req.lexicon.asSaid(raw.subject);
      const mature = fromFather
        ? [`${said} ${fact.object}`, `${said} ${fact.object}، أنت علّمتني`]
        : [`${said} ${fact.object}`];
      return { text: this.pick(mature, req.rng), kind: 'answer', about: fact.subject };
    }

    const options = req.stage.id <= 1
      ? plain
      : fromFather
        ? this.isShami
          ? [`${fact.subject} ${fact.object}`, `${fact.subject} هو ${fact.object}، علّمتني هيك`]
          : [`${fact.subject} ${fact.object}`, `${fact.subject} هو ${fact.object}، هكذا علّمتني`]
        : this.isShami
          ? [`${fact.subject} ${fact.object}`, `${fact.subject} هو ${fact.object}`]
          : [`${fact.subject} ${fact.object}`, `${fact.subject} هو ${fact.object}`];

    return { text: this.pick(options, req.rng), kind: 'answer', about: fact.subject };
  }

  /* ————— الجواب بالتعميم —————
   * لم يُعلَّم هذا، فاستنتجه من شبيه. ويجب أن يظهر في كلامه أنه يخمّن: طفل
   * يقول التخمين يقيناً يُضلّل أباه فلا يصحّح له. */
  private answerByGeneralizing(req: SpeechRequest): Speech {
    const guess = req.generalized;
    if (!guess) return this.admit(req);
    const { similarity } = guess;
    const fact = {
      subject: req.lexicon.pretty(guess.fact.subject),
      object: req.lexicon.pretty(guess.fact.object),
    };

    const options = this.isShami
      ? [
        `أظن ${fact.object}… مثل ${fact.subject}؟`,
        `يمكن ${fact.object}، لأنه يشبه ${fact.subject}`,
        `مو متأكّد… أظن ${fact.object}`,
      ]
      : [
        `أظن ${fact.object}… مثل ${fact.subject}؟`,
        `ربما ${fact.object}، لأنه يشبه ${fact.subject}`,
        `لست متأكّداً… أظن ${fact.object}`,
      ];

    // شبه ضعيف يستحقّ تحفّظاً أصرح: يقين مزعوم على شبه بعيد هو التخريف نفسه
    const text = similarity < 0.7 ? this.pick(options.slice(2), req.rng) : this.pick(options, req.rng);
    return { text, kind: 'answer', about: fact.subject };
  }

  /* ————— الإقرار بالجهل: يطلب التعليم لا يعتذر ————— */
  private admit(req: SpeechRequest): Speech {
    if (req.stage.id >= MATURE_STAGE) {
      /* والشابّ يُقرّ بحدّ معرفته لا يستجدي: «ما بعرف، علّمني» عبارة طفل. */
      const options = this.isShami
        ? ['ما عندي معلومة عن هذا', 'هذا ما بعرفه، حكيلي عنه', 'ما وصلني شي عن هذا']
        : ['لا أملك معلومة عن هذا', 'هذا لا أعرفه، حدّثني عنه', 'لم يصلني شيء عن هذا'];
      return { text: this.pick(options, req.rng), kind: 'admission', about: null };
    }
    const options = this.isShami
      ? ['ما بعرف، علّمني', 'ما بعرف شو هذا، علّمني', 'علّمني، بدي أعرف']
      : ['لا أعرف، علّمني', 'لا أعرف هذا، علّمني', 'علّمني، أريد أن أعرف'];
    return { text: this.pick(options, req.rng), kind: 'admission', about: null };
  }

  /* ————— الإقرار بالتلقّي: وأحياناً يُعيد ما تعلّمه ليؤكّده ————— */
  private acknowledge(req: SpeechRequest): Speech {
    const fact = req.fact;

    /* الشابّ يُقرّ بالتلقّي إقراراً لا استفهاماً: «صح؟» بعد كل درس تردّدُ طفل،
     * وهي أظهر ما يجعل كلامه صبيانياً بعد أن كبر. */
    if (req.stage.id >= MATURE_STAGE) {
      const options = this.isShami
        ? ['فهمت', 'تمام، سجّلتها', 'واضح', 'أخذتها']
        : ['فهمت', 'حسناً، حفظتها', 'واضح', 'أخذت بها'];
      return { text: this.pick(options, req.rng), kind: 'acknowledge', about: fact?.subject ?? null };
    }

    if (fact && req.rng.next() < 0.5 && req.stage.id >= 1) {
      const subject = req.lexicon.pretty(fact.subject);
      const object = req.lexicon.pretty(fact.object);
      return {
        text: this.isShami ? `${subject} ${object}، صح؟` : `${subject} ${object}، صحيح؟`,
        kind: 'acknowledge',
        about: fact.subject,
      };
    }
    const options = this.isShami
      ? ['حفظت', 'طيب', 'تمام', 'عرفت']
      : ['حفظت', 'حسناً', 'تمام', 'عرفت'];
    return { text: this.pick(options, req.rng), kind: 'acknowledge', about: null };
  }

  /* ————— ردّ التحية ————— */
  private greet(req: SpeechRequest): Speech {
    if (req.stage.id === 0) {
      return { text: this.isShami ? 'هلا' : 'مرحبا', kind: 'greeting', about: null };
    }
    const options = req.stage.id >= MATURE_STAGE
      ? (this.isShami
        ? ['أهلاً، كيفك؟', 'هلا، اشتقتلك', 'أهلاً فيك، شو أخبارك؟']
        : ['أهلاً، كيف حالك؟', 'مرحباً، اشتقت إليك', 'أهلاً بك، ما أخبارك؟'])
      : (this.isShami
        ? ['هلا فيك', `هلا، أنا ${req.selfName}`, 'هلا، وينك؟']
        : ['مرحبا بك', `مرحبا، أنا ${req.selfName}`, 'مرحبا، أين كنت؟']);
    return { text: this.pick(options, req.rng), kind: 'greeting', about: null };
  }

  /* ————— تعلّم أسلوب الأب ————— */
  learnStyle(text: string): void {
    if (typeof text !== 'string' || text.trim().length === 0) return;
    const words = text.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return;

    this.sentences++;
    this.totalWords += words.length;

    const opener = words[0]!;
    this.openers.set(opener, (this.openers.get(opener) ?? 0) + 1);
    if (this.openers.size > 64) {
      const kept = [...this.openers.entries()].sort((a, b) => b[1] - a[1]).slice(0, 64);
      this.openers = new Map(kept);
    }

    for (const word of words) {
      if (SHAMI_MARKERS.includes(word)) this.shami++;
      else if (FUSHA_MARKERS.includes(word)) this.fusha++;
    }
  }

  /** متوسط طول جملة أبيه — يُستعمل مرجعاً للنمو لا حدّاً. */
  get averageFatherLength(): number {
    return this.sentences === 0 ? 0 : this.totalWords / this.sentences;
  }

  get dialectAr(): string {
    if (this.shami + this.fusha < DIALECT_MIN) return 'لم يتبيّن بعد';
    return this.shami >= this.fusha ? 'شامية' : 'فصحى';
  }

  save(): BrocaState {
    return {
      shami: this.shami,
      fusha: this.fusha,
      totalWords: this.totalWords,
      sentences: this.sentences,
      openers: [...this.openers.entries()].map(([word, count]) => ({ word, count })),
    };
  }

  load(state: BrocaState): void {
    try {
      if (!state || typeof state !== 'object') return;
      this.shami = intOr(state.shami, 0);
      this.fusha = intOr(state.fusha, 0);
      this.totalWords = intOr(state.totalWords, 0);
      this.sentences = intOr(state.sentences, 0);
      this.openers = new Map();
      if (Array.isArray(state.openers)) {
        for (const entry of state.openers) {
          if (entry && typeof entry.word === 'string') this.openers.set(entry.word, intOr(entry.count, 1));
        }
      }
    } catch { /* أسلوب عطب يُترك: يعود يتكلّم بقوالبه المدمجة */ }
  }
}

/** أهما الشيء نفسه؟ تُنزع أداة التعريف من الطرفين ثم يُقارَن ما بقي. */
function sameThing(a: string, b: string | null): boolean {
  if (!b) return false;
  const bare = (word: string): string => (word.length >= 5 && word.startsWith('ال') ? word.slice(2) : word);
  return bare(a) === bare(b);
}

function limitWords(text: string, max: number): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= max) return words.join(' ');
  /* القصّ يقطع الجملة في وسطها فتبقى فاصلة أو واو معلّقة («ما بعرف،» و«علّمني،
   * بدي»)، وهي أظهر ما يجعل كلامه يبدو معطوباً لا طفولياً. فتُحذف علامات الوصل
   * من آخر المقصوص، وتُحذف كلمة الوصل الأخيرة إن كانت حرفاً معلّقاً. */
  let kept = words.slice(0, max);
  const dangling = new Set(['و', 'ثم', 'بدي', 'اريد', 'أريد', 'أن', 'ان', 'مثل', 'في', 'من', 'على']);
  while (kept.length > 1 && dangling.has(stripEdgePunctuation(kept[kept.length - 1]!))) kept = kept.slice(0, -1);
  let cut = kept.join(' ').replace(/[،؛:,\-–—]+$/u, '').trim();
  if (cut.length === 0) cut = words.slice(0, max).join(' ');
  // لو كانت جملة استفهام فالعلامة تُنقل: سؤال بلا علامة يصير خبراً
  return text.trim().endsWith('؟') && !cut.endsWith('؟') ? `${cut}؟` : cut;
}

function stripEdgePunctuation(word: string): string {
  return word.replace(/^[،؛:,\-–—]+|[،؛:,\-–—]+$/gu, '');
}

function intOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : fallback;
}
