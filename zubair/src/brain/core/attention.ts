/* ————— الانتباه الذاتي: أن تنظر كل كلمة إلى كل كلمة —————
 *
 * كان انتباه زبير **إفرادياً**: المهاد يزن كل كلمة وحدها من متجهها وحالته
 * الداخلية، ولا تنظر كلمة إلى كلمة. وعطلُ ذلك ظاهر: في «شو القطة؟» لا تستطيع
 * «شو» أن ترفع وزن «القطة»، مع أن كل معنى السؤال في هذه العلاقة بالذات. وكذلك
 * «ليست» لا تقلب ما بعدها، و«كم» لا تُوجّه الانتباه إلى المعدود.
 *
 * والانتباه الذاتي هو الجواب: لكل كلمة **استفهامٌ** (Q) تسأل به عمّا تحتاجه،
 * ولكل كلمة **مفتاحٌ** (K) تُعرّف به بنفسها، و**قيمةٌ** (V) هي ما تُعطيه. فتُضرب
 * استفهاماتُ كلٍّ بمفاتيح الكل، ويُسوّى الناتج بـ softmax، فتُجمَع القيم موزونةً
 * بذلك. والحاصل تمثيلٌ للكلمة **في سياقها** لا وحدها.
 *
 *   scoreᵢⱼ = (qᵢ · kⱼ) / √d        ثم   αᵢ = softmax(scoreᵢ)
 *   ctxᵢ    = Σⱼ αᵢⱼ · vⱼ           ثم   outᵢ = xᵢ + ctxᵢ
 *
 * والجمع الأخير (البواقي) مقصود: بلاه يُستبدل تمثيل الكلمة بسياقها فتضيع
 * الكلمة نفسها. والمطلوب أن تُضاف إليها لا أن تُمحى بها.
 *
 * ———— ولماذا رأسٌ واحد وبُعدٌ صغير ————
 *
 * لأن هذا دماغ طفلٍ يعمل على جوال، وجملُ أبيه ثلاث كلمات لا ألف رمز. رؤوسٌ
 * متعدّدة على جملة من ثلاث كلمات لا تتعلّم أنماطاً مختلفة بل تحفظ الجملة نفسها
 * أربع مرات. والكِبَر هنا ليس فضيلة.
 *
 * ———— وكيف يتعلّم ————
 *
 * بحكم الأب، عبر بوابة المهاد نفسها: يُصحَّح وزنُ الكلمة، فيسري تدرّجه إلى
 * تمثيلها المُسيَّق، فإلى القيم والمفاتيح والاستفهامات. فما يتعلّمه هذا الفص
 * هو: **أي كلمةٍ ينبغي أن تنظر إلى أيّ كلمة** كي يُرضي جوابُه أباه.
 */

import { Dense, type DenseState } from './net.js';
import { Rng, vec, type Vec } from './tensor.js';

/** بُعد الاستفهام والمفتاح. أصغر من بُعد الكلمة بقصد: ضغطٌ يُجبر الشبكة على
 *  التقاط ما يُميّز الكلمة في العلاقة لا كل تفاصيلها. */
export const HEAD_DIM = 16;

/** أطول جملة يُحسب لها انتباه. ما زاد يُقصّ: جملةٌ من أربعين كلمة ليست كلام أبٍ
 *  لطفله، وحسابها تربيعيٌّ فيُثقل جوالاً بلا فائدة. */
export const MAX_TOKENS = 24;

export interface AttentionState {
  dim: number;
  head: number;
  q: DenseState;
  k: DenseState;
  v: DenseState;
}

export class SelfAttention {
  private readonly q: Dense;
  private readonly k: Dense;
  private readonly v: Dense;

  /* ما حُفظ من آخر تمرير أمامي — يلزم كلُّه في الانتشار الخلفي، ولا يُستعاد
   * بإعادة الحساب لأن الحساب نفسه هو ما نريد اشتقاقه. */
  private xs: Vec[] = [];
  private qs: Vec[] = [];
  private ks: Vec[] = [];
  private vs: Vec[] = [];
  private alpha: number[][] = [];

