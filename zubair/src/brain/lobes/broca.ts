/* ————— منطقة بروكا: الكلام —————
 *
 * آخر فص في المسار وأول ما يراه الأب. غيره يفكّر، وهذا ينطق.
 *
 * وكان فيه سُلّم أطوار: الوليد يُثغثغ، والطفل يقول كلمتين، واليافع يُركّب. وقد
 * حُذف بطلب الأب، ومعه الثغثغة كلُّها. والحذف صوابٌ لا تنازل: السُّلّم كان
 * يقصّ جواباً يعرفه لأن «مرحلته» لا تسمح، ويُنطقه ثغثغةً وهو يملك الكلمة.
 * فبقي لسانٌ واحد: يقول ما يعرف كما يعرفه، ويسكت عمّا لا يعرف.
 *
 * ويتعلّم لهجة أبيه: القوالب المدمجة نقطة بدء لا سقفاً. بعد شواهد كافية من
 * كلام الأب يقدّم ما تعلّمه على ما وُلد به.
 */

import type { Rng } from '../core/tensor.js';
import type { Lexicon } from '../core/text.js';
import type { Percept } from '../core/text.js';
import type { Recall } from './hippocampus.js';
import type { Understanding } from './temporal.js';
import type { Fact, Interoception, Lobe, Strategy, TickOutput } from '../core/types.js';
import type { Gender, PartOfSpeech } from './syntax.js';
import { ASKS_KNOWLEDGE, voidAnswer, type Request } from '../core/ownership.js';
import { MAX_SENTENCE_WORDS } from '../core/types.js';

/** قسمُ الكلمة كما يلزم للسؤال. والصفة زائدة على أقسام الصرف الثلاثة لأنها
 *  اسمٌ في الإعراب وتُسأل سؤالاً آخر: «شو صغيرة؟» لحن، و«شو قطة؟» صواب. */
export type AskForm = PartOfSpeech | 'صفة';

