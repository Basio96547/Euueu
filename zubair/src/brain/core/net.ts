/* ————— الشبكات العصبية: انتشار أمامي وخلفي مكتوبان بيدنا —————
 *
 * هنا يقع التعلّم الحقيقي. لا مكتبة تحسب المشتقّات لنا: كل مشتق مُشتَقّ يدوياً
 * ومكتوب صريحاً. الطبقة الواحدة بسيطة (y = x·W + b ثم تنشيط)، لكن تركيبها في
 * الفصوص هو ما يجعل زبير يعمّم بدل أن يحفظ.
 *
 * لماذا Adam لا الانحدار البسيط: زبير يتعلّم من درس واحد لا من مليون. المُحسِّن
 * البسيط بمعدل ثابت إما يتحرّك أقل من أن يتعلّم أو أكثر من أن يستقر. Adam يُعاير
 * خطوته لكل وزن على حدة، فيلتقط من الأمثلة القليلة ما لا يلتقطه غيره.
 */

import { Rng, dReluFromOutput, dSigmoidFromOutput, dTanhFromOutput, reluInto, sigmoidInto, tanhInto, matvec, matvecTransposed, type Vec } from './tensor.js';
import type { ComputePort } from './types.js';

export type Activation = 'none' | 'tanh' | 'sigmoid' | 'relu';

export interface DenseState {
  inDim: number;
  outDim: number;
  w: number[];
  b: number[];
  mW: number[];
  vW: number[];
  mB: number[];
  vB: number[];
  steps: number;
}

/** طبقة موصولة بالكامل: العملة الأساسية في كل فصوص زبير. */
export class Dense {
  readonly inDim: number;
  readonly outDim: number;
  readonly activation: Activation;

  /** الأوزان بترتيب الصفوف: w[i*outDim + j] يصل المدخل i بالخرج j */
  w: Float32Array;
  b: Float32Array;

  /** عزوم Adam: المتوسط والتباين المتحرّكان لكل وزن */
  private mW: Float32Array;
  private vW: Float32Array;
  private mB: Float32Array;
  private vB: Float32Array;
  private steps = 0;

  /** التدرّجات المتراكمة قبل الخطوة */
  private gW: Float32Array;
  private gB: Float32Array;

  /** آخر مدخل وخرج — نحتاجهما في الانتشار الخلفي */
  private lastX: Vec;
  private lastY: Vec;
  private dxBuffer: Vec;

  constructor(inDim: number, outDim: number, activation: Activation = 'tanh', rng?: Rng) {
    this.inDim = inDim;
    this.outDim = outDim;
    this.activation = activation;
    this.w = new Float32Array(inDim * outDim);
    this.b = new Float32Array(outDim);
    this.mW = new Float32Array(inDim * outDim);
    this.vW = new Float32Array(inDim * outDim);
    this.mB = new Float32Array(outDim);
    this.vB = new Float32Array(outDim);
    this.gW = new Float32Array(inDim * outDim);
    this.gB = new Float32Array(outDim);
    this.lastX = new Float32Array(inDim);
    this.lastY = new Float32Array(outDim);
    this.dxBuffer = new Float32Array(inDim);

    // تهيئة Xavier: التباين يتناسب عكسياً مع عدد المداخل، وإلا تشبّعت tanh من
    // أول تمرير فمات التدرّج ولم يتعلّم شيئاً أبداً
    const generator = rng ?? new Rng(0x2b17);
    const limit = Math.sqrt(6 / (inDim + outDim));
    for (let i = 0; i < this.w.length; i++) this.w[i] = generator.uniform(-limit, limit);
  }

  /** التمرير الأمامي. حين يُعطى منفذ حساب يُنفَّذ على المعالج العصبي إن توفّر. */
  forward(x: Vec, compute?: ComputePort): Vec {
    this.lastX.set(x);
    if (compute) {
      const y = compute.dense(x, this.w, this.b, this.inDim, this.outDim, this.activation);
      this.lastY.set(y);
      return this.lastY;
    }
    matvec(this.lastY, x, this.w, this.inDim, this.outDim);
    for (let j = 0; j < this.outDim; j++) this.lastY[j]! += this.b[j]!;
    this.applyActivation(this.lastY);
    return this.lastY;
  }

