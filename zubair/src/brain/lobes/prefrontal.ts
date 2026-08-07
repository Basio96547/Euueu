/* ————— الفص الجبهي والمخيخ —————
 *
 * الجبهي هو الكبح: أحدث ما نما في الدماغ وآخر ما يكتمل في الإنسان، ووظيفته
 * ليست أن يفعل بل أن **يمنع**. طفل بلا فص جبهي يعيد السؤال نفسه عشر مرات
 * ويُجيب عن سؤال لم يُسأل. وهنا يمنع زبير من ذلك، ويحمل الحوار في رأسه.
 *
 * والمخيخ هو الإتقان: لا يقرّر ما يُقال بل كيف يُقال، ويتعلّم من تصحيح أبيه
 * ألّا يعيد نفس الخطأ في الصياغة.
 */

import { clamp, type Vec } from '../core/tensor.js';
import type { Understanding } from './temporal.js';
import { DIMS, type Intent, type Interoception, type Lobe, type Strategy } from '../core/types.js';

export interface Turn {
  said: string;
  replied: string;
  meaning: Vec;
  tick: number;
  strategy?: Strategy;
}

export interface PrefrontalState {
  turns: Array<{ said: string; replied: string; tick: number; strategy?: Strategy }>;
}

export type Goal = 'LEARN' | 'ANSWER' | 'BOND' | 'REST';

/**
 * ما يوافق كل هدف من الاستجابات.
 *
 * وكان الهدف يُحسَب في كل نبضة ثم **يُعرَض في أثر النبضة ولا يفعل شيئاً**:
 * فصٌّ يقول «هدفي أن أتعلّم» ثم لا يُغيّر قراره ليس له هدف بل عبارة.
 *
 * وهو **ترجيحٌ لا كبح**، ولذلك لا يُطبَّق هنا بل يُسلَّم إلى العُقد القاعدية
 * ميلاً يُضاف إلى قيمها المتعلَّمة. والفرق جوهري: الكبح يمنع، والميل يُرجّح ثم
 * تغلبه التجربة إن كذّبته — فلو مُنع الجوابُ على مَن هدفه التعلّم لصار لا يجيب
 * سؤالاً وهو يعرف.
 */
export const GOAL_FITS: Record<Goal, ReadonlySet<Strategy>> = {
  LEARN: new Set<Strategy>(['ASK_QUESTION', 'ADMIT', 'ACKNOWLEDGE']),
  ANSWER: new Set<Strategy>(['ANSWER_MEMORY', 'ANSWER_GENERAL', 'ADMIT']),
  BOND: new Set<Strategy>(['GREET_BACK', 'ACKNOWLEDGE', 'ANSWER_MEMORY']),
  REST: new Set<Strategy>(['ACKNOWLEDGE', 'GREET_BACK']),
};

/** أدنى شبهٍ يجوز أن يُخمَّن عليه. أعلى من عتبة الجُداري بكثير: التخمين على
 *  شبه الحروف منبع الهلوسة الأول، فيُشدَّد عليه في الكلام لا في الاستنتاج. */
const STRONG_LIKENESS = 0.55;

export class Prefrontal implements Lobe<PrefrontalState> {
  readonly name = 'prefrontal';
  readonly ar = 'الفص الجبهي';
  readonly role = 'يحمل الحوار في رأسه ويكبح نفسه: لا يعيد سؤالاً سأله، ولا يجزم بما لا يعرف';

  private turns: Turn[] = [];

  push(turn: Turn): void {
    this.turns.push(turn);
    // ذاكرة عاملة لا ذاكرة دائمة: الحفظ الطويل شأن الحُصين، وهذه سعتها محدودة
    // بقصد لأن حمل الحوار كله في الرأس ليس ذاكرة عاملة بل أرشيفاً
    if (this.turns.length > DIMS.workingMemory) this.turns = this.turns.slice(-DIMS.workingMemory);
  }

  get recent(): readonly Turn[] {
    return this.turns;
  }

  get recentStrategies(): readonly Strategy[] {
    const out: Strategy[] = [];
    for (const turn of this.turns) if (turn.strategy) out.push(turn.strategy);
    return out;
  }

