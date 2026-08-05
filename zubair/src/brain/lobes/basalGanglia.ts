/* ————— العُقد القاعدية —————
 *
 * لا تفهم ولا تتكلّم: تختار. أمام زبير سبع طرق للاستجابة، وهذا الفص يقرّر
 * أيّها الآن — ويتعلّم من مدح أبيه وتصحيحه أيّها يُرضيه في كل موضع.
 *
 * وأهم ما فيه أنه يتعلّم من **المفاجأة** لا من الرضا: الإشارة التي تُعدّل أوزانه
 * هي خطأ التنبّؤ بالمكافأة (المكافأة − ما توقّعه)، لا المكافأة نفسها. فمدح
 * متوقَّع لا يُعلّمه شيئاً، تماماً كما يعمل الدوبامين في دماغك. لو تعلّم من
 * المكافأة المطلقة لظلّ يقوّي ما تعلّمه أصلاً حتى يتحجّر عليه.
 */

import { Mlp } from '../core/net.js';
import { Rng, argmax, clamp, sampleCategorical, softmax, vec, type Vec } from '../core/tensor.js';
import type { Understanding } from './temporal.js';
import {
  STRATEGIES,
  type ComputePort, type Interoception, type Lobe, type StageId, type Strategy,
} from '../core/types.js';

export interface Decision {
  strategy: Strategy;
  probs: Vec;
  qs: Vec;
  state: Vec;
}

export interface BasalGangliaState {
  net: ReturnType<Mlp['save']>;
}

/**
 * ترتيب متجه الحالة — معلن وثابت، ولا يجوز تغييره بعد أن يتعلّم زبير لأن
 * أوزانه تتعلّم على هذا الترتيب بالذات:
 *
 *   [0..15]  ملخّص المعنى: أول ١٦ بُعداً من متجه المعنى
 *   [16]     عدم يقينه في فهم القصد
 *   [17]     قوّة استدعائه من الذاكرة
 *   [18]     يملك حقيقة صريحة؟
 *   [19]     يملك تعميماً؟
 *   [20]     الوسم العاطفي للمعنى
 *   [21]     تعارضه الداخلي
 *   [22..27] حالته الداخلية من الجزيرة (بترتيب INSULA_ORDER)
 *   [28]     مرحلة نموه مُسوّاة
 *   [29]     عدد الكلمات المجهولة مُسوّى
 *
 * أخذتُ ١٦ بُعداً من المعنى لا ٦٤: الحالة تدخل شبكة تتعلّم من عشرات الأمثلة،
 * وحالة بستّة وستّين بُعداً على عشرين مثالاً تحفظ ولا تُعمّم. الأبعاد الأولى
 * تكفي لتمييز «نوع» الجملة، والتفصيل الدقيق ليس من شأن القرار بل من شأن الكلام.
 */
const MEANING_SLICE = 16;
export const STATE_DIM = MEANING_SLICE + 6 + 6 + 2;

/**
 * فرقٌ في القيمة يُعدّ حاسماً، فلا يُقترع عليه بل يُؤخذ الأعلى مباشرة.
 *
 * أُضيف بعد قياس: بلا هذا الحدّ ظلّت إصابة زبير تهتزّ حول ٦٥٪ في اثنتي عشرة
 * جولة تعليم بلا تقدّم — لا لأنه لم يتعلّم، بل لأن الاقتراع بحرارة موجبة يخالف
 * ما تعلّمه في نحو ثلث المرات. فكان يعرف أن «القطة حيوان» ويقول «ما بعرف».
 *
 * والاستكشاف بعد أن يتبيّن الفرق ليس استكشافاً بل نسياناً: الطفل يجرّب حين
 * يشكّ، فإذا أيقن التزم. ويبقى الشكّ محفوظاً: كل تصحيح من الأب يُنزل القيمة
 * فيعود الفرق غير حاسم فيعود التجريب.
 */
const DECISIVE_GAP = 0.35;

export class BasalGanglia implements Lobe<BasalGangliaState> {
  readonly name = 'basalGanglia';
  readonly ar = 'العُقد القاعدية';
  readonly role = 'يختار كيف يستجيب، ويتعلّم من مدحك بخطأ التنبّؤ — أي بالمفاجأة لا بالرضا';

  private readonly net: Mlp;
  private readonly state: Vec = vec(STATE_DIM);
  private readonly grad: Vec = vec(STRATEGIES.length);

  constructor(rng?: Rng) {
    // خرج بلا تنشيط: قيم Q لا احتمالات — التنشيط يسحقها في [-1,1] فيمنع
    // الشبكة من التعبير عن فرق كبير بين استجابة مُجدية وأخرى فاشلة
    this.net = new Mlp([STATE_DIM, 24, STRATEGIES.length], ['tanh', 'none'], rng ?? new Rng(0x9c41));
  }