  private applyActivation(y: Vec): void {
    switch (this.activation) {
      case 'tanh': tanhInto(y); break;
      case 'sigmoid': sigmoidInto(y); break;
      case 'relu': reluInto(y); break;
      case 'none': break;
    }
  }

  /**
   * الانتشار الخلفي: يستلم مشتق الخسارة بالنسبة للخرج، ويعيد مشتقها بالنسبة
   * للمدخل ليُمرَّر إلى الطبقة التي قبله. التدرّجات تتراكم حتى تُطلب الخطوة.
   *
   * تنبيه: dy يُعدَّل في مكانه (لتفادي تخصيص ذاكرة في كل نبضة)، فلا تُعِد
   * استخدامه بعد النداء.
   */
  backward(dy: Vec): Vec {
    switch (this.activation) {
      case 'tanh': dTanhFromOutput(this.lastY, dy); break;
      case 'sigmoid': dSigmoidFromOutput(this.lastY, dy); break;
      case 'relu': dReluFromOutput(this.lastY, dy); break;
      case 'none': break;
    }

    for (let i = 0; i < this.inDim; i++) {
      const xi = this.lastX[i]!;
      if (xi === 0) continue; // مدخل صفري لا يُنتج تدرّجاً — والمدخلات هنا متفرّقة جداً
      const base = i * this.outDim;
      for (let j = 0; j < this.outDim; j++) this.gW[base + j]! += xi * dy[j]!;
    }
    for (let j = 0; j < this.outDim; j++) this.gB[j]! += dy[j]!;

    return matvecTransposed(this.dxBuffer, dy, this.w, this.inDim, this.outDim);
  }

  /** خطوة Adam: تُطبَّق التدرّجات المتراكمة ثم تُصفّر. */
  step(lr = 0.02, weightDecay = 0): void {
    this.steps++;
    const beta1 = 0.9;
    const beta2 = 0.999;
    const eps = 1e-8;
    // تصحيح الانحياز: العزوم تبدأ من صفر، فبلا التصحيح تكون الخطوات الأولى
    // أصغر بكثير مما يجب — وزبير كل خطواته أولى
    const c1 = 1 - Math.pow(beta1, this.steps);
    const c2 = 1 - Math.pow(beta2, this.steps);

    for (let i = 0; i < this.w.length; i++) {
      let g = this.gW[i]!;
      if (weightDecay !== 0) g += weightDecay * this.w[i]!;
      const m = (this.mW[i] = beta1 * this.mW[i]! + (1 - beta1) * g);
      const v = (this.vW[i] = beta2 * this.vW[i]! + (1 - beta2) * g * g);
      this.w[i]! -= (lr * (m / c1)) / (Math.sqrt(v / c2) + eps);
      this.gW[i] = 0;
    }
    for (let j = 0; j < this.b.length; j++) {
      const g = this.gB[j]!;
      const m = (this.mB[j] = beta1 * this.mB[j]! + (1 - beta1) * g);
      const v = (this.vB[j] = beta2 * this.vB[j]! + (1 - beta2) * g * g);
      this.b[j]! -= (lr * (m / c1)) / (Math.sqrt(v / c2) + eps);
      this.gB[j] = 0;
    }
  }

  /**
   * خطوة انحدار بسيطة: التغيير يتناسب مع حجم الخطأ فيهدأ عند الاقتراب.
   *
   * لماذا لا Adam هنا: Adam يُعاير خطوته بعزومه فتصير ثابتة الحجم تقريباً مهما
   * صغر الخطأ — وهذا مطلوب في التعلّم المُوجَّه (لالتقاط الإشارة من أمثلة
   * قليلة)، وكارثة في التعلّم المعزَّز: القيمة المتوقَّعة تعبر هدفها ثم تعبره
   * راجعةً فلا تستقرّ أبداً، فيصير «الدوبامين» ضجيجاً لا مفاجأة. قِسته: بخطوة
   * Adam تجاوزت القيمة ٢٫٤ لمكافأة أقصاها ١.
   */
  stepPlain(lr = 0.03): void {
    for (let i = 0; i < this.w.length; i++) {
      this.w[i]! -= lr * this.gW[i]!;
      this.gW[i] = 0;
    }
    for (let j = 0; j < this.b.length; j++) {
      this.b[j]! -= lr * this.gB[j]!;
      this.gB[j] = 0;
    }
  }

