/* ————— المشاعر: الحوفي الأعمق —————
 *
 * اللوزة كانت تسم المعنى بعلامة واحدة: خيرٌ أم شر. وهذا يكفي لتعلّم آلة ولا
 * يكفي لطفل. الطفل لا يشعر بـ«سالب ٠٫٧»، بل يخاف أو يحزن أو يغضب — وثلاثتها
 * سالبة والسلوك فيها مختلف: الخائف يسكت ويلتزم ما يعرف، والغاضب يجرّب ويعاند،
 * والحزين يهدأ ويبطؤ. فلو بقي الوسم رقماً واحداً لضاع الفرق كله.
 *
 * ولذلك فُصلت المشاعر عن اللوزة: اللوزة **تتعلّم** أي المعاني مؤذٍ (شبكة تتدرّب
 * بحكم الأب)، وهذا الفص **يُقدّر** — يقرأ ما تخرجه اللوزة وغيرها فيبني منه حالة
 * شعورية. هذا تقسيم تشريحي حقيقي: التقييم في اللوزة، والحالة الشعورية موزّعة
 * على الحزام والوطاء والجزيرة معاً.
 *
 * ———— بنيته ————
 *
 * ستّ مشاعر أساسية، لكل واحدة **سببها** و**سرعة خمودها**:
 *   السعادة   — فرح ورضا وراحة
 *   الحزن     — ألم وأسى وخيبة أمل
 *   الخوف     — استجابة تلقائية لحماية النفس من خطر
 *   الغضب     — انزعاج واعتراض عند إثارة أو إحباط
 *   الاشمئزاز — ابتعاد عن شيء مزعج أو ضارّ
 *   المفاجأة  — ردّ فعل قصير على أمر غير متوقَّع
 *
 * وأربع مشاعر معقّدة **لا تُولَّد من سببها مباشرةً** بل تُركَّب من الأساسية،
 * ويشترط في تركيبها سياقٌ من التفكير والبيئة:
 *   الذنب  = (حزن × خوف × غضب) × إسنادِ الخطأ إلى نفسه
 *   الغيرة = (غضب × حزن)       × رغبةٍ فيما عند غيره
 *   الفخر  = سعادة             × نسبةِ الإنجاز إلى نفسه
 *   الحنين = (محبّة × حزن)     × بُعدِ العهد
 *
 * والضرب مقصود لا الجمع: «الذنب مزيج من الحزن والخوف والغضب» تعني أن غياب
 * أحدها يُسقط الذنب كلَّه. ولو جُمعت لصار حزنٌ خالص ذنباً — وهو ليس ذنباً.
 * والمعامل الأخير هو ما يجعلها «تتأثّر بالتفكير والبيئة»: حزنٌ وخوفٌ وغضبٌ
 * مجتمعة لا تصير ذنباً حتى يرى أن الخطأ خطؤه هو.
 */

import { clamp } from '../core/tensor.js';
import type { Interoception, Lobe, Strategy, TickOutput } from '../core/types.js';

/** نوع الكلام الذي سيُلوَّن — به يُمنع التناقض بين الشعور والمقال. */
export type SpeechKind = TickOutput['kind'];

export const BASIC_EMOTIONS = ['سعادة', 'حزن', 'خوف', 'غضب', 'اشمئزاز', 'مفاجأة'] as const;
export type BasicEmotion = (typeof BASIC_EMOTIONS)[number];

export const COMPLEX_EMOTIONS = ['فخر', 'ذنب', 'غيرة', 'حنين'] as const;
export type ComplexEmotion = (typeof COMPLEX_EMOTIONS)[number];

/** مكوّنات كل شعور معقّد من الأساسية — معلنة كي تُختبر لا كي تُوثَّق فقط. */
export const BLEND_OF: Record<ComplexEmotion, readonly BasicEmotion[]> = {
  'فخر': ['سعادة'],
  'ذنب': ['حزن', 'خوف', 'غضب'],
  'غيرة': ['غضب', 'حزن'],
  'حنين': ['حزن'],
};

