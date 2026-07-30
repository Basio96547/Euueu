/* ————— جذع الدماغ: النبضة واليقظة والغريزة —————
 *
 * أقدم ما في الدماغ وأبسطه، وهو أول من يستلم كلامك. لا يفهم شيئاً — لا يعرف
 * معنى «القطة» ولا يميّز حقيقةً من سؤال — لكنه يعرف شيئين لا تقوم القشرة بلا
 * أحدهما:
 *
 * ١. الحياة: نبضة الساعة الداخلية، وكم غبتَ عنه، وكم بقي فيه من يقظة.
 * ٢. الغريزة: تخمين سطحي لِما تريده منه، مبنيّ على شكل كلامك وحده.
 *
 * والغريزة هنا ليست ذكاءً وليست شبكة عصبية بحال: هي جدول أنماط مكتوب بالحرف،
 * كما يولد الطفل عارفاً أن نبرة المدح مدح قبل أن يفهم كلمة واحدة. وظيفتها أن
 * تُعطي القشرة درساً تتعلّم منه في أسابيعها الأولى، ثم تتجاوزها القشرة بتعليم
 * الأب — والتجاوز هو الغاية لا العيب. لذلك يجب أن يبقى هذا الملف سطحياً: كل
 * ذكاء يُدسّ فيه يسرق من الفص الصدغي فرصةَ أن يتعلّم.
 */

import { QUESTION_WORDS, type Percept } from '../core/text.js';
import { clamp } from '../core/tensor.js';
import type { Intent, Lobe } from '../core/types.js';

/* ————— جدول الغريزة —————
 *
 * هذا الجدول هو المكان الوحيد الذي يزيد فيه الأب نمطاً جديداً: كل شيء تحته
 * يقرأ منه ولا يعرف كلمةً بنفسه. الكلمات تُكتب **بصورتها المطبَّعة** كما
 * يُخرجها `tokenize` (الهمزات ألفاً، والتاء المربوطة هاءً، والألف المقصورة
 * ياءً، بلا تشكيل): «أحسنت» تُكتب «احسنت» و«تُسمّى» تُكتب «تسمي»، وإلا لم
 * تُطابق أبداً.
 */

export interface ReflexRule {
  intent: Intent;
  /** يكفي حضور واحدة من هذه الكلمات في أي موضع من الجملة */
  words: readonly string[];
  /** عبارات: رموز متتالية بهذا الترتيب — «مو هيك» ليست «مو» ولا «هيك» */
  phrases: readonly (readonly string[])[];
  /** قوة النمط عند تطابق كلمة مفتاحية صريحة */
  strength: number;
  /**
   * رابط بنيوي لا كلمة مفتاحية: يُطابَق فقط إن جاء **وسط** الجملة (قبله كلمة
   * وبعده كلمة)، لأن «س هو ص» تعليمُ حقيقة أما «هو جميل» فكلام عادي.
   */
  copulas?: readonly string[];
  /** كلمات ترفع القوة قليلاً إن حضرت مع الكلمة المفتاحية (قرينة تؤكّد النمط) */
  boosters?: readonly string[];
  /** نمط السؤال وحده يقرأ إشارة المُدرِك `isQuestion` لا الكلمات فقط */
  fromQuestionMark?: true;
}

/** تطابق صريح لا لبس فيه: كلمة لا تُقال إلا في هذا المعنى. */
const EXPLICIT = 0.9;
/** تسمية: صريحة لكنها تحتمل السؤال عنها («ما اسمك») فتُخفَض قليلاً. */
const NAMING = 0.85;
/** سؤال بعلامة استفهام: العلامة قاطعة. */
const MARKED_QUESTION = 0.9;
/** سؤال بأداة بلا علامة: مرجَّح لا قاطع، فـ«ما» تكون نفياً في الشامية. */
const TOOL_QUESTION = 0.72;
/**
 * استنتاج بنيوي من موضع الرابط لا من كلمة مفتاحية. قوة أوسط بقصد: البنية
 * تخطئ («هو» قد تكون توكيداً)، وهي مع ذلك فوق عتبة تمهيد القشرة كي يتعلّم
 * زبير أن «س هو ص» تعليمٌ قبل أن يُصحّحه أبوه.
 */