  constructor(private readonly dim: number, rng?: Rng) {
    const seed = rng ?? new Rng(0x3f19);
    // بلا تنشيط: الإسقاط خطّيّ كما في كل انتباه، والتنشيط هنا يكسر حاصل الضرب
    this.q = new Dense(dim, HEAD_DIM, 'none', seed);
    this.k = new Dense(dim, HEAD_DIM, 'none', seed);
    this.v = new Dense(dim, dim, 'none', seed);
    /* القيم تبدأ أصفاراً، فيبدأ الانتباه **بلا أثر**: outᵢ = xᵢ تماماً.
     *
     * وهذا احتراسٌ من عطلٍ حقيقي لا تجميل: إسقاطٌ عشوائي للقيم يُضيف إلى كل
     * كلمة سياقاً عشوائياً قبل أن يتعلّم شيئاً، فيُفسد ما بناه المهاد والصدغي
     * من قبل. والصواب أن يبدأ الفص محايداً ثم يتعلّم متى ينظر ومن ينظر — كما
     * صُفِّرت اللوزة لأن مَن لا تجربة له لا وسم عنده. */
    this.v.w.fill(0);
  }

  /**
   * تمثيل كل كلمة في سياق جملتها.
   *
   * تُعاد متجهات جديدة لا مُعدَّلة في مكانها: مدخلاتها متجهات المعجم نفسها،
   * والكتابة فيها تُفسد تمثيل الكلمة في كل جملة بعدها.
   */
  forward(tokens: readonly Vec[]): Vec[] {
    const n = Math.min(tokens.length, MAX_TOKENS);
    this.xs = []; this.qs = []; this.ks = []; this.vs = []; this.alpha = [];
    if (n === 0) return [];

    for (let i = 0; i < n; i++) {
      const x = fit(tokens[i]!, this.dim);
      this.xs.push(x);
      this.qs.push(this.q.forward(x).slice());
      this.ks.push(this.k.forward(x).slice());
      this.vs.push(this.v.forward(x).slice());
    }

    const scale = 1 / Math.sqrt(HEAD_DIM);
    const out: Vec[] = [];
    for (let i = 0; i < n; i++) {
      const scores = new Array<number>(n);
      let top = -Infinity;
      for (let j = 0; j < n; j++) {
        scores[j] = dot(this.qs[i]!, this.ks[j]!) * scale;
        if (scores[j]! > top) top = scores[j]!;
      }
      // الطرح من الأقصى قبل الأُسّ: بلاه يفيض الأُسّ على قيم كبيرة فيصير الوزن NaN
      let sum = 0;
      const row = new Array<number>(n);
      for (let j = 0; j < n; j++) {
        const e = Math.exp(scores[j]! - top);
        row[j] = e;
        sum += e;
      }
      for (let j = 0; j < n; j++) row[j] = sum > 0 ? row[j]! / sum : 1 / n;
      this.alpha.push(row);

      const context = vec(this.dim);
      for (let j = 0; j < n; j++) {
        const weight = row[j]!;
        if (weight === 0) continue;
        const value = this.vs[j]!;
        for (let d = 0; d < this.dim; d++) context[d]! += weight * value[d]!;
      }
      // البواقي: الكلمة نفسها تبقى، والسياق يُضاف إليها
      for (let d = 0; d < this.dim; d++) context[d]! += this.xs[i]![d]!;
      out.push(context);
    }
    return out;
  }