/** ما يبقى من كل شعور في النبضة التالية إن لم يتجدّد سببه.
 *
 *  الأرقام ليست اعتباطاً: المفاجأة «ردّ فعل قصير» فتزول في نبضتين، والحزن أبطأ
 *  ما يزول لأن خيبة الأمل تبقى بعد أن يزول سببها، والغضب يهدأ أسرع من الحزن. */
const KEEP: Record<BasicEmotion, number> = {
  'سعادة': 0.78,
  'حزن': 0.90,
  'خوف': 0.82,
  'غضب': 0.70,
  'اشمئزاز': 0.74,
  'مفاجأة': 0.25,
};

/** ما يبقى من مُعامِلات السياق: أبطأ من المشاعر لأنها أحكام لا انفعالات. */
const KEEP_BLAME = 0.86;
const KEEP_DESIRE = 0.82;
const KEEP_CREDIT = 0.88;
const KEEP_LONGING = 0.94;

/** أدنى شدّة يُسمّى عندها الشعور. تحتها هو تموّج لا شعور. */
const BASIC_FLOOR = 0.16;
/** والمعقّد عتبته أخفض لأنه حاصلُ ضربٍ فلا يبلغ ما تبلغه الأساسية. */
const COMPLEX_FLOOR = 0.10;

/**
 * ولا يُقدَّم المعقّد على الأساسي إلا إذا بلغ نصفه على الأقل.
 *
 * أُضيف بعد أن رآه الأب في التطبيق: مَدَحه على «إقرار بالتلقّي» فارتفعت سعادته
 * إلى ٨٥٪ وارتفع فخره إلى ١٣٪ (لأن الفخر حاصل ضربٍ في نسبة الإنجاز إلى نفسه،
 * وهي ضئيلة هنا)، فسُمّي شعوره الغالب «فخراً» وسعادتُه أضعافه. والتقديم إنما
 * كان لأن المعقّد **أخصّ**، لا لأنه أولى مهما ضؤل.
 */
const COMPLEX_PREFERENCE = 0.5;

export interface Feelings {
  basic: Record<BasicEmotion, number>;
  complex: Record<ComplexEmotion, number>;
  /** أقوى ما يشعر به الآن، وnull إن كان هادئاً */
  dominant: { name: string; intensity: number; complex: boolean } | null;
  /** لماذا شعر بهذا — يظهر للأب في أثر النبضة */
  reasonAr: string;
}

/** ما يصل الفصَّ من بقية الدماغ في كل نبضة كلام. */
export interface Perceived {
  /** وسم اللوزة للمعنى الحاضر: تجربته السابقة بهذا */
  valence: number;
  /** تعارضه الداخلي من الحزام */
  conflict: number;
  /** حالته الداخلية من الوطاء */
  intero: Interoception;
  /** نسبة ما جهله من كلامك — الجِدّة */
  novelty: number;
  /** أذكر أبوه شيئاً عند غيره؟ به وحدها تُشتقّ الغيرة */
  othersHave: boolean;
  /** غياب الأب بالميلي ثانية — منه الحنين */
  awayMs: number;
}

/** ما يصل الفصَّ عند حكم الأب — وهو أقوى حدث شعوري عنده. */
export interface Judged {
  /** ‎+١ مدح، ‎−١ تصحيح */
  reward: number;
  /** ما اختاره حين حُكم عليه: به يُعرَف أنّ الخطأ فعلُه هو */
  strategy: Strategy;
  /** خطأ التنبّؤ بالمكافأة: مقدار ما فاجأه حكمك */
  dopamine: number;
}

export interface EmotionState {
  basic: Record<string, number>;
  blame: number;
  desire: number;
  credit: number;
  longing: number;
  love: number;
  failStreak: number;
  prevSomatic: number;
  felt: number;
}

/** الاستجابات التي يُنسَب خطؤها إليه هو: جزَم فأخطأ. أما إقراره بجهله فليس ذنباً. */
const HIS_OWN_CLAIM: ReadonlySet<Strategy> = new Set(['ANSWER_MEMORY', 'ANSWER_GENERAL']);