const STRUCTURAL = 0.6;
/** ما تضيفه القرينة المؤكِّدة («هذه» مع «تسمّى»). */
const BOOST = 0.08;
/** كلام عادي: قوة منخفضة بقصد كي لا تُدرَّب القشرة على «لا شيء». */
const CHITCHAT_STRENGTH = 0.2;
/** جملة كل كلماتها مجهولة: جهل صريح أقوى من كلام عادي — منه يسأل. */
const UNKNOWN_STRENGTH = 0.35;

/** قوّة الجملة الاسمية العارية: «القطة حيوان» بلا رابط ولا استفهام.
 *  أدنى من الرابط الصريح (٠٫٦٥) لأنها قد تكون كلاماً عادياً، وأعلى من الجهل
 *  (٠٫٣٥) لأن بنيتها بنية تعليم. */
const NOMINAL_STRENGTH = 0.55;

/**
 * الترتيب جزء من المعنى لا تفصيل تنفيذي، وهذه أمثلته التي تُوجب هذا الترتيب:
 *
 * • التصحيح قبل المدح: «لا، أحسنت في الأولى» تصحيحٌ فيه كلمة مدح، ولو قُدّم
 *   المدح لسمع زبير ثناءً حيث وُبِّخ فعزّز الخطأ الذي أخطأه.
 * • المدح قبل السؤال: «صح؟» يقرؤها مدحاً — والأب يستطيع تبديل السطرين إن أراد.
 * • السؤال قبل التسمية: «ما اسمك؟» سؤالٌ لا تعليمُ اسم، وهذا أخطر التباس في
 *   الجدول: لو قُدِّمت التسمية لصار زبير يسمّي نفسه بكلمة السؤال.
 * • التحية آخر الجدول: «مرحبا اسمك زبير» درسٌ فيه تحية، والدرس أغلى من التحية.
 */
export const REFLEX_RULES: readonly ReflexRule[] = [
  {
    intent: 'CORRECT',
    words: ['لا', 'كلا', 'خطا', 'الخطا', 'غلط', 'الصحيح', 'الصح', 'ليس', 'خاطي'],
    phrases: [['مو', 'هيك'], ['مش', 'هيك'], ['مو', 'صح'], ['مش', 'صحيح'], ['ما', 'هيك']],
    strength: EXPLICIT,
  },
  {
    intent: 'PRAISE',
    words: ['احسنت', 'صح', 'تمام', 'ممتاز', 'برافو', 'عفارم', 'صحيح', 'مضبوط', 'شاطر', 'عظيم', 'رائع'],
    phrases: [['يسلمو', 'ايديك']],
    strength: EXPLICIT,
  },
  {
    /* الأدوات تُقرأ من `core/text.ts` لا تُكتب هنا: قائمة واحدة يعرفها المُدرِك
     * وجذع الدماغ وبروكا، فلو زاد الأب أداةً زادت في الثلاثة معاً. */
    intent: 'ASK',
    words: QUESTION_WORDS,
    phrases: [],
    strength: MARKED_QUESTION,
    fromQuestionMark: true,
  },
  {
    intent: 'TEACH_NAME',
    words: ['اسمك', 'اسمي', 'سميتك', 'سميناك'],
    phrases: [['انا', 'اسمي'], ['انت', 'اسمك']],
    strength: NAMING,
  },
  {
    intent: 'TEACH_WORD',
    words: ['تسمي', 'يسمي', 'اسمها', 'اسمه', 'نسميها', 'نسميه', 'بنسميها', 'منسميها'],
    phrases: [],
    strength: 0.8,
    boosters: ['هذه', 'هذا', 'هدا', 'هاد', 'هادا', 'هادي', 'هيدا', 'هيده', 'هاي'],
  },
  {
    /* لا كلمات: هذا النمط بنيةٌ لا معجم. «القطة هي حيوان» تعليم، و«هي حيوان»
     * جواب ناقص لا تعليم — والفرق كله في موضع الرابط. */
    intent: 'TEACH_FACT',
    words: [],
    phrases: [],
    strength: STRUCTURAL,
    copulas: ['هو', 'هي', 'هوي', 'هيي', 'يعني', 'بيعني', 'هما', 'هم'],
  },
  {
    intent: 'GREET',
    words: ['مرحبا', 'مرحبتين', 'السلام', 'سلام', 'هلا', 'اهلين', 'اهلا', 'صباح', 'مساء'],
    phrases: [['يا', 'هلا'], ['كيفك', 'يا']],
    strength: NAMING,
  },
];