  /**
   * الانتشار الخلفي عبر الانتباه.
   *
   * مشتقّ softmax هو الموضع الوحيد الذي يستحقّ الشرح: الوزن الواحد يعتمد على
   * كل الدرجات في صفّه، فمشتقّه ليس محلياً:
   *
   *   ∂L/∂scoreᵢⱼ = αᵢⱼ · ( ∂L/∂αᵢⱼ − Σₖ αᵢₖ · ∂L/∂αᵢₖ )
   *
   * والطرح هو المنافسة نفسها: رفعُ انتباه كلمةٍ خفضٌ لانتباه أخواتها حتماً،
   * لأن المجموع واحد. وهذا ما يجعل الانتباه **اختياراً** لا ترجيحاً مستقلاً.
   */
  backward(dOut: readonly Vec[]): void {
    const n = this.xs.length;
    if (n === 0 || dOut.length === 0) return;

    const dV: Vec[] = [];
    for (let j = 0; j < n; j++) dV.push(vec(this.dim));
    const dQ: Vec[] = [];
    const dK: Vec[] = [];
    for (let i = 0; i < n; i++) { dQ.push(vec(HEAD_DIM)); dK.push(vec(HEAD_DIM)); }

    const scale = 1 / Math.sqrt(HEAD_DIM);

    for (let i = 0; i < n; i++) {
      const dCtx = dOut[i];
      if (!dCtx) continue;
      const row = this.alpha[i]!;

      // ١. تدرّج القيم، وتدرّج أوزان الانتباه
      const dAlpha = new Array<number>(n).fill(0);
      for (let j = 0; j < n; j++) {
        const weight = row[j]!;
        const value = this.vs[j]!;
        let acc = 0;
        const target = dV[j]!;
        for (let d = 0; d < this.dim && d < dCtx.length; d++) {
          const g = dCtx[d]!;
          target[d]! += weight * g;
          acc += g * value[d]!;
        }
        dAlpha[j] = acc;
      }

      // ٢. عبور softmax
      let weighted = 0;
      for (let j = 0; j < n; j++) weighted += row[j]! * dAlpha[j]!;
      for (let j = 0; j < n; j++) {
        const dScore = row[j]! * (dAlpha[j]! - weighted) * scale;
        if (dScore === 0) continue;
        const qi = this.qs[i]!;
        const kj = this.ks[j]!;
        const dqi = dQ[i]!;
        const dkj = dK[j]!;
        for (let d = 0; d < HEAD_DIM; d++) {
          dqi[d]! += dScore * kj[d]!;
          dkj[d]! += dScore * qi[d]!;
        }
      }
    }

    /* إعادة التمرير قبل كل خطوة خلفية: `Dense` يحتفظ بآخر مدخل واحد، ونحن
     * نمرّ على كلماتٍ عدّة. والتدرّجات تتراكم فيه حتى تُطلب الخطوة، فيصحّ أن
     * نمرّ كلمةً كلمة. */
    for (let i = 0; i < n; i++) {
      const x = this.xs[i]!;
      this.q.forward(x); this.q.backward(dQ[i]!);
      this.k.forward(x); this.k.backward(dK[i]!);
      this.v.forward(x); this.v.backward(dV[i]!);
    }
  }

  step(lr = 0.01): void {
    this.q.step(lr);
    this.k.step(lr);
    this.v.step(lr);
  }

  /** أوزان انتباه آخر جملة: صفٌّ لكل كلمة. تُعرَض للأب ويُختبر بها التعلّم. */
  get map(): number[][] {
    return this.alpha.map((row) => [...row]);
  }

  save(): AttentionState {
    return {
      dim: this.dim, head: HEAD_DIM,
      q: this.q.save(), k: this.k.save(), v: this.v.save(),
    };
  }

  load(state: AttentionState): void {
    try {
      if (!state || state.dim !== this.dim || state.head !== HEAD_DIM) return;
      this.q.load(state.q);
      this.k.load(state.k);
      this.v.load(state.v);
    } catch { /* انتباه عطب يُترك: يعود محايداً فيصير كل كلمة وحدها كما كان */ }
  }
}

function dot(a: Vec, b: Vec): number {
  let sum = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) sum += a[i]! * b[i]!;
  return sum;
}

/** نسخة بطول ثابت من متجه قد يكون أقصر أو أطول — وقيمة شاذّة تُصفَّر. */
function fit(source: Vec, dim: number): Vec {
  const out = vec(dim);
  const n = Math.min(source.length, dim);
  for (let i = 0; i < n; i++) {
    const value = source[i]!;
    out[i] = Number.isFinite(value) ? value : 0;
  }
  return out;
}