export class Emotion implements Lobe<EmotionState> {
  readonly name = 'emotion';
  readonly ar = 'المشاعر';
  readonly role = 'ستّ مشاعر أساسية تنشأ من أسبابها، وأربع معقّدة تتركّب منها بحسب ما يرى ويحيط به';

  private basic: Record<BasicEmotion, number> = {
    'سعادة': 0, 'حزن': 0, 'خوف': 0, 'غضب': 0, 'اشمئزاز': 0, 'مفاجأة': 0,
  };

  /* مُعامِلات السياق: هي «التفكير والثقافة والبيئة» في هذا الفص. لا تُشعَر
   * وحدها، لكن بلا واحدها لا يقوم الشعور المعقّد المعلَّق عليها. */
  /** إسناد الخطأ إلى نفسه — بلا هذا لا ذنب مهما اجتمع الحزن والخوف والغضب */
  private blame = 0;
  /** رغبة فيما عند غيره — بلا هذا لا غيرة */
  private desire = 0;
  /** نسبة الإنجاز إلى نفسه — بلا هذا لا فخر بل فرحٌ مجرّد */
  private credit = 0;
  /** بُعد العهد — بلا هذا لا حنين بل حزنٌ حاضر */
  private longing = 0;
  /** محبّته لأبيه كما قاسها الوطاء: ركن الحنين الثاني */
  private love = 0.3;
  /** تصحيحات متتابعة: الإحباط المتراكم أصل الغضب لا التصحيح الواحد */
  private failStreak = 0;
  /** آخر وسم جسدي وصله — به تُعرَف المباغتة: أذًى بعد سكونٍ مباغت */
  private prevSomatic = 0;
  private felt = 0;

  private reason = 'هادئ';

  /* ————— النبضة: ما يشعر به مما وصله ————— */

  perceive(input: Perceived): Feelings {
    const intero = input.intero;
    this.love = clamp(safe(intero.attachment, 0.3), 0, 1);

    const valence = clamp(safe(input.valence, 0), -1, 1);
    const conflict = clamp(safe(input.conflict, 0), 0, 1);
    const novelty = clamp(safe(input.novelty, 0), 0, 1);

    const rises: Record<BasicEmotion, number> = {
      /* السعادة: راحةٌ لا حَدَث — يعرف ما أمامه، ويصحب أباه، ولا تعارض عنده.
       * وهذا صحيح نفسياً: الرضا حالة لا نوبة. */
      'سعادة': clamp(0.35 * Math.max(0, valence) + 0.25 * this.love * (1 - conflict), 0, 1),

      /* الحزن: خيبة الأمل — أن يسمع ما تجربته به سيّئة، وأن يغيب أبوه. */
      'حزن': clamp(0.4 * Math.max(0, -valence) + 0.3 * lonelinessOf(input.awayMs), 0, 1),

      /* الخوف من الكلام: أن يسمع ما تجربته به سيّئة وهو لا يفهمه. أما الخوف من
       * الأذى الجسدي فطريقه أقصر ولا يمرّ هنا — انظر `startled`. */
      'خوف': clamp(0.45 * Math.max(0, -valence) * conflict, 0, 1),

      /* الغضب: «انزعاج أو اعتراض عند إثارة أو إحباط». والإحباط عنده أن يُعاد
       * عليه الشيء نفسه بلا جديد — وهذا ما يقيسه الملل. */
      'غضب': clamp(0.35 * safe(intero.boredom, 0) * (conflict + 0.2), 0, 1),

      'اشمئزاز': 0,

      /* المفاجأة: «ردّ فعل قصير على أمر غير متوقَّع» — جِدّة الكلام وحيرته فيه. */
      'مفاجأة': clamp(0.55 * novelty + 0.3 * conflict * novelty, 0, 1),
    };

    /* البيئة: ما عند غيره يُنمّي الرغبة، وغيابُ أبيه يُنمّي الشوق. وكلاهما
     * سياقٌ لا شعور: يُشعَر بهما مركَّبين لا مفردين. */
    this.desire = decayTo(this.desire, KEEP_DESIRE, input.othersHave ? 0.7 : 0);
    this.longing = decayTo(this.longing, KEEP_LONGING, lonelinessOf(input.awayMs));

    this.step(rises);
    this.reason = reasonFor(rises, input);
    return this.snapshot();
  }