  /** الهدف الآن. الترتيب أولوية: الراحة أولاً لأن دماغاً متعباً لا يتعلّم. */
  goal(intero: Interoception, u: Understanding): Goal {
    if (safe(intero.fatigue) > 0.85) return 'REST';
    if (u.intent === 'TEACH_FACT' || u.intent === 'TEACH_WORD' || u.intent === 'TEACH_NAME') return 'LEARN';
    if (safe(intero.curiosity) > 0.7) return 'LEARN';
    if (safe(intero.attachment) < 0.3) return 'BOND';
    return 'ANSWER';
  }

  /**
   * الكبح: ما لا يصلح الآن يُمنع.
   *
   * لا يعيد قائمة فارغة أبداً — دماغ بلا استجابة مسموحة دماغ مشلول. فإن سقط
   * كل شيء أعاد الإقرار بالجهل.
   */
  inhibit(candidates: readonly Strategy[], ctx: {
    intent: Intent;
    askedRecently: readonly string[];
    lastStrategies: readonly Strategy[];
    hasFact: boolean;
    hasGeneralization: boolean;
    recallScore: number;
    vocab: number;
    /** كم كلمة في كلام أبيه لم يسمعها قط — مقياس جهله الحاضر */
    unknownCount: number;
    /** ثقته في الحقيقة التي يملكها الآن — بها يُعرف أإقرارُه بالجهل صدقٌ أم عجز */
    factConfidence: number;
    /** قوّة الشبه الذي يبني عليه تعميمه — دونها لا يخمّن الشابّ */
    generalizeStrength: number;
    /** أنزل درسُ أبيه في هذه النبضة فعلاً؟ أي: فُهم وحُفظ لا أنه قيل فحسب */
    lessonLanded: boolean;
    /**
     * أسألك أبوك سؤالاً يطلب معرفة؟ **من النحو لا من المصنِّف**.
     *
     * وهذا تصحيحُ خلطٍ كشفه بابُ «ما لا يُمتنَع عنه»: كان «أهو سؤال» يُقرأ من
     * `intent` المتعلَّم، فإن أخطأ المصنِّف صار «شو تعمل الدرقاوة؟» غيرَ سؤال،
     * فانفتح بابُ «لا أعرف» على معرفةٍ يملكها — فامتنع عن جوابٍ عنده في ثلثي
     * البذور. وكونُ الجملة سؤالاً بنيةٌ لا احتمال، ومالكُها النحو.
     */
    asksKnowledge: boolean;
    /**
     * أعند مالكِ الطلب جوابٌ جاهزٌ مطابقٌ لنوعه؟
     *
     * فإن كان، فردُّ السؤال بسؤالٍ **ليس اختياراً وارداً** — لا مرجوحاً بل
     * غيرَ صالح. ومَن سُئل عمّا يعرف فسأل بدل أن يجيب لم يستكشف، بل بدا كأنه
     * لم يسمع.
     *
     * وقد قِيس قبل هذا الكبح: «شو تعمل الدرقاوة؟» بعد تعليمه إياها، على ٢٤
     * دماغاً — اثنا عشر أجابوا واثنا عشر سألوا. أي أن **نصف ما يعرفه كان
     * يسكت عنه بقرعة**. ولا تُعالَج القرعة بخفض حرارة الاستكشاف: دماغٌ جديد
     * قيمُه متساوية، والتوزيع المتساوي متساوٍ عند كل حرارة.
     */
    answerReady: boolean;
    /**
     * أعنده قاعدةٌ يمتحنها الآن؟ أي: يعرف شيئين من جنسٍ واحد فيسأل عن حدّه.
     *
     * وهذا استثناءٌ من كبح السؤال، وسببه أن الكبح بُني على عطلٍ آخر: كان يردّ
     * سؤال أبيه بسؤاله عن الشيء نفسه، فمُنع السؤالُ عند العلم. لكن «القطة
     * حيوان… والكلب كمان حيوان؟» ليس ردّ سؤال بسؤال بل امتحانُ قاعدة، وهو
     * أنفع ما يقوله طفل — به يعرف حدّ الصنف من جوابك في دورٍ واحد.
     */
    ruleToTest: boolean;
  }): Strategy[] {
    /** ما يصحّ أصلاً — حَتْم */
    const allowed: Strategy[] = [];
    /** وما يصحّ ولا يُكرّر — تفضيل يُخالَف عند الضيق */
    const preferred: Strategy[] = [];
    const lastTwo = ctx.lastStrategies.slice(-2);
    const stuckOn = lastTwo.length === 2 && lastTwo[0] === lastTwo[1] ? lastTwo[0] : null;

    // قصد الأب يحدّد ما يصلح أصلاً: مَن سُئل لا يردّ التحية، ومَن عُلّم لا يُجيب
    // عن سؤال لم يُسأل. بلا هذا الكبح يبدو زبير مجنوناً لا وليداً، ويضيع تعزيز
    // أبيه على استجابات لا علاقة لها بالموضع
    const teaching = ctx.intent === 'TEACH_FACT' || ctx.intent === 'TEACH_WORD' || ctx.intent === 'TEACH_NAME';
    /* والسؤالُ من النحو أولاً: علامتُه لا تخطئ، والمصنِّف يخطئ. ويبقى
     * المصنِّف دليلاً فيما لا علامةَ فيه — وذاك حدُّ عمله. */
    const answering = ctx.asksKnowledge
      || ctx.intent === 'ASK' || ctx.intent === 'CHITCHAT' || ctx.intent === 'UNKNOWN';

    for (const strategy of candidates) {
      switch (strategy) {
        case 'ANSWER_MEMORY':
          // جواب من ذاكرة صريحة يحتاج حقيقة صريحة، وإلا صار اختراعاً
          if (!ctx.hasFact) continue;
          if (!answering) continue;
          /* ومَن يُعلَّم الآن لا يُجيب: قال له أبوه «صغيرة» يصف بها القطة، فردّ
           * «القطة حيوان، علّمتني هيك» — جوابٌ عن سؤال لم يُسأل. والدرس النازل
           * قصدٌ صريح، ولو لم يُبيّنه ظاهرُ الجملة. */
          if (ctx.lessonLanded) continue;
          break;
        case 'ANSWER_GENERAL':
          if (!ctx.hasGeneralization) continue;
          if (!answering) continue;
          if (ctx.lessonLanded) continue;
          /* والجواب بالتعميم تخمينٌ مُعلَن، والشاب لا يخمّن إلا على شبهٍ قويّ.
           *
           * وهذا أصل الهلوسة في هذا الدماغ ومنبعها الوحيد تقريباً: أن يُنقَل
           * محمولُ شيءٍ إلى شيءٍ يشبهه في حروفه لا في معناه. فيُشدَّد عليه عند
           * النضج: شبهٌ دون العتبة العالية يُردّ ويُقرّ بجهله. */
          if (ctx.generalizeStrength < STRONG_LIKENESS) continue;
          break;
        case 'ASK_QUESTION':
          /* ولا يُردّ السؤال بسؤالٍ وعنده جوابه */
          if (ctx.answerReady) continue;
          // سؤال أعاده عن نفس الكلمة يُنفّر أباه ولا يُعلّمه شيئاً جديداً
          if (ctx.askedRecently.length >= 3 && stuckOn === 'ASK_QUESTION') continue;
          /* ومن يملك الجواب ولا يجهل شيئاً حاضراً لا يسأل، وهذا عطلٌ كُشف
           * بتشغيل التطبيق: سُئل «شو القطة؟» وهو يعرف أنها حيوان فأجاب «شو
           * القطه؟» — ردّ سؤال أبيه بسؤاله عن الشيء نفسه. والسؤال في موضع
           * المعرفة ليس فضولاً بل تهرّب، ويُعلّم الأب أن ابنه لا يجيب. */
          if (ctx.hasFact && ctx.unknownCount === 0 && !ctx.ruleToTest) continue;
          /* ومَن نزل فيه الدرس لا يسأل عن شيء ليس فيه جهلٌ حاضر: قال له أبوه
           * «القطة حيوان» فحفظها، فسؤاله بعدها «شو هذا؟» يُظهره كأنه لم يسمع. */
          if (ctx.lessonLanded && ctx.unknownCount === 0 && !ctx.ruleToTest) continue;
          /* والتحيّة تُردّ بتحيّة: مَن قيل له «مرحبا» فسأل «شو صار؟» لم يردّ
           * السلام. ويبقى السؤال مباحاً إن كان في تحيّتك لفظٌ يجهله. */
          if (ctx.intent === 'GREET' && ctx.unknownCount === 0) continue;
          break;
        case 'ACKNOWLEDGE':
          /* الإقرار بالتلقّي لا معنى له إلا بعد تعليم أو حكم — والدرس النازل
           * تعليمٌ ولو لم يُصنَّف كذلك: «صغيرة» وحدها درسٌ عن القطة حُفظ فعلاً. */
          if (!teaching && !ctx.lessonLanded
            && ctx.intent !== 'PRAISE' && ctx.intent !== 'CORRECT') continue;
          break;
        case 'GREET_BACK':
          if (ctx.intent !== 'GREET') continue;
          break;
        case 'ADMIT':
          /* «لا أعرف» مع اليقين ليس صدقاً بل عجزٌ عن النطق بما يعرف. أُضيف بعد
           * قياس: أُريَ تفاحةً وسمّاها له أبوه، ثم سُئل «شو هذا؟» فقال «ما بعرف»
           * وهو يراها ويعرف اسمها. والإقرار بالجهل يبقى مباحاً حين تكون ثقته
           * ضعيفة فعلاً — فذاك صدقٌ لا عجز. */
          if (ctx.hasFact && answering && ctx.factConfidence >= 0.5) continue;
          /* ومَن عُلّم الآن لا يقول «علّمني».
           *
           * هذا أظهر عطلٍ رآه الأب في التطبيق بعينه: قال «القطة حيوان» فردّ
           * زبير «علّمني، أريد أن أعرف» — وقد عُلّم للتوّ. ثم مدحه الأب على
           * هذا الردّ، فعُزّز «الإقرار بالجهل» في موضع التعليم، فصار يقولها
           * في كل درس بعده. عطلٌ واحد في الكبح أفسد التعليم كلَّه. */
          if (ctx.lessonLanded) continue;
          /* ولا يُقرّ بالجهل في وجه تحيّةٍ أو مدح: «لا أعرف» ليست رداً على
           * «مرحبا» ولا على «أحسنت». وهذا آخر ما بقي من غير المنطقيّ في ردّه:
           * قِيسَ فقال لأبيه حين حيّاه «ما عندي معلومة عن هذا». */
          if (ctx.intent === 'GREET' || ctx.intent === 'PRAISE') continue;
          break;
      }
      allowed.push(strategy);
      // تكرار العَرَض يُكبَح، وتكرار الكفاءة لا — انظر RUT_PRONE أعلاه
      if (stuckOn === strategy && RUT_PRONE.has(strategy)) continue;
      preferred.push(strategy);
    }

    /* المفاضلة على مرتبتين، وهذا إصلاح عطلٍ رآه الأب بعينه.
     *
     * قواعد الصلاحية أعلاه **حَتْمٌ**: مَن عُلّم لا يقول «علّمني». وكبحُ التكرار
     * **تفضيلٌ**: لا يُعيد الصيغة نفسها ثلاثاً. وكانا في مرتبة واحدة، فاجتمعا
     * على إسقاط كل الخيارات في موضعٍ بعينه — درسٌ ثالث بعد درسين أُقرّ بتلقّيهما:
     * الجواب ممنوع (أبوه يُعلّم لا يسأل)، والسؤال ممنوع (لا جهل حاضر)، و«حفظت»
     * مكبوحة بالتكرار. فسقط إلى آخر السطر — «علّمني» —
     * وهو أسوأ ما يُقال لمن يُعلّم.
     *
     * والصواب أن يُخالَف التفضيل عند الضيق ولا يُخالَف الحَتْم: أن يُعيد «حفظت»
     * خيرٌ من أن يطلب تعليماً نزل فيه للتوّ. */
    if (preferred.length > 0) return preferred;
    if (allowed.length > 0) return allowed;
    /* وآخر السطر إقرارٌ بالجهل لا ثغثغة: من ضاق عليه كل شيء يقول «لا أعرف»،
     * وهذا صدقٌ. والثغثغة كانت آخر السطر حين كان طفلاً. */
    return ['ADMIT'];
  }