/* ————— اليقظة —————
 *
 * اليقظة ليست رقماً تجميلياً: المهاد يُدخلها في قرار الانتباه، والوطاء يبني
 * عليها التعب. لذلك حدودها مقيَّدة بحزم.
 */

const AROUSAL_MAX = 1;
/**
 * لا تهبط اليقظة تحت الخُمس أبداً. السبب وظيفي لا رفقٌ به: يقظة صفر تُصفّر
 * مدخلاً كاملاً في بوابة المهاد فتتجمّد أوزانها، فيصير طفلٌ أطلتَ الجلوس معه
 * عاجزاً عن التعلّم إلى الأبد. الطفل يَمَلّ ولا يُطفَأ.
 */
const AROUSAL_MIN = 0.2;

/** ما تستهلكه النبضة الأولى من جلسة مرتاحة. */
const DRAIN_PER_TICK = 0.02;
/**
 * تسارع التعب: النبضة العشرون في الجلسة تُتعب أكثر من الأولى، كما يَمَلّ الطفل
 * في آخر الدرس لا في أوله. بهذا المعامل تبلغ اليقظة قاعها بعد نحو خمس وعشرين
 * نبضة متّصلة — طول درسٍ معقول لا طول محادثة عابرة.
 */
const SESSION_FATIGUE = 20;

/** غياب أقصر من هذا ليس راحة بل صمت أثناء الكلام، فلا يُحسب استراحة. */
const REST_MIN_MS = 5 * 60_000;
/** غياب بهذا الطول يعيد اليقظة إلى أقصاها؛ وما دونه يعيدها بنسبته. */
const REST_FULL_MS = 45 * 60_000;

export interface BrainstemState {
  ticks: number;
  arousal: number;
  /** لحظة آخر لقاء بالميلي ثانية — منها يُحسب الغياب بعد إغلاق التطبيق */
  lastAt: number;
  /** كم نبضة متّصلة في الجلسة الحالية */
  session: number;
}

/** هل في الجملة كلمة من هذه القائمة (تطابق كامل لا احتواء). */
function hasWord(tokens: readonly string[], words: readonly string[]): boolean {
  for (const token of tokens) if (words.includes(token)) return true;
  return false;
}

/** هل ترد هذه الرموز متتالية بهذا الترتيب. */
function hasPhrase(tokens: readonly string[], phrase: readonly string[]): boolean {
  if (phrase.length === 0 || phrase.length > tokens.length) return false;
  for (let start = 0; start + phrase.length <= tokens.length; start++) {
    let match = true;
    for (let i = 0; i < phrase.length; i++) {
      if (tokens[start + i] !== phrase[i]) {
        match = false;
        break;
      }
    }
    if (match) return true;
  }
  return false;
}

/** رابط وسط الجملة: قبله كلمة وبعده كلمة على الأقل. */
function hasMiddleCopula(tokens: readonly string[], copulas: readonly string[]): boolean {
  for (let i = 1; i + 1 < tokens.length; i++) {
    if (copulas.includes(tokens[i]!)) return true;
  }
  return false;
}