  save(): DenseState {
    return {
      inDim: this.inDim,
      outDim: this.outDim,
      w: Array.from(this.w),
      b: Array.from(this.b),
      mW: Array.from(this.mW),
      vW: Array.from(this.vW),
      mB: Array.from(this.mB),
      vB: Array.from(this.vB),
      steps: this.steps,
    };
  }

  load(state: DenseState): void {
    // لا نثق بالحجم: دماغ محفوظ بنسخة أقدم قد تختلف أبعاده، والانفجار هنا
    // يعني فقدان دماغ زبير كله. نتجاهل الحالة غير المطابقة ونُبقي التهيئة.
    if (state.inDim !== this.inDim || state.outDim !== this.outDim) return;
    this.w.set(state.w);
    this.b.set(state.b);
    this.mW.set(state.mW);
    this.vW.set(state.vW);
    this.mB.set(state.mB);
    this.vB.set(state.vB);
    this.steps = state.steps;
  }
}

export interface MlpState {
  layers: DenseState[];
}

/** شبكة من طبقات متتالية، بانتشار خلفي كامل عبرها. */
export class Mlp {
  readonly layers: Dense[];

  constructor(dims: readonly number[], activations: readonly Activation[], rng?: Rng) {
    if (dims.length < 2) throw new Error('الشبكة تحتاج بُعد دخل وبُعد خرج على الأقل');
    this.layers = [];
    for (let i = 0; i + 1 < dims.length; i++) {
      this.layers.push(new Dense(dims[i]!, dims[i + 1]!, activations[i] ?? 'tanh', rng));
    }
  }

  forward(x: Vec, compute?: ComputePort): Vec {
    let current = x;
    for (const layer of this.layers) current = layer.forward(current, compute);
    return current;
  }

  /** يُمرِّر مشتق الخسارة من الخرج إلى الدخل، ويعيد مشتقها عند الدخل. */
  backward(dy: Vec): Vec {
    let current = dy;
    for (let i = this.layers.length - 1; i >= 0; i--) current = this.layers[i]!.backward(current);
    return current;
  }

  step(lr = 0.02, weightDecay = 0): void {
    for (const layer of this.layers) layer.step(lr, weightDecay);
  }

  /** انحدار بسيط عبر كل الطبقات — للتعلّم المعزَّز. انظر Dense.stepPlain. */
  stepPlain(lr = 0.03): void {
    for (const layer of this.layers) layer.stepPlain(lr);
  }

  save(): MlpState {
    return { layers: this.layers.map((l) => l.save()) };
  }

  load(state: MlpState): void {
    if (!state?.layers || state.layers.length !== this.layers.length) return;
    this.layers.forEach((layer, i) => layer.load(state.layers[i]!));
  }
}

/* ————— جدول التمثيلات: مفردات تنمو —————
 *
 * هذا هو الفرق بين دماغ زبير وشبكة عادية: الشبكة العادية تُبنى بمفردات ثابتة
 * محدّدة سلفاً، وزبير يسمع منك كلمة لم تُخلق في دماغه بعد، فيجب أن **ينمو** له
 * صفٌّ جديد في اللحظة. لذلك الجدول قابل للتوسّع لا مصفوفة ثابتة.
 */
export interface EmbeddingState {
  dim: number;
  rows: number[][];
  moments: number[][];
}

export class Embedding {
  readonly dim: number;
  private rows: Float32Array[] = [];
  /** عزم واحد لكل صف — Adam مبسّط يكفي هنا لأن التحديثات متفرّقة */
  private moments: Float32Array[] = [];
  private rng: Rng;