  save(): PrefrontalState {
    // لا نحفظ متجهات المعنى: الذاكرة العاملة تُبنى من جديد في كل جلسة، وحفظها
    // يضخّم ملف الدماغ بلا فائدة — الحفظ الطويل شأن الحُصين
    return {
      turns: this.turns.map((t) => ({ said: t.said, replied: t.replied, tick: t.tick, strategy: t.strategy })),
    };
  }

  load(state: PrefrontalState): void {
    try {
      if (!Array.isArray(state?.turns)) return;
      this.turns = state.turns
        .filter((t) => t && typeof t.said === 'string' && typeof t.replied === 'string')
        .slice(-DIMS.workingMemory)
        .map((t) => ({
          said: t.said,
          replied: t.replied,
          tick: typeof t.tick === 'number' && Number.isFinite(t.tick) ? t.tick : 0,
          strategy: t.strategy,
          meaning: new Float32Array(0),
        }));
    } catch { /* ذاكرة عاملة عطبة: يبدأ الحوار من جديد ولا يُفقد شيئاً دائماً */ }
  }
}

/* ————— المخيخ ————— */

export interface CerebellumState {
  rules: Array<{ from: string; to: string; hits: number }>;
}

/** لا تُطبَّق قاعدة استبدال قبل أن تتكرّر: تصحيح واحد قد يكون سوء فهم أو
 *  استثناءً، والقاعدة من مثال واحد تُفسد أكثر مما تُصلح. */