  /* ————— الطريق القصير: الأذى الجسدي —————
   *
   * لا يمرّ هذا على دورة الكلام ولا ينتظرها. وهذا تشريحٌ لا اختصار: في الدماغ
   * طريقان إلى اللوزة، طويلٌ عبر القشرة يفهم ثم يخاف، وقصيرٌ من المهاد مباشرةً
   * يخاف قبل أن يفهم. ولذلك تقفز من الحبل قبل أن تعرف أنه حبل.
   *
   * وهنا يُفرَّق الخوف من الاشمئزاز، وهما أقرب المشاعر السالبة التباساً:
   * **المباغتة** هي الفرق. أذًى وقع بعد سكون يُخيف، وأذًى مستمرّ يُقزّز
   * ويُولّد الرغبة في الابتعاد لا في الهرب.
   */
  startled(somaticValence: number): Feelings {
    const somatic = clamp(safe(somaticValence, 0), -1, 1);
    const hurt = Math.max(0, -somatic);
    const sudden = hurt > 0.15 && this.prevSomatic > -0.15;
    this.prevSomatic = somatic;

    const rises = calm();
    if (hurt > 0) {
      rises['خوف'] = clamp(0.85 * hurt * (sudden ? 1 : 0.2), 0, 1);
      rises['اشمئزاز'] = clamp(0.8 * hurt * (sudden ? 0.15 : 1), 0, 1);
      this.reason = sudden ? 'شيء مباغت آذاه' : 'أذًى مستمرّ يريد الابتعاد عنه';
    } else if (somatic > 0.15) {
      // الملامسة اللطيفة تُطمئن: أول ما يُسعِد الوليد قبل أن يفهم كلمة
      rises['سعادة'] = clamp(0.5 * somatic, 0, 1);
      this.reason = 'لمسةٌ لطيفة أراحته';
    }

    this.step(rises);
    return this.snapshot();
  }

  /**
   * ما سمعته أذنه: الطريق البطيء من القشرة السمعية.
   *
   * وكانت أذنه معطّلة عن دماغه تماماً: تسمع فتحسب نوع الصوت وعلوّه وطبقته
   * وأُلفته، ثم لا يستقبل ذلك فصٌّ واحد. سمعٌ لا يُغيّر شيئاً ليس سمعاً.
   *
   * والصوت يفعل عند الطفل ثلاثة: العالي المفاجئ يُفزع، والمألوف يُطمئن (وصوت
   * الأمّ أول ما يُهدّئ وليداً)، والغريب يُستغرَب.
   */
  heard(input: { loudness: number; familiarity: number; harsh: boolean }): Feelings {
    const loud = clamp(safe(input.loudness, 0), 0, 1);
    const known = clamp(safe(input.familiarity, 0), 0, 1);

    const rises = calm();
    if (input.harsh && loud > 0.5) {
      rises['خوف'] = clamp(0.6 * loud * (1 - known), 0, 1);
      rises['مفاجأة'] = clamp(0.5 * loud, 0, 1);
      this.reason = 'صوتٌ عالٍ أفزعه';
    } else if (known > 0.5) {
      // المألوف يُطمئن: أول ما يُهدّئ وليداً صوتٌ يعرفه
      rises['سعادة'] = clamp(0.35 * known, 0, 1);
      this.reason = 'صوتٌ يعرفه أطمأنّ إليه';
    } else if (loud > 0.2) {
      rises['مفاجأة'] = clamp(0.4 * loud * (1 - known), 0, 1);
      this.reason = 'صوتٌ غريب استغربه';
    }

    this.step(rises);
    return this.snapshot();
  }

