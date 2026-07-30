/* ————— الرياضيات العارية —————
 *
 * كل ما يحتاجه دماغ زبير من حساب مبني هنا بيدنا: لا TensorFlow ولا PyTorch
 * ولا أي مكتبة تعلّم آلي. السبب ليس استعراضاً: دماغه يعمل داخل جوالك، وكل
 * ميغابايت يُنزَّل وكل مكتبة تُحمَّل تعني بدءاً أبطأ على شبكة سورية بطيئة.
 * الحساب كله على Float32Array لأنها القالب الذي يقبله المعالج العصبي مباشرة.
 */

export type Vec = Float32Array;
export type Mat = Float32Array; // مصفوفة مسطّحة بترتيب الصفوف: (rows × cols)

export function vec(n: number): Vec {
  return new Float32Array(n);
}

export function fromArray(values: readonly number[]): Vec {
  return Float32Array.from(values);
}

/* مُولّد أعداد عشوائية ببذرة ثابتة (xorshift128).
 * نحتاج ثباتاً لا عشوائية حقيقية: دماغ يبدأ من نفس البذرة يمكن اختباره،
 * ولو استعملنا Math.random صار كل تشغيل نتيجة مختلفة ولا يُثبَت شيء. */
export class Rng {
  private s0: number;
  private s1: number;
  private s2: number;
  private s3: number;

  constructor(seed = 0x5eed1234) {
    // نشر البذرة على أربع كلمات، وإلا بدأت الأولى بأنماط ضعيفة
    this.s0 = seed | 1;
    this.s1 = (seed ^ 0x9e3779b9) | 1;
    this.s2 = (seed ^ 0x85ebca6b) | 1;
    this.s3 = (seed ^ 0xc2b2ae35) | 1;
    for (let i = 0; i < 12; i++) this.next();
  }

  next(): number {
    let t = this.s3;
    const s = this.s0;
    this.s3 = this.s2;
    this.s2 = this.s1;
    this.s1 = s;
    t ^= t << 11;
    t ^= t >>> 8;
    this.s0 = (t ^ s ^ (s >>> 19)) >>> 0;
    return this.s0 / 0x100000000;
  }

  uniform(lo: number, hi: number): number {
    return lo + (hi - lo) * this.next();
  }

  /** توزيع طبيعي بطريقة Box–Muller — لتهيئة الأوزان. */
  gauss(): number {
    let u = this.next();
    if (u < 1e-12) u = 1e-12; // اللوغاريتم لا يقبل الصفر
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * this.next());
  }

  int(maxExclusive: number): number {
    return Math.min(maxExclusive - 1, Math.floor(this.next() * maxExclusive));
  }
}

/* ————— جبر خطّي ————— */

/** y = x · W حيث W شكلها (inDim × outDim). هذا الترتيب هو ما تتوقّعه WebNN. */
export function matvec(out: Vec, x: Vec, w: Mat, inDim: number, outDim: number): Vec {
  out.fill(0);
  for (let i = 0; i < inDim; i++) {
    const xi = x[i]!;
    if (xi === 0) continue; // المدخلات المتفرّقة شائعة جداً هنا: تجاوزها يوفّر أكثر من نصف العمل
    const base = i * outDim;
    for (let j = 0; j < outDim; j++) out[j]! += xi * w[base + j]!;
  }
  return out;
}

/** الخطأ راجعاً إلى المدخل: dx = dy · Wᵀ — نصف الانتشار الخلفي. */
export function matvecTransposed(out: Vec, dy: Vec, w: Mat, inDim: number, outDim: number): Vec {
  for (let i = 0; i < inDim; i++) {
    let sum = 0;
    const base = i * outDim;
    for (let j = 0; j < outDim; j++) sum += dy[j]! * w[base + j]!;
    out[i] = sum;
  }
  return out;
}

export function addInto(target: Vec, other: Vec): Vec {
  for (let i = 0; i < target.length; i++) target[i]! += other[i]!;
  return target;
}

export function scaleInto(target: Vec, k: number): Vec {
  for (let i = 0; i < target.length; i++) target[i]! *= k;
  return target;
}

export function dot(a: Vec, b: Vec): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i]! * b[i]!;
  return sum;
}