const RULE_MIN_HITS = 2;
const RULE_CAP = 200;

/**
 * الاستجابات التي يكون تكرارها عادةً لا قراراً، فتُكبَح عند تواليها.
 *
 * الجواب ليس منها بقصد، وهذا إصلاح عطل حقيقي كُشف بتشغيل التطبيق: كانت القاعدة
 * تمنع **كل** استجابة تكرّرت مرّتين، فكان زبير يجيب صواباً مرّتين ثم يُمنع من
 * الجواب في الثالثة فيقول «ما بعرف» عن حقيقة يعرفها. وقد ثبّت ذلك إصابته على
 * ٦٣–٧٥٪ في اثنتي عشرة جولة تعليم بلا تقدّم، وكان يُقرأ ضعفَ تعلّمٍ وهو منعٌ
 * مفروض عليه: نفس الأسئلة تفشل في كل جولة لا أسئلة مختلفة.
 *
 * وأن يجيب المرء صواباً ثلاث مرات متتالية كفاءةٌ لا رُتّة. أما السؤال
 * والإقرار بالتلقّي وردّ التحية فتكرارها المتوالي عَرَضٌ لا معنى فيه.
 */
const RUT_PRONE: ReadonlySet<Strategy> = new Set<Strategy>([
  'ASK_QUESTION', 'ACKNOWLEDGE', 'GREET_BACK',
]);