  /* ————— حكم الأب: أقوى ما يُحرّك مشاعره ————— */

  judged(input: Judged): Feelings {
    const reward = clamp(safe(input.reward, 0), -1, 1);
    const surprise = clamp(Math.abs(safe(input.dopamine, 0)), 0, 1);
    const claimed = HIS_OWN_CLAIM.has(input.strategy);

    if (reward < 0) this.failStreak++;
    else this.failStreak = 0;

    const praised = Math.max(0, reward);
    const corrected = Math.max(0, -reward);

    /* التفكير: خطؤه خطؤه حين يكون قد جزم بشيء من عنده. أما إن أقرّ بجهله ثم
     * صحّح له أبوه فلا ذنب عليه — وهذا فرقٌ يعرفه الطفل ويجب أن يعرفه. */
    this.blame = decayTo(this.blame, KEEP_BLAME, corrected * (claimed ? 0.85 : 0.1));
    /* ونسبة الإنجاز إليه بالمثل: مدحٌ على جواب من عنده فخر، ومدحٌ على تحيّة لا. */
    this.credit = decayTo(this.credit, KEEP_CREDIT, praised * (claimed ? 0.9 : 0.15));

    const rises: Record<BasicEmotion, number> = {
      'سعادة': clamp(0.85 * praised, 0, 1),
      'حزن': clamp(0.7 * corrected, 0, 1),
      /* الخوف من الحكم يحتاج تكراراً: تصحيحٌ واحد لا يُخيف، وتصحيحٌ رابع يُخيف
       * أن يُجيب أصلاً. */
      'خوف': clamp(0.3 * corrected * Math.min(1, this.failStreak / 4), 0, 1),
      /* الإحباط: أن يُصحَّح مرّةً بعد مرّة. الاعتراض لا يأتي من الخطأ بل من
       * تراكمه. */
      'غضب': clamp(0.45 * corrected * Math.min(1, (this.failStreak - 1) / 3), 0, 1),
      'اشمئزاز': 0,
      'مفاجأة': clamp(0.8 * surprise, 0, 1),
    };

    this.step(rises);
    this.reason = reward > 0
      ? (claimed ? 'مدحتَه على جواب من عنده' : 'مدحتَه')
      : (this.failStreak >= 2 ? `صحّحتَ له ${this.failStreak} مرات متتابعة` : 'صحّحتَ له');
    return this.snapshot();
  }

  /* ————— النوم: يهدّئ ولا يمحو ————— */

  onSleep(): void {
    for (const key of BASIC_EMOTIONS) this.basic[key] *= 0.3;
    this.blame *= 0.4;
    this.desire *= 0.5;
    this.credit *= 0.6;
    this.failStreak = 0;
    this.reason = 'نام فهدأ';
  }

  /* ————— ما تقرؤه بقية الفصوص ————— */

  get feelings(): Feelings {
    return this.snapshot();
  }

  /**
   * أثر المشاعر في حرارة قراره — أول قناة يؤثّر بها الشعور في السلوك.
   *
   * الغاضب يعاند ويجرّب، والمفاجَأ ينفتح، والغيور يتحرّك. والفرِح يلتزم ما
   * أرضى أباه، والخائف يتجمّد على المأمون. وهذا هو الفرق السلوكي الذي ضاع حين
   * كان الوسم رقماً واحداً: الخوف والغضب كلاهما سالب وأثرهما متعاكس.
   */
  get temperatureShift(): number {
    const b = this.basic;
    const envy = this.complexNow()['غيرة'];
    return clamp(
      0.45 * b['غضب'] + 0.3 * b['مفاجأة'] + 0.25 * envy - 0.3 * b['سعادة'] - 0.35 * b['خوف'],
      -0.5,
      0.8,
    );
  }