export class Brainstem implements Lobe<BrainstemState> {
  readonly name = 'brainstem';
  readonly ar = 'جذع الدماغ';
  readonly role = 'ينبض ويحسب يقظته وغيابك، ويخمّن غريزياً ما تريده منه قبل أن تتعلّم قشرته';

  private ticks = 0;
  private arousal = AROUSAL_MAX;
  private lastAt = 0;
  private session = 0;

  /**
   * نبضة واحدة: يُقدّم الساعة، ويقيس غيابك، ويحدّث اليقظة.
   *
   * `awayMs` صفر في أول نبضة من عمره: لا لقاء سابق يُقاس منه، ولو حسبناها من
   * الصفر المطلق لصار وليداً بعمر خمسين سنة من الغياب.
   */
  tick(at: number): { ticks: number; arousal: number; awayMs: number } {
    // لحظة غير منتهية (ساعة جهاز عطبة) تُترك كآخر لحظة معروفة: أهون من أن يسري NaN
    const now = Number.isFinite(at) ? at : this.lastAt;
    const awayMs = this.lastAt === 0 ? 0 : Math.max(0, now - this.lastAt);
    this.ticks++;
    this.lastAt = now;

    if (awayMs >= REST_MIN_MS) {
      // الاستعادة نسبةٌ من الفارق الباقي لا مقدارٌ ثابت: تقترب من الأقصى ولا
      // تتجاوزه، فلا حاجة لقصٍّ بعدها
      const restored = clamp(awayMs / REST_FULL_MS, 0, 1);
      this.arousal += restored * (AROUSAL_MAX - this.arousal);
      this.session = 0; // غياب طويل يفتح جلسةً جديدة فيبدأ التعب من أوله
    }

    this.session++;
    const drain = DRAIN_PER_TICK * (1 + this.session / SESSION_FATIGUE);
    this.arousal = clamp(this.arousal - drain, AROUSAL_MIN, AROUSAL_MAX);

    return { ticks: this.ticks, arousal: this.arousal, awayMs };
  }