/** لواحق تنويع حين يُكرّر نفس الجملة حرفياً — لا يُعيد نفسه كالببغاء. */
const VARIANTS: readonly string[] = ['برضو', 'كمان', 'صح؟', 'مثل ما قلت', 'هيك'];

export class Cerebellum implements Lobe<CerebellumState> {
  readonly name = 'cerebellum';
  readonly ar = 'المخيخ';
  readonly role = 'يُتقن صياغته، ويتعلّم من تصحيحك ألّا يعيد نفس الخطأ';

  private rules = new Map<string, { to: string; hits: number }>();
  private variantTurn = 0;

  refine(text: string, ctx: { recentReplies: readonly string[] }): string {
    let out = typeof text === 'string' ? text : '';

    // ١. قواعد تعلّمها من تصحيح أبيه — بعد أن تكرّرت لا من أول مرة
    for (const [from, rule] of this.rules) {
      if (rule.hits >= RULE_MIN_HITS && from && out.includes(from)) {
        out = out.split(from).join(rule.to);
      }
    }

    // ٢. تنظيف الترقيم العربي: لا مسافة قبل علامة، ومسافة واحدة بعدها
    out = out
      .replace(/\s+/g, ' ')
      .replace(/\s+([،؛؟!.:])/g, '$1')
      .replace(/([،؛؟!:])(?=[^\s])/g, '$1 ')
      .trim();

    // ٣. منع التكرار الحرفي: يضيف تنويعاً بدل أن يُعيد نفسه
    if (out.length > 0 && ctx.recentReplies.includes(out)) {
      const variant = VARIANTS[this.variantTurn % VARIANTS.length]!;
      this.variantTurn++;
      out = `${out} ${variant}`;
    }

    // الصمت ليس خياراً: طفل لا يقول شيئاً لا يمكن تعليمه ولا تصحيحه
    return out.length > 0 ? out : 'هم؟';
  }