  encodeState(input: {
    understanding: Understanding;
    recallScore: number;
    hasFact: boolean;
    hasGeneralization: boolean;
    valence: number;
    conflict: number;
    intero: Interoception;
    insula: Vec;
    stage: StageId;
    unknownCount: number;
  }): Vec {
    const s = this.state;
    s.fill(0);
    const meaning = input.understanding.meaning;
    for (let i = 0; i < MEANING_SLICE; i++) s[i] = safe(meaning[i]);

    s[MEANING_SLICE] = clamp(safe(input.understanding.uncertainty), 0, 1);
    s[MEANING_SLICE + 1] = clamp(safe(input.recallScore), -1, 1);
    s[MEANING_SLICE + 2] = input.hasFact ? 1 : 0;
    s[MEANING_SLICE + 3] = input.hasGeneralization ? 1 : 0;
    s[MEANING_SLICE + 4] = clamp(safe(input.valence), -1, 1);
    s[MEANING_SLICE + 5] = clamp(safe(input.conflict), 0, 1);

    const insulaBase = MEANING_SLICE + 6;
    for (let i = 0; i < 6; i++) s[insulaBase + i] = clamp(safe(input.insula[i]), 0, 1);

    s[insulaBase + 6] = clamp(safe(input.stage) / 4, 0, 1);
    // تسوية لوغاريتمية: الفرق بين مجهول واحد واثنين يهمّ، وبين عشرين وثلاثين لا
    s[insulaBase + 7] = clamp(Math.log10(1 + Math.max(0, safe(input.unknownCount))) / 1.5, 0, 1);

    return s;
  }

  select(
    state: Vec,
    allowed: readonly Strategy[],
    temperature: number,
    rng: Rng,
    compute: ComputePort,
    /** ميلٌ يُضاف إلى قيمة كل استجابة قبل الاختيار — منه يأتي أثر الهدف */
    bias?: (strategy: Strategy) => number,
  ): Decision {
    const raw = this.net.forward(state, compute);
    const qs = raw.slice();

    /* الممنوع يُطرح من المنافسة قبل softmax لا بعده: لو خُفّض احتماله فقط لبقي
     * قابلاً للاختيار في الاستكشاف بحرارة عالية، وكبح الجبهي يجب أن يكون كبحاً
     * حقيقياً لا اقتراحاً. */
    const masked = vec(qs.length);
    let anyAllowed = false;
    for (let i = 0; i < STRATEGIES.length; i++) {
      const strategy = STRATEGIES[i]!;
      if (allowed.includes(strategy)) {
        /* الميل يُضاف إلى القيمة المتعلَّمة لا يحلّ محلّها: هدفه يُرجّح، وتجربته
         * مع أبيه تغلب الترجيح إن كذّبته. */
        const lean = bias ? bias(strategy) : 0;
        masked[i] = (qs[i] ?? 0) + (Number.isFinite(lean) ? lean : 0);
        anyAllowed = true;
      } else {
        masked[i] = -Infinity;
      }
    }

    // الجبهي يضمن ألّا تكون القائمة فارغة، لكن لو حدث فالإقرار بالجهل أسلم من
    // الانهيار: دماغ بلا استجابة مسموحة دماغ مشلول
    if (!anyAllowed) {
      const fallbackIndex = STRATEGIES.indexOf('ADMIT');
      masked[fallbackIndex >= 0 ? fallbackIndex : 0] = qs[fallbackIndex >= 0 ? fallbackIndex : 0] ?? 0;
    }

    const probs = softmax(masked, temperature);

    /* الفرق الحاسم يُستغَلّ ولا يُقترع عليه — انظر DECISIVE_GAP أعلاه. */
    let best = -Infinity;
    let second = -Infinity;
    for (let i = 0; i < masked.length; i++) {
      const q = masked[i]!;
      if (q > best) {
        second = best;
        best = q;
      } else if (q > second) {
        second = q;
      }
    }
    const decisive = Number.isFinite(best) && Number.isFinite(second) && best - second >= DECISIVE_GAP;

    let chosen = decisive ? argmax(masked) : sampleCategorical(probs, rng);
    // احتراس من احتمالات غير صالحة (كلها أصفار أو NaN): نأخذ الأقوى المسموح
    if (!Number.isFinite(probs[chosen] ?? NaN) || (probs[chosen] ?? 0) <= 0) chosen = argmax(masked);

    return { strategy: STRATEGIES[chosen] ?? 'ADMIT', probs, qs, state: state.slice() };
  }

  /** الدوبامين: المكافأة ناقص ما توقّعه. صفرٌ يعني «كما توقّعت» فلا تعلّم. */
  learn(state: Vec, strategy: Strategy, reward: number, lr = 0.02): { dopamine: number } {
    const index = STRATEGIES.indexOf(strategy);
    if (index < 0 || !Number.isFinite(reward)) return { dopamine: 0 };

    const qs = this.net.forward(state);
    const predicted = safe(qs[index]);
    const dopamine = clamp(reward, -1, 1) - predicted;

    /* تدرّج على المخرج المختار وحده والبقية أصفار: لم نُجرّب غيره فلا نعرف عنه
     * شيئاً، وتعديله بلا تجربة تخريف. هذا هو الفرق بين التعلّم المعزَّز والتعلّم
     * المُوجَّه: هناك نعرف الصواب لكل الخيارات، وهنا نعرف نتيجة خيار واحد. */
    this.grad.fill(0);
    this.grad[index] = -dopamine;
    this.net.backward(this.grad);
    // انحدار بسيط لا Adam: الخطوة تتناسب مع المفاجأة فتهدأ عند الاستقرار،
    // وهذا شرط أن يكون الدوبامين مفاجأةً تتضاءل لا ضجيجاً يتقلّب
    this.net.stepPlain(lr);

    return { dopamine };
  }

  save(): BasalGangliaState {
    return { net: this.net.save() };
  }

  load(state: BasalGangliaState): void {
    try {
      if (state?.net) this.net.load(state.net);
    } catch { /* أوزان عطبة تُترك: يعود يختار بعشوائية وليد */ }
  }
}

function safe(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