export function norm(a: Vec): number {
  return Math.sqrt(dot(a, a));
}

/** تشابه جيبي — مقياس القرب بين معنى وآخر في ذاكرة زبير. */
export function cosine(a: Vec, b: Vec): number {
  const na = norm(a);
  const nb = norm(b);
  if (na === 0 || nb === 0) return 0;
  return dot(a, b) / (na * nb);
}

export function normalized(a: Vec): Vec {
  const n = norm(a);
  if (n === 0) return a.slice();
  const out = a.slice();
  return scaleInto(out, 1 / n);
}

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/* ————— دوال التنشيط ————— */

export function tanhInto(v: Vec): Vec {
  for (let i = 0; i < v.length; i++) v[i] = Math.tanh(v[i]!);
  return v;
}

/** مشتق tanh من خرجه: ١ − y². أرخص من إعادة الحساب من المدخل. */
export function dTanhFromOutput(y: Vec, dy: Vec): Vec {
  for (let i = 0; i < dy.length; i++) dy[i]! *= 1 - y[i]! * y[i]!;
  return dy;
}

export function sigmoid(x: number): number {
  // تفريع يمنع طغيان exp عند القيم الكبيرة سلباً
  if (x >= 0) return 1 / (1 + Math.exp(-x));
  const e = Math.exp(x);
  return e / (1 + e);
}

export function sigmoidInto(v: Vec): Vec {
  for (let i = 0; i < v.length; i++) v[i] = sigmoid(v[i]!);
  return v;
}

export function dSigmoidFromOutput(y: Vec, dy: Vec): Vec {
  for (let i = 0; i < dy.length; i++) dy[i]! *= y[i]! * (1 - y[i]!);
  return dy;
}

export function reluInto(v: Vec): Vec {
  for (let i = 0; i < v.length; i++) if (v[i]! < 0) v[i] = 0;
  return v;
}

export function dReluFromOutput(y: Vec, dy: Vec): Vec {
  for (let i = 0; i < dy.length; i++) if (y[i]! <= 0) dy[i] = 0;
  return dy;
}

/** softmax بحرارة: الحرارة العالية تجعل زبير يجرّب، والمنخفضة تجعله يلتزم بما يعرف. */
export function softmax(v: Vec, temperature = 1): Vec {
  const t = Math.max(temperature, 1e-6);
  const out = new Float32Array(v.length);
  let peak = -Infinity;
  for (let i = 0; i < v.length; i++) {
    const s = v[i]! / t;
    if (s > peak) peak = s;
  }
  let total = 0;
  for (let i = 0; i < v.length; i++) {
    // الطرح من القمة قبل exp يمنع الطغيان — بلا هذا يظهر NaN في المنطقيات الكبيرة
    const e = Math.exp(v[i]! / t - peak);
    out[i] = e;
    total += e;
  }
  if (total === 0) return out.fill(1 / Math.max(1, v.length));
  for (let i = 0; i < out.length; i++) out[i]! /= total;
  return out;
}

export function argmax(v: Vec | readonly number[]): number {
  let best = -Infinity;
  let bestIndex = 0;
  for (let i = 0; i < v.length; i++) {
    const x = v[i]!;
    if (x > best) {
      best = x;
      bestIndex = i;
    }
  }
  return bestIndex;
}

/** اختيار موزون بالاحتمالات — قلب الاستكشاف في العُقد القاعدية. */
export function sampleCategorical(probs: Vec, rng: Rng): number {
  const threshold = rng.next();
  let cumulative = 0;
  for (let i = 0; i < probs.length; i++) {
    cumulative += probs[i]!;
    if (threshold <= cumulative) return i;
  }
  return probs.length - 1;
}

/** إنتروبيا شانون مقسومة على أقصاها: صفر يقين تام، وواحد جهل تام.
 *  زبير يستخدمها ليعرف أنه لا يعرف — وهي شرط السؤال. */
export function normalizedEntropy(probs: Vec): number {
  if (probs.length <= 1) return 0;
  let h = 0;
  for (let i = 0; i < probs.length; i++) {
    const p = probs[i]!;
    if (p > 1e-9) h -= p * Math.log(p);
  }
  return clamp(h / Math.log(probs.length), 0, 1);
}