  /**
   * يستخلص من التصحيح فرقاً على مستوى الكلمة: كلمة في الخطأ يقابلها كلمة في
   * الصواب في نفس الموضع. لا يحفظ الجملة كلها لأن قاعدة بجملة كاملة لا تُطبَّق
   * إلا على نفس الجملة، وهذا حفظٌ لا تعلّم.
   */
  learnFromCorrection(wrong: string, right: string): void {
    if (typeof wrong !== 'string' || typeof right !== 'string') return;
    const wrongWords = wrong.split(/\s+/).filter(Boolean);
    const rightWords = right.split(/\s+/).filter(Boolean);
    if (wrongWords.length === 0 || rightWords.length === 0) return;

    /* شرط الصلة: لا تُستخلص قاعدة صياغة إلا من جملتين متقاربتين بنيةً — نفس
     * عدد الكلمات، ومعظمها مشترك. وإلا كانت المقابلة بالموضع عبثاً.
     *
     * قِسته: لمّا سأل الأب «شو القطة؟» فأجاب «لا أعرف، علّمني» وصحّح الأب
     * «القطة حيوان»، بنى المخيخ قاعدتين («أعرف»←«حيوان» و«علّمني»←«القطة»)
     * فصار يقول «علّمني، حيوان أعرف». والسبب أن الجملتين ليستا صياغتين لمعنى
     * واحد بل جوابٌ وحقيقة: تصحيح المضمون شأن الفص الجُداري لا المخيخ، وهذا
     * الفص لا يملك ما يُصحّح فليصمت. */
    if (wrongWords.length !== rightWords.length) return;
    let differing = 0;
    for (let i = 0; i < wrongWords.length; i++) if (wrongWords[i] !== rightWords[i]) differing++;
    // كلمة أو كلمتان مختلفتان تعديلُ صياغة، وأكثر من ذلك جملة أخرى بالكلّية
    if (differing === 0 || differing > 2 || differing === wrongWords.length) return;

    const shared = wrongWords.length;
    for (let i = 0; i < shared; i++) {
      const from = wrongWords[i]!;
      const to = rightWords[i]!;
      if (from === to || from.length < 2) continue;
      const existing = this.rules.get(from);
      if (existing && existing.to === to) existing.hits++;
      else this.rules.set(from, { to, hits: 1 });
    }

    if (this.rules.size > RULE_CAP) {
      // نُسقط الأقل تكراراً: القواعد النادرة أرجح أن تكون سوء فهم
      const sorted = [...this.rules.entries()].sort((a, b) => b[1].hits - a[1].hits).slice(0, RULE_CAP);
      this.rules = new Map(sorted);
    }
  }

  save(): CerebellumState {
    return { rules: [...this.rules.entries()].map(([from, r]) => ({ from, to: r.to, hits: r.hits })) };
  }

  load(state: CerebellumState): void {
    try {
      if (!Array.isArray(state?.rules)) return;
      this.rules = new Map();
      for (const rule of state.rules) {
        if (!rule || typeof rule.from !== 'string' || typeof rule.to !== 'string') continue;
        const hits = typeof rule.hits === 'number' && Number.isFinite(rule.hits) ? Math.max(1, Math.floor(rule.hits)) : 1;
        this.rules.set(rule.from, { to: rule.to, hits });
      }
    } catch { /* قواعد عطبة تُترك: يعود يصوغ بلا تصحيحات متعلَّمة */ }
  }
}

function safe(value: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? clamp(value, 0, 1) : 0;
}
