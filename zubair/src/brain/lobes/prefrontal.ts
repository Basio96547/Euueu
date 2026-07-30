/* ————— الفص الجبهي والمخيخ —————
 *
 * الجبهي هو الكبح: أحدث ما نما في الدماغ وآخر ما يكتمل في الإنسان، ووظيفته
 * ليست أن يفعل بل أن **يمنع**. طفل بلا فص جبهي يعيد السؤال نفسه عشر مرات
 * ويثغثغ بعد أن كبر. وهنا يمنع زبير من ذلك، ويحمل الحوار في رأسه.
 *
 * والمخيخ هو الإتقان: لا يقرّر ما يُقال بل كيف يُقال، ويتعلّم من تصحيح أبيه
 * ألّا يعيد نفس الخطأ في الصياغة.
 */

import { clamp, type Vec } from '../core/tensor.js';
import type { Understanding } from './temporal.js';
import { DIMS, STAGES, type Intent, type Interoception, type Lobe, type Stage, type Strategy } from '../core/types.js';

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

export class Prefrontal implements Lobe<PrefrontalState> {
  readonly name = 'prefrontal';
  readonly ar = 'الفص الجبهي';
  readonly role = 'يحمل الحوار في رأسه ويكبح نفسه: لا يعيد سؤالاً سأله، ولا يثغثغ بعد أن كبر';

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
   * كل شيء أعاد الإقرار بالجهل، أو الثغثغة إن كان لا يزال وليداً.
   */
  inhibit(candidates: readonly Strategy[], ctx: {
    stage: Stage;
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
  }): Strategy[] {
    const allowed: Strategy[] = [];
    const lastTwo = ctx.lastStrategies.slice(-2);
    const stuckOn = lastTwo.length === 2 && lastTwo[0] === lastTwo[1] ? lastTwo[0] : null;
    const firstStageVocab = STAGES[1]?.minVocab ?? 12;
    // قصد الأب يحدّد ما يصلح أصلاً: مَن سُئل لا يردّ التحية، ومَن عُلّم لا يُجيب
    // عن سؤال لم يُسأل. بلا هذا الكبح يبدو زبير مجنوناً لا وليداً، ويضيع تعزيز
    // أبيه على استجابات لا علاقة لها بالموضع
    const teaching = ctx.intent === 'TEACH_FACT' || ctx.intent === 'TEACH_WORD' || ctx.intent === 'TEACH_NAME';
    const answering = ctx.intent === 'ASK' || ctx.intent === 'CHITCHAT' || ctx.intent === 'UNKNOWN';

    for (const strategy of candidates) {
      switch (strategy) {
        case 'ANSWER_MEMORY':
          // جواب من ذاكرة صريحة يحتاج حقيقة صريحة، وإلا صار اختراعاً
          if (!ctx.hasFact) continue;
          if (!answering) continue;
          break;
        case 'ANSWER_GENERAL':
          if (!ctx.hasGeneralization) continue;
          if (!answering) continue;
          break;
        case 'ASK_QUESTION':
          // سؤال أعاده عن نفس الكلمة يُنفّر أباه ولا يُعلّمه شيئاً جديداً
          if (ctx.askedRecently.length >= 3 && stuckOn === 'ASK_QUESTION') continue;
          /* ومن يملك الجواب ولا يجهل شيئاً حاضراً لا يسأل، وهذا عطلٌ كُشف
           * بتشغيل التطبيق: سُئل «شو القطة؟» وهو يعرف أنها حيوان فأجاب «شو
           * القطه؟» — ردّ سؤال أبيه بسؤاله عن الشيء نفسه. والسؤال في موضع
           * المعرفة ليس فضولاً بل تهرّب، ويُعلّم الأب أن ابنه لا يجيب. */
          if (ctx.hasFact && ctx.unknownCount === 0) continue;
          break;
        case 'BABBLE':
          // من تعلّم كلمات لا يعود يثغثغ: هذا هو النمو محسوساً
          if (ctx.vocab >= firstStageVocab) continue;
          /* ووليدٌ يملك الجواب لا يُثغثغ به: الثغثغة عجزٌ عن الكلام لا اختيارٌ
           * له. أُضيف بعد قياس: سُئل «شو هذا؟» وهو يرى تفاحةً سمّاها له أبوه
           * قبل لحظة، فقال «شو؟» — يعرف ولا ينطق. */
          if (ctx.hasFact && answering) continue;
          break;
        case 'ACKNOWLEDGE':
          // الإقرار بالتلقّي لا معنى له إلا بعد تعليم أو حكم
          if (!teaching && ctx.intent !== 'PRAISE' && ctx.intent !== 'CORRECT') continue;
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
          break;
      }
      // تكرار العَرَض يُكبَح، وتكرار الكفاءة لا — انظر RUT_PRONE أعلاه
      if (stuckOn === strategy && RUT_PRONE.has(strategy)) continue;
      allowed.push(strategy);
    }

    if (allowed.length > 0) return allowed;
    return ctx.vocab < firstStageVocab ? ['BABBLE'] : ['ADMIT'];
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
 * وأن يجيب المرء صواباً ثلاث مرات متتالية كفاءةٌ لا رُتّة. أما الثغثغة والسؤال
 * والإقرار بالتلقّي وردّ التحية فتكرارها المتوالي عَرَضٌ لا معنى فيه.
 */
const RUT_PRONE: ReadonlySet<Strategy> = new Set<Strategy>([
  'BABBLE', 'ASK_QUESTION', 'ACKNOWLEDGE', 'GREET_BACK',
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