  /**
   * الغريزة: أول تخمين لما تريده، من شكل كلامك لا من معناه.
   *
   * `strength` هو صدق النمط لا صحّة القصد: كلمة مفتاحية صريحة تُعطي قوة عالية،
   * واستنتاج من بنية الجملة يُعطي قوة أوسط، والكلام العادي قوةً منخفضة. الفص
   * الصدغي يضرب هذه القوة في الفطرة قبل خلطها بما تعلّمه، فقوة ضعيفة تعني
   * «خمّنتُ ولا أثق»، ولا يُمهَّد بها التعلّم.
   */
  reflexIntent(percept: Percept): { intent: Intent; strength: number } {
    const tokens: readonly string[] = Array.isArray(percept.tokens) ? percept.tokens : [];
    // صمت: ضغطة مسافة ليست كلاماً، ولا يجوز أن تُدرَّب القشرة على أي قصد منها
    if (tokens.length === 0) return { intent: 'UNKNOWN', strength: 0 };

    for (const rule of REFLEX_RULES) {
      if (rule.fromQuestionMark === true) {
        // علامة الاستفهام قاطعة، والأداة وحدها مرجَّحة. `isQuestion` يجمعهما
        // فنفرّق بينهما بالنظر إلى العلامة في نصّك كما كتبته
        if (percept.isQuestion === true) {
          const marked = percept.raw.includes('؟') || percept.raw.includes('?');
          return { intent: rule.intent, strength: marked ? rule.strength : TOOL_QUESTION };
        }
        /* لا استدراك على المُدرِك هنا، وهذا موضع أُصلح بعد قياس.
         *
         * كان الجذع يُعيد الحكم بأداة ملتبسة («ما» و«من» و«كم») في أي موضع، فصار
         * «خرجت من البيت» سؤالاً — وهو أخطر خطأ ممكن في هذا الفص: يجيب زبير حيث
         * يجب أن يتعلّم. والمُدرِك هو من يملك قاعدة الموضع (الملتبسة لا تُقبل إلا
         * رمزاً أوّل)، فإن قال «ليست سؤالاً» فقد فحص الأدوات كلها والعلامة معاً.
         * حكمٌ بعد حكمه نقضٌ له لا تدقيقٌ فيه. */
        continue;
      }

      let matched = hasWord(tokens, rule.words);
      if (!matched) {
        for (const phrase of rule.phrases) {
          if (hasPhrase(tokens, phrase)) {
            matched = true;
            break;
          }
        }
      }
      if (matched) {
        const confirmed = rule.boosters !== undefined && hasWord(tokens, rule.boosters);
        const strength = clamp(confirmed ? rule.strength + BOOST : rule.strength, 0, 1);
        return { intent: rule.intent, strength };
      }

      if (rule.copulas !== undefined && hasMiddleCopula(tokens, rule.copulas)) {
        return { intent: rule.intent, strength: rule.strength };
      }
    }

    // لا نمط. والفرق بين «كلام لم أفهم منه شيئاً» و«كلام عادي» هو أن الأول كله
    // كلمات لم يسمعها قط: ذاك جهل يُسأل عنه، وهذا حديث يُجاب عنه
    /* الجملة الاسمية العارية تُفحَص قبل الحكم بالجهل، وهذا موضع دقيق:
     * أول درس يعطيه أب لابنه («القطة حيوان») كلتا كلمتيه مجهولتان بالضرورة —
     * لم يسمعهما قط. فلو حُكم عليها بالجهل لأنها مجهولة لاستحال أن يتعلّم من
     * الدرس الأول أبداً، ولبقي ينتظر درساً يعرف كلماته مسبقاً. والطفل يتعلّم
     * الكلمتين والعلاقة بينهما في اللحظة نفسها: البنية تُعرَف ولو جُهل المعنى. */
    if (tokens.length === 2 && percept.isQuestion !== true) {
      return { intent: 'TEACH_FACT', strength: NOMINAL_STRENGTH };
    }

    const unknown = Array.isArray(percept.unknown) ? percept.unknown.length : tokens.length;
    if (unknown >= tokens.length) return { intent: 'UNKNOWN', strength: UNKNOWN_STRENGTH };
    return { intent: 'CHITCHAT', strength: CHITCHAT_STRENGTH };
  }

  /** النوم يعيد اليقظة كاملة ويُغلق الجلسة — وهذا كل ما يفعله الجذع في النوم. */
  onSleep(): void {
    this.arousal = AROUSAL_MAX;
    this.session = 0;
  }

  save(): BrainstemState {
    return { ticks: this.ticks, arousal: this.arousal, lastAt: this.lastAt, session: this.session };
  }

  /**
   * استعادة الحياة. لا استثناء يُرمى هنا بحال: هذه الحالة تُقرأ من ملف على جهاز
   * الأب وقد يكون أي شيء، ورميُ استثناء يعني أن زبير لا يُقلَع أصلاً.
   */
  load(state: BrainstemState): void {
    const candidate: unknown = state;
    if (candidate === null || typeof candidate !== 'object') return;
    const raw = candidate as Partial<Record<keyof BrainstemState, unknown>>;

    const ticks = raw.ticks;
    if (typeof ticks === 'number' && Number.isFinite(ticks) && ticks >= 0) {
      this.ticks = Math.floor(ticks);
    }

    const arousal = raw.arousal;
    // القصّ لا الرفض: يقظة محفوظة بنسخة أقدم قد تكون بحدود أخرى، وقيمة معقولة
    // أفضل من إعادة الولادة نشيطاً كل مرة
    if (typeof arousal === 'number' && Number.isFinite(arousal)) {
      this.arousal = clamp(arousal, AROUSAL_MIN, AROUSAL_MAX);
    }

    const lastAt = raw.lastAt;
    if (typeof lastAt === 'number' && Number.isFinite(lastAt) && lastAt >= 0) {
      this.lastAt = lastAt;
    }

    const session = raw.session;
    if (typeof session === 'number' && Number.isFinite(session) && session >= 0) {
      this.session = Math.floor(session);
    }
  }
}