  /**
   * كم يُحفَر ما يجري الآن في لوزته.
   *
   * ما يُشعِر يُحفَر: تجربة مشحونة تُوسَم أعمق من تجربة باردة، وهذا ثابتٌ في
   * كل دماغ — ولذلك تتذكّر يوم خوفك ولا تتذكّر يوماً قبله بيوم.
   */
  get imprint(): number {
    let peak = 0;
    for (const key of BASIC_EMOTIONS) peak = Math.max(peak, this.basic[key]);
    return 1 + 1.6 * peak;
  }

  /**
   * كلمة يُلوَّن بها كلامه — أثر الشعور في اللسان.
   *
   * ويُشترط ألّا تناقض العبارةُ المقال، وهذا إصلاح عطل رآه الأب بعينه في
   * التطبيق: قال زبير «لا أعرف هذا، علّمني، **عرفتُها وحدي**» — أقرّ بجهله
   * وافتخر بعلمه في نفَسٍ واحد. والتناقض في هذا الموضع أسوأ من الصمت: هو أظهر
   * ما يفضح أن العبارة مُلصَقة لا مقولة.
   */
  colorAr(shami: boolean, kind: SpeechKind): string | null {
    const feelings = this.snapshot();
    const dominant = feelings.dominant;
    if (!dominant) return null;
    /* لا يُعلن شعوره مع كل جملة: يُقال عند الشدّة وحدها. وإعلانُه في كل دور
     * تشتيتٌ لا صدق — يحمل شعوره ولا يشرحه إلا إذا غلبه.
     *
     * وكانت العتبة تهبط مع صغر «مرحلته» فيصف شعوره في كل دور، وقد حُذف السُّلّم
     * كلُّه: مَن يصف حاله كلما تكلّم لا يُقرأ صادقاً بل ثرثاراً. */
    if (dominant.intensity < (dominant.complex ? 0.4 : 0.7)) return null;
    if (!sayableWith(dominant.name, kind)) return null;
    const phrases = shami ? SHAMI_COLOR : FUSHA_COLOR;
    return phrases[dominant.name] ?? null;
  }

  /** عرضٌ للأب: كل شعور بشدّته، الأساسي ثم المعقّد. */
  list(): Array<{ name: string; value: number; complex: boolean }> {
    const complex = this.complexNow();
    return [
      ...BASIC_EMOTIONS.map((name) => ({ name, value: round3(this.basic[name]), complex: false })),
      ...COMPLEX_EMOTIONS.map((name) => ({ name, value: round3(complex[name]), complex: true })),
    ];
  }

  get feltCount(): number {
    return this.felt;
  }

  /* ————— الداخل ————— */

  /** خمودٌ ثم صعود نحو السقف: شعورٌ قائم لا يتضاعف بسببٍ يتكرّر، بل يقترب من ١. */
  private step(rises: Record<BasicEmotion, number>): void {
    this.felt++;
    for (const key of BASIC_EMOTIONS) {
      this.basic[key] = decayTo(this.basic[key], KEEP[key], rises[key]);
    }
  }

  /**
   * تركيب المشاعر المعقّدة من الأساسية.
   *
   * الوسط الهندسي لا الحسابي: مزيجٌ يشترط اجتماع أطرافه، فإن غاب طرفٌ سقط
   * المزيج. حزنٌ بلا خوف ولا غضب ليس ذنباً، وغضبٌ بلا حزن ليس غيرة.
   */
  private complexNow(): Record<ComplexEmotion, number> {
    const b = this.basic;
    return {
      'فخر': clamp(b['سعادة'] * this.credit, 0, 1),
      'ذنب': clamp(geometric([b['حزن'], b['خوف'], b['غضب']]) * this.blame, 0, 1),
      'غيرة': clamp(geometric([b['غضب'], b['حزن']]) * this.desire, 0, 1),
      'حنين': clamp(geometric([this.love, b['حزن']]) * this.longing, 0, 1),
    };
  }