export interface SpeechRequest {
  strategy: Strategy;
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
  /* ————— جدول الملكية ————— */
  /** نوع الطلب كما استخرجه النحو: به يُقرّ بلسان الطلب، وبه يُعرَف المالك */
  request?: Request;
  /** جواب الجزيرة عن حاله — مالكُ طلبِ «حال» وحده. بلاه يُجيب الجُداري عن سؤالٍ ليس له */
  selfStateAr?: string | null;
  /** أعاد المالكُ فارغاً؟ عندها يُقال الإقرار وحده ولا يُلحَق به شيء */
  ownerVoid?: boolean;
  /** خفّضت المراجعةُ الدعوى إلى ظنّ: تُقال بلهجة الظنّ لا بلهجة اليقين */
  hedge?: boolean;
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
    /* حدُّ وضوحٍ لا حدُّ طور: ما تجاوزه يُقرأ ثرثرة. وما خرج فارغاً يُقال
     * إقراراً بالجهل لا ثغثغةً — من لا يملك ما يقوله يقول ذلك. */
    const trimmed = limitWords(speech.text, MAX_SENTENCE_WORDS);
    const body = trimmed.length > 0 ? trimmed : this.admit(req).text;
    return { ...speech, text: this.tint(this.hedged(body, req), req, speech.kind) };
  }

  /**
   * لهجةُ الظنّ حين تُخفّض المراجعةُ الدعوى.
   *
   * وهذا ثمنُ ألّا تكون ثقةُ زبير احتمالاً معايَراً: من لا يملك رقماً يصحّ أن
   * يُبنى عليه لا يجوز أن يتكلّم بلهجة اليقين إلا في أعلى الرتب. فالرتبة
   * «راجح» تُقال «بظنّي…» — والفرق بينها وبين الجزم يقرؤه الأب في اللفظ.
   */
  private hedged(text: string, req: SpeechRequest): string {
    if (!req.hedge || text.length === 0) return text;
    const prefix = this.isShami ? 'بظنّي' : 'أظنّ أنّ';
    return `${prefix} ${text}`;
  }

  /** أثر الشعور في اللسان: كلمتان تُلحَقان، لا جملة تُستبدَل. */
  private tint(text: string, req: SpeechRequest, kind: TickOutput['kind']): string {
    /* ————— ولا يُلحَق بالفراغ شيء —————
     *
     * سُدَّ منفذُ الجنس المهرَّب فخرج الضغط سؤالاً، فسُدَّ السؤال. والقاعدة أن
     * النظام يُفضّل إنتاج مخرَجٍ على إنتاج إقرار، فكلّما سُدّ منفذ وجد آخر —
     * ويُكتب قانونٌ خامسٌ وسادس واحداً واحداً بلا نهاية.
     *
     * فالفئة كلُّها تُغلق بقاعدةٍ واحدة: دورٌ عاد فيه المالك فارغاً يُخرج
     * **شكلاً واحداً** — الإقرار — ولا يُلحَق به شيء. لا سؤالٌ، ولا جنسٌ
     * مهرَّب، ولا تحية، ولا حتى لونُ شعور: «ما بعرف وين، وأنا مبسوط» يُقرأ
     * تهرّباً مبتهجاً. */
    /* والعبرة بما خرج لا بما نُوي: كلُّ دورٍ انتهى إقراراً بالجهل فارغٌ مهما
     * كان سببه — خزانةٌ لا وجود لها، أو خزانةٌ موجودةٌ خاوية، أو دعوى أسقطتها
     * المراجعة. وقد قِيسَ فخرج «ما بعرف كيف هو، أنا مبسوط»: إقرارٌ مبتهج. */
    if (req.ownerVoid || kind === 'admission') return text;
    const phrase = req.feelingAr;
    if (!phrase || text.length === 0 || text.includes(phrase)) return text;
    return text.endsWith('؟') ? `${text} ${phrase}` : `${text}، ${phrase}`;
  }

  /** أشاميٌّ لسانه الآن؟ يقرؤه فص المشاعر ليختار عبارة شعوره بلهجة أبيه. */
  get speaksShami(): boolean {
    return this.isShami;
  }

  private compose(req: SpeechRequest): Speech {
    /* المالك يتكلّم أولاً: سُئل عن حاله، فالجزيرة تُجيب لا الجُداري. وهذا قبل
     * الاستراتيجية لا بعدها — الاستراتيجية تختار **كيف** يتكلّم، والملكية
     * تقرّر **من** يتكلّم، والثانية أسبق. */
    if (req.request === 'حال' && req.selfStateAr) {
      return { text: req.selfStateAr, kind: 'answer', about: null };
    }
    /* والملتبس جوابه سؤالٌ يستوضح. ولا يُرجَّح بين تأويلاته: هي قراءاتٌ لجملةٍ
     * واحدة، وأبوه وحده يعرف أيّها أراد — فسؤالُه أصدق من ترجيحٍ بينها. */
    if (req.request === 'مُلتبس') return this.clarify(req);
    switch (req.strategy) {
      case 'ASK_QUESTION': return this.ask(req);
      case 'ANSWER_MEMORY': return this.answerFromMemory(req);
      case 'ANSWER_GENERAL': return this.answerByGeneralizing(req);
      case 'ADMIT': return this.admit(req);
      case 'ACKNOWLEDGE': return this.acknowledge(req);
      case 'GREET_BACK': return this.greet(req);
    }
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
     * شيءٌ واحد، فلولا نزع الأداة لخرج «الجمل متل جمل؟». */
    const topic = req.topic && !sameThing(req.topic, target)
      ? req.lexicon.asSaid(req.topic)
      : null;

    if (target) {
      const pos: AskForm = req.wordForms?.get(target) ?? 'مجهول';
      const word = req.lexicon.pretty(target);
      /* الموضوع لا يُذكر مع الكلمة إلا إذا طابقها في التذكير والتأنيث: «كلب
       * دايماً صغيرة؟» لحنٌ لا يقوله عربيّ. */
      const wordGender = req.wordGenders?.get(target) ?? 'مجهول';
      const agrees = topic !== null
        && (req.topicGender === undefined || req.topicGender === 'مجهول'
          || wordGender === 'مجهول' || req.topicGender === wordGender);
      return {
        text: this.pick(this.aboutWord(word, pos, agrees ? topic : null), rng),
        kind: 'question',
        about: target,
      };
    }

    // لا يجهل لفظاً: فيسأل عمّا يعرف — امتحانَ قاعدةٍ أو استزادة
    if (topic) {
      return { text: this.pick(this.aboutTopic(topic, req), rng), kind: 'question', about: req.topic ?? null };
    }

    const open = this.isShami
      ? ['شو صار؟', 'في شي جديد؟', 'شو بدك نحكي اليوم؟']
      : ['ماذا حدث؟', 'هل من جديد؟', 'ماذا تريد أن نتحدّث فيه؟'];
    return { text: this.pick(open, rng), kind: 'question', about: null };
  }

  /**
   * سؤالٌ عن لفظٍ يجهله، مصوغٌ على قسمه الصرفي.
   *
   * وكان لكل طور صيغه، فيسأل الوليد «صغيره؟» ويسأل اليافع «كل صغير هيك؟».
   * وقد بقيت صيغةٌ واحدة: أدقّها. والذي يبقى من التمييز هو **قسم الكلمة** لا
   * سنّ السائل — فالاسم يُسأل عنه بـ«شو»، والصفةُ بـ«شو يعني» و«مين كمان»،
   * والفعلُ بـ«ليش» و«كيف». وسؤالُ صفةٍ بـ«شو» لحنٌ في أي سنّ.
   */
  private aboutWord(word: string, pos: AskForm, topic: string | null): readonly string[] {
    const shami = this.isShami;

    /* بلا موضوعٍ مطابق لا يُستبدَل باسم إشارة: «هاد» مذكّر، فـ«هاد دايماً
     * صغيرة؟» لحنٌ كالذي فررنا منه. */
    if (topic === null && (pos === 'صفة' || pos === 'فعل')) {
      return shami
        ? [`شو يعني ${word}؟`, `مين كمان ${word}؟`, `${word}؟ ليش؟`]
        : [`ما معنى ${word}؟`, `من أيضاً ${word}؟`, `${word}؟ لماذا؟`];
    }

    const on = topic ?? (shami ? 'هاد' : 'هذا');

    if (pos === 'فعل') {
      /* الفعل لا يُسأل عنه بـ«شو» ولا يدخل عليه «عن»: يُسأل عن فاعله وسببه. */
      return shami
        ? [`ليش ${on} ${word}؟`, `مين كمان ${word}؟`, `${on} دايماً ${word}؟`, `شو يعني ${word}؟`]
        : [`لماذا ${on} ${word}؟`, `من أيضاً ${word}؟`, `هل ${on} دائماً ${word}؟`, `ما معنى ${word}؟`];
    }

    if (pos === 'صفة') {
      /* والصفة كذلك، وأدقّ ما يُسأل به عنها امتحان مداها: «مين كمان صغير؟» */
      return shami
        ? [`شو يعني ${word}؟`, `مين كمان ${word}؟`, `${on} دايماً ${word}؟`, `ليش ${on} ${word}؟`]
        : [`ما معنى ${word}؟`, `من أيضاً ${word}؟`, `هل ${on} دائماً ${word}؟`, `لماذا ${on} ${word}؟`];
    }

    if (pos === 'مجهول') {
      /* ما لم تُبيّن العلامةُ قسمَه يُسأل عنه بما يصلح لكل قسم: «عن» و«كل»
       * و«شو» تفترض الاسمية، فلو حُشي فيها فعلٌ خفيّ خرج اللحن. */
      return shami
        ? [`شو يعني ${word}؟`, `${word} يعني شو؟`, `ليش قلت ${word}؟`]
        : [`ما معنى ${word}؟`, `${word} تعني ماذا؟`, `لماذا قلت ${word}؟`];
    }

    // اسمٌ مؤكَّد: هذا وحده ما يصحّ فيه «شو» و«عن» و«كل»
    return shami
      ? [`شو يعني ${word} بالزبط؟`, `${word} متل ${on}؟`, `وشو كمان عن ${word}؟`, `شو الفرق بين ${word} و${on}؟`]
      : [`ما معنى ${word} بالضبط؟`, `هل ${word} مثل ${on}؟`, `وماذا أيضاً عن ${word}؟`, `ما الفرق بين ${word} و${on}؟`];
  }

  /**
   * سؤالٌ عمّا يعرفه: امتحانُ قاعدةٍ بناها، أو طلبُ استزادة.
   *
   * وامتحان القاعدة أنفع ما يُسأل: «القطة حيوان… والكلب كمان حيوان؟» يمتحن به
   * حدّ الصنف، فيتعلّم من جواب أبيه ما لا يتعلّمه من مئة درس مفرد.
   */
  private aboutTopic(topic: string, req: SpeechRequest): readonly string[] {
    const shami = this.isShami;
    const akin = req.akin;

    if (akin) {
      const other = req.lexicon.asSaid(akin.subject);
      const category = req.lexicon.pretty(akin.object);
      return shami
        ? [`و${other} كمان ${category}؟`, `${topic} و${other} متل بعض؟`, `كل شي ${category} متل ${topic}؟`]
        : [`وهل ${other} أيضاً ${category}؟`, `هل ${topic} و${other} سواء؟`, `هل كل ${category} مثل ${topic}؟`];
    }

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
    const said = req.lexicon.asSaid(raw.subject);
    const object = req.lexicon.pretty(raw.object);

    /* «أنت علّمتني» لا تُقال إلا لما علّمه أبوه بنفسه.
     *
     * وهذا صدقٌ لا تدقيق لغوي: زبير يرث عربية محيطه، فلو نسب الموروث إلى أبيه
     * لأوهمه أنه علّمه ما لم يعلّمه — وأفسد المقياس الوحيد الذي يعرف به الأب أن
     * تعليمه ينفع. والمصدر مكتوب في الحقيقة نفسها. */
    const fromFather = raw.taughtBy.includes('أبوه');
    const options = fromFather
      ? [`${said} ${object}`, `${said} ${object}، أنت علّمتني`]
      : [`${said} ${object}`];

    return { text: this.pick(options, req.rng), kind: 'answer', about: raw.subject };
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
    /* ————— الإقرار بلسان الطلب لا بلسانٍ عام —————
     *
     * «وين الكنكارو؟ ← ما عندي معلومة عن هيك شي» جوابٌ صحيح يبدو تهرّباً،
     * لأنه لا يقول **ماذا** لا يعرف. والصواب أن يُقرّ بما سُئل عنه بعينه: «ما
     * بعرف وين». وهذه العبارة تأتي من صفّ الطلب في جدول الملكية لا من هنا —
     * فمن غيّر الجدول غيّر لسانه معه. */
    const named = req.request ? voidAnswer(req.request) : null;
    if (named && req.request && ASKS_KNOWLEDGE.has(req.request)) {
      return { text: named, kind: 'admission', about: null };
    }
    /* يُقرّ بحدّ معرفته ولا يستجدي: «ما بعرف، علّمني» عبارةُ طفل. */
    const options = this.isShami
      ? ['ما عندي معلومة عن هيك شي', 'هاد ما بعرفه، حكيلي عنه', 'ما وصلني شي عن هيك']
      : ['لا أملك معلومة عن هذا', 'هذا لا أعرفه، حدّثني عنه', 'لم يصلني شيء عن ذلك'];
    return { text: this.pick(options, req.rng), kind: 'admission', about: null };
  }

  /* ————— الإقرار بالتلقّي: وأحياناً يُعيد ما تعلّمه ليؤكّده ————— */
  private acknowledge(req: SpeechRequest): Speech {
    /* إقرارٌ لا استفهام: «صح؟» بعد كل درس تردّدُ طفل، وهي أظهر ما كان يجعل
     * كلامه صبيانياً. */
    const options = this.isShami
      ? ['فهمت', 'تمام، سجّلتها', 'واضح', 'أخذتها']
      : ['فهمت', 'حسناً، حفظتها', 'واضح', 'أخذت بها'];
    return { text: this.pick(options, req.rng), kind: 'acknowledge', about: req.fact?.subject ?? null };
  }

  /* ————— الاستيضاح: جوابُ الملتبس —————
   *
   * وهو غير الإقرار بالجهل: «ما بعرف» تقول لا أملك الجواب، وهذه تقول لم يتبيّن
   * لي السؤال. والخلط بينهما يجعل زبير يبدو جاهلاً حيث هو **غيرُ فاهم**، وهما
   * حالان يختلف علاجهما: الأولى تُعالَج بتعليمٍ والثانية بإعادة صياغة. */
  private clarify(req: SpeechRequest): Speech {
    const topic = req.topic ? req.lexicon.asSaid(req.topic) : null;
    const options = topic
      ? (this.isShami
        ? [`شو بدّك تعرف عن ${topic}؟`, `ما فهمت قصدك بـ${topic}، وضّحلي`]
        : [`ماذا تريد أن تعرف عن ${topic}؟`, `لم أفهم قصدك بـ${topic}، وضّح لي`])
      : (this.isShami
        ? ['ما فهمت عليك، شو قصدك؟', 'وضّحلي أكتر، شو بدّك تسأل؟']
        : ['لم أفهم قصدك، ماذا تعني؟', 'وضّح لي أكثر، عمّ تسأل؟']);
    return { text: this.pick(options, req.rng), kind: 'question', about: null };
  }

  /* ————— ردّ التحية ————— */
  private greet(req: SpeechRequest): Speech {
    const options = this.isShami
      ? ['أهلاً، كيفك؟', 'هلا، اشتقتلك', 'أهلاً فيك، شو أخبارك؟', `أهلاً، أنا ${req.selfName}`]
      : ['أهلاً، كيف حالك؟', 'مرحباً، اشتقت إليك', 'أهلاً بك، ما أخبارك؟', `مرحباً، أنا ${req.selfName}`];
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