  constructor(dim: number, rng?: Rng) {
    this.dim = dim;
    this.rng = rng ?? new Rng(0x7a11);
  }

  get size(): number {
    return this.rows.length;
  }

  /** يُنشئ صفاً جديداً لكلمة جديدة ويُعيد رقمها. */
  grow(): number {
    const row = new Float32Array(this.dim);
    // قيم ابتدائية صغيرة عشوائية: صفوف متطابقة تعني كلمات لا يميّزها الدماغ
    const scale = 1 / Math.sqrt(this.dim);
    for (let i = 0; i < this.dim; i++) row[i] = this.rng.gauss() * scale;
    this.rows.push(row);
    this.moments.push(new Float32Array(this.dim));
    return this.rows.length - 1;
  }

  get(id: number): Vec {
    const row = this.rows[id];
    if (!row) throw new Error(`لا يوجد تمثيل للرقم ${id}`);
    return row;
  }

  has(id: number): boolean {
    return id >= 0 && id < this.rows.length;
  }

  /** تحديث صف واحد بتدرّج — التعلّم المتفرّق الذي يخصّ الكلمة المسموعة وحدها. */
  update(id: number, grad: Vec, lr = 0.05): void {
    const row = this.rows[id];
    const moment = this.moments[id];
    if (!row || !moment) return;
    for (let i = 0; i < this.dim; i++) {
      const m = (moment[i] = 0.9 * moment[i]! + 0.1 * grad[i]!);
      row[i]! -= lr * m;
    }
  }

  /** تقريب هيبي: كلمتان تتجاوران في كلامك تتقاربان في ذهنه.
   *  «الخلايا التي تُثار معاً تترابط» — قاعدة هيب، وهي أرخص من الانتشار الخلفي
   *  وتكفي لبناء أول بنية معنى من أمثلتك القليلة. */
  associate(idA: number, idB: number, rate = 0.02): void {
    const a = this.rows[idA];
    const b = this.rows[idB];
    if (!a || !b || idA === idB) return;
    for (let i = 0; i < this.dim; i++) {
      const mid = (a[i]! + b[i]!) * 0.5;
      a[i]! += rate * (mid - a[i]!);
      b[i]! += rate * (mid - b[i]!);
    }
  }

  save(): EmbeddingState {
    return {
      dim: this.dim,
      rows: this.rows.map((r) => Array.from(r)),
      moments: this.moments.map((m) => Array.from(m)),
    };
  }

  load(state: EmbeddingState): void {
    if (!state || state.dim !== this.dim) return;
    this.rows = state.rows.map((r) => Float32Array.from(r));
    this.moments = state.moments.map((m) => Float32Array.from(m));
    // الحالة المحفوظة قد تنقصها العزوم لو حُفظت بنسخة أقدم
    while (this.moments.length < this.rows.length) this.moments.push(new Float32Array(this.dim));
  }
}

/* ————— الخسائر ————— */

/** خسارة الانتروبيا المتقاطعة مع softmax: مشتقها هو (الاحتمال − الهدف) مباشرة،
 *  وهذا التبسيط هو سبب استخدامها في كل مصنّف — لا حاجة لسلسلة مشتقّات. */
export function softmaxCrossEntropyGrad(probs: Vec, targetIndex: number, out: Vec): number {
  for (let i = 0; i < probs.length; i++) out[i] = probs[i]!;
  const p = probs[targetIndex] ?? 1e-9;
  out[targetIndex]! -= 1;
  return -Math.log(Math.max(p, 1e-9));
}

/** خسارة تربيعية: للتنبؤ بقيم مستمرة كتمثيل معنى. */
export function squaredLossGrad(prediction: Vec, target: Vec, out: Vec): number {
  let loss = 0;
  for (let i = 0; i < prediction.length; i++) {
    const d = prediction[i]! - target[i]!;
    out[i] = d;
    loss += d * d;
  }
  return loss / Math.max(1, prediction.length);
}