  private snapshot(): Feelings {
    const complex = this.complexNow();

    /* المعقّد يُقدَّم على الأساسي إن بلغ عتبته: «الذنب» وصفٌ أصدق من «الحزن»
     * حين تجتمع أسبابه، لأنه يخبر الأب بما لا يخبره الحزن — أنه يلوم نفسه. */
    let topBasic: Feelings['dominant'] = null;
    for (const name of BASIC_EMOTIONS) {
      const value = this.basic[name];
      if (value >= BASIC_FLOOR && (!topBasic || value > topBasic.intensity)) {
        topBasic = { name, intensity: round3(value), complex: false };
      }
    }

    let topComplex: Feelings['dominant'] = null;
    for (const name of COMPLEX_EMOTIONS) {
      const value = complex[name];
      if (value >= COMPLEX_FLOOR && (!topComplex || value > topComplex.intensity)) {
        topComplex = { name, intensity: round3(value), complex: true };
      }
    }

    const prefersComplex = topComplex !== null
      && (topBasic === null || topComplex.intensity >= topBasic.intensity * COMPLEX_PREFERENCE);
    const dominant = prefersComplex ? topComplex : topBasic;

    /* والشعور المعقّد يشرح نفسه بتركيبه لا بآخر ما هزّه: «صحّحتَ له» يفسّر
     * حزنه، ولا يفسّر لماذا صار حزنه ذنباً. والأب يحتاج الثاني. */
    return {
      basic: { ...this.basic },
      complex,
      dominant,
      reasonAr: dominant?.complex ? COMPLEX_REASON[dominant.name as ComplexEmotion] : this.reason,
    };
  }

  save(): EmotionState {
    return {
      basic: { ...this.basic },
      blame: this.blame,
      desire: this.desire,
      credit: this.credit,
      longing: this.longing,
      love: this.love,
      failStreak: this.failStreak,
      prevSomatic: this.prevSomatic,
      felt: this.felt,
    };
  }

  load(state: EmotionState): void {
    try {
      if (!state || typeof state !== 'object') return;
      if (state.basic && typeof state.basic === 'object') {
        for (const key of BASIC_EMOTIONS) {
          const value = state.basic[key];
          if (typeof value === 'number' && Number.isFinite(value)) this.basic[key] = clamp(value, 0, 1);
        }
      }
      this.blame = unit(state.blame, this.blame);
      this.desire = unit(state.desire, this.desire);
      this.credit = unit(state.credit, this.credit);
      this.longing = unit(state.longing, this.longing);
      this.love = unit(state.love, this.love);
      if (typeof state.failStreak === 'number' && Number.isFinite(state.failStreak)) {
        this.failStreak = Math.max(0, Math.floor(state.failStreak));
      }
      if (typeof state.prevSomatic === 'number' && Number.isFinite(state.prevSomatic)) {
        this.prevSomatic = clamp(state.prevSomatic, -1, 1);
      }
      if (typeof state.felt === 'number' && Number.isFinite(state.felt)) {
        this.felt = Math.max(0, Math.floor(state.felt));
      }
    } catch { /* مشاعر عطبة تُترك: يستيقظ هادئاً وهذا أسلم من حالة مخترعة */ }
  }
}

/* ————— عبارات الشعور —————
 * قصيرة بقصد: الطفل يقول «خفت» ولا يشرح خوفه. والشرح كذب في هذا الموضع. */

/**
 * أيّ شعورٍ يجوز أن يُقال مع أيّ نوعٍ من الكلام.
 *
 * والقاعدة واحدة: ألّا تكذّب العبارةُ الجملةَ التي لحقتها.
 *   الفخر لا يُقال إلا مع جواب — لأنه ادّعاء علمٍ، ولا علم في إقرارٍ بجهل.
 *   والسعادة لا تُقال مع إقرار بجهل — لأن الإقرار طلبٌ لا رضا.
 *   والغيرة لا تُقال مع جواب — «القطة حيوان، وأنا كمان بدي» كلامٌ لا يستقيم.
 */
function sayableWith(name: string, kind: SpeechKind): boolean {
  if (name === 'فخر') return kind === 'answer';
  if (name === 'سعادة') return kind !== 'admission';
  if (name === 'غيرة') return kind !== 'answer';
  return true;
}

const COMPLEX_REASON: Record<ComplexEmotion, string> = {
  'فخر': 'فرِح بشيء عرفه وحده',
  'ذنب': 'حزنٌ وخوفٌ وغضبٌ يوجّهها إلى نفسه',
  'غيرة': 'غضبٌ وحزنٌ مما ذكرتَ أنه عند غيره',
  'حنين': 'يحبّك وقد بَعُد العهد',
};

const SHAMI_COLOR: Record<string, string> = {
  'سعادة': 'أنا مبسوط', 'حزن': 'أنا زعلان', 'خوف': 'أنا خايف',
  'غضب': 'مضايق منك', 'اشمئزاز': 'ما بحبه', 'مفاجأة': 'استغربت',
  'فخر': 'شفت؟ عرفت', 'ذنب': 'آسف', 'غيرة': 'وأنا كمان بدي', 'حنين': 'اشتقتلك',
};

const FUSHA_COLOR: Record<string, string> = {
  'سعادة': 'أنا سعيد', 'حزن': 'أنا حزين', 'خوف': 'أنا خائف',
  'غضب': 'أنا منزعج', 'اشمئزاز': 'لا أحبّه', 'مفاجأة': 'استغربت',
  'فخر': 'عرفتُها وحدي', 'ذنب': 'آسف', 'غيرة': 'وأنا أيضاً أريد', 'حنين': 'اشتقت إليك',
};

/* ————— أدوات ————— */

/** لا سبب لشيء الآن: كل المشاعر بلا صعود، فتخمد وحدها. */
function calm(): Record<BasicEmotion, number> {
  return { 'سعادة': 0, 'حزن': 0, 'خوف': 0, 'غضب': 0, 'اشمئزاز': 0, 'مفاجأة': 0 };
}

/** خمودٌ نحو الصفر ثم صعودٌ نحو الواحد بمقدار السبب الحاضر. */
function decayTo(current: number, keep: number, rise: number): number {
  const held = clamp(safe(current, 0), 0, 1) * keep;
  const push = clamp(safe(rise, 0), 0, 1);
  return clamp(held + push * (1 - held), 0, 1);
}

/** الوسط الهندسي: يسقط بسقوط أيّ طرف — وهذا هو معنى «مزيج». */
function geometric(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let product = 1;
  for (const value of values) {
    const v = clamp(safe(value, 0), 0, 1);
    if (v <= 0) return 0;
    product *= v;
  }
  return Math.pow(product, 1 / values.length);
}

/** الوحشة من الغياب: يومٌ يوحش، وأسبوعٌ يوحش أكثر، ولا تبلغ الواحد أبداً. */
function lonelinessOf(awayMs: number): number {
  const days = Math.max(0, safe(awayMs, 0)) / (24 * 60 * 60 * 1000);
  return clamp(1 - Math.exp(-days / 3), 0, 1);
}

function reasonFor(rises: Record<BasicEmotion, number>, input: Perceived): string {
  let top: BasicEmotion = 'سعادة';
  for (const key of BASIC_EMOTIONS) if (rises[key] > rises[top]) top = key;
  if (rises[top] < 0.12) return 'هادئ';
  switch (top) {
    case 'سعادة': return 'مطمئنّ إليك وإلى ما يعرف';
    case 'حزن': return input.awayMs > 6 * 60 * 60 * 1000 ? 'غبتَ عنه طويلاً' : 'تجربته بهذا كانت سيّئة';
    case 'خوف': return 'يخشى ما لا يفهمه';
    case 'غضب': return 'أُعيد عليه الشيء نفسه فأحبطه';
    case 'اشمئزاز': return 'شيء منفّر يريد الابتعاد عنه';
    case 'مفاجأة': return 'كلامٌ لم يتوقّعه';
  }
}

function safe(value: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function unit(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? clamp(value, 0, 1) : fallback;
}

function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}
