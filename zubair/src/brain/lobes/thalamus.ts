/* ————— المهاد: بوابة الانتباه —————
 *
 * المهاد في الدماغ الحقيقي ليس مفكّراً بل حاجب: كل ما يصل القشرة يمرّ عليه أولاً،
 * وهو يقرّر ما يُرفع وما يُخفَض. هذا الفص يفعل الشيء نفسه على مستوى الكلمة: يُخرج
 * وزناً لكل كلمة في جملتك، ثم يُجمِّع تمثيلاتها متوسطاً موزوناً بتلك الأوزان.
 * فالكلمة التي أُغلقت عليها البوابة تصل الفص الصدغي باهتةً، والتي فُتحت تصل ثقيلة.
 *
 * البوابة تنظر إلى أمرين معاً: تمثيل الكلمة نفسها، وحالة زبير الداخلية في تلك
 * اللحظة. هذا هو معنى أن يكون الانتباه حالةً لا خاصيةً ثابتة: الكلمة الواحدة
 * تستحقّ انتباهاً مختلفاً حين يكون فَضولاً عنها وحين يكون متعباً منها.
 */

import { Dense, type DenseState } from '../core/net.js';
import { Rng, clamp, vec, type Vec } from '../core/tensor.js';
import { DIMS, type ComputePort, type Interoception, type Lobe } from '../core/types.js';
import type { Percept } from '../core/text.js';

/** أبعاد الحالة الداخلية الداخلة في قرار البوابة: يقظة، تعب، فضول، تعلّق، ملل، ثقة. */
const INTERO_DIMS = 6;
const GATE_IN = DIMS.word + INTERO_DIMS;

/**
 * انحياز موجب في `b` عند الميلاد. السبب ليس تجميلاً: لو بدأت البوابة عند نصف أو
 * أقل لكانت أوزان أول الكلمات ضئيلة، فوصل الفص الصدغي معنىً باهتاً، فلم يتعلّم
 * منه شيئاً، فلم تصل مكافأة تفتح البوابة — حلقة مغلقة. وليدٌ يُغلق انتباهه لا
 * يتعلّم شيئاً أبداً، فنبدأ مفتوحين ونترك حكم الأب يُضيّق لا يُوسّع.
 * sigmoid(1) ≈ ٠٫٧٣ قبل أي درس.
 */
const OPEN_AT_BIRTH = 1;

/** دون هذا المجموع تُعتبر البوابة مغلقة تماماً، فالقسمة عليه لا معنى لها. */
const GATE_EPS = 1e-8;

/* ————— طرفا البوابة —————
 *
 * كلمة بلغت طرفها في اتجاه المكافأة لا يبقى فيها ما يُتعلَّم: sigmoid لا يعبر
 * الصفر ولا الواحد. والدفع بعد ذلك ليس عبثاً محتملاً بل ضرر مؤكَّد، لسببين
 * مجتمعين: Adam يُعاير خطوته بحجم التدرّج لا بقيمته، فتدرّج متلاشٍ عند التشبّع
 * يُنتج خطوة كاملة لا خطوة ضئيلة؛ والانحياز `b` مشترك بين الكلمات كلها، فخطوة
 * تُدفَع من كلمة مُشبَعة تهدم انتباه كلمات أخرى معها. ولذلك تُستثنى الكلمة
 * المُشبَعة من التعزيز — كما أن المشبك العصبي لا يُثبَّط تحت الصفر.
 */
const SATURATED_LOW = 0.02;
const SATURATED_HIGH = 0.98;

export interface ThalamusState {
  /** بُعد دخل البوابة وقت الحفظ — به تُرفض أوزان بُنيت على أبعاد أخرى */
  inDim: number;
  gate: DenseState;
}

/** قيمة حالة داخلية خارج [0,1] أو غير منتهية تُفسد البوابة كلها فتُقصَر بصمت. */
function unitValue(x: number): number {
  return Number.isFinite(x) ? clamp(x, 0, 1) : 0;
}

/** أطوال مصفوفات الحالة المحفوظة تُتحقَّق قبل تمريرها لـ `Dense.load`، لأن `set`
 *  على مصفوفة أطول من الهدف ترمي، والرمي هنا يعني فقدان الدماغ. */
function finiteArray(value: unknown, length: number): boolean {
  if (!Array.isArray(value)) return false;
  const items: readonly unknown[] = value;
  if (items.length !== length) return false;
  for (let i = 0; i < length; i++) if (!Number.isFinite(items[i])) return false;
  return true;
}

export class Thalamus implements Lobe<ThalamusState> {
  readonly name = 'thalamus';
  readonly ar = 'المهاد';
  readonly role = 'بوابة الانتباه: يوزن كل كلمة من كلامك ويقرّر أيّها يستحقّ أن يصل القشرة';

  private readonly net: Dense;
  /** مخزن مدخل البوابة، يُعاد استخدامه لكل كلمة كي لا تُخصَّص ذاكرة في كل نبضة */
  private readonly input: Vec = vec(GATE_IN);
  private readonly interoceptive: Vec = vec(INTERO_DIMS);
  /** نسخ مدخلات آخر بوابة وأوزانها — عليها وحدها يقع التعزيز حين يحكم الأب */
  private lastInputs: Vec[] = [];
  private lastWeights: number[] = [];

  /** البذرة تُحقَن كي تكون تهيئة البوابة قابلة للإعادة، فيُثبَت التعلّم برقم. */
  constructor(rng?: Rng) {
    this.net = new Dense(GATE_IN, 1, 'sigmoid', rng ?? new Rng(0x7a1a));
    this.net.b[0] = OPEN_AT_BIRTH;
  }

  gate(percept: Percept, intero: Interoception, compute: ComputePort): { weights: number[]; bag: Vec } {
    const bag = vec(DIMS.word);
    const vecs = percept.tokenVecs;
    // نأخذ الأقل من الطولين: تمثيلات أقل من الرموز تعني إدراكاً ناقصاً، وقراءة
    // ما بعد النهاية تُنتج NaN يسري في الدماغ كله
    const n = Math.min(percept.tokens.length, vecs.length);

    this.lastInputs = [];
    this.lastWeights = [];

    if (n === 0) {
      // جملة فارغة ليست خطأً بل صمت: ضغطة مسافة واحدة لا يجوز أن تُسقط الدماغ
      return { weights: [], bag };
    }

    this.encodeIntero(intero);

    const weights: number[] = [];
    let total = 0;
    for (let i = 0; i < n; i++) {
      const wordVec = vecs[i]!;
      this.fillInput(wordVec);
      const y = this.net.forward(this.input, compute);
      const raw = y[0]!;
      // نصف المفتوح احتياطٌ حين يعود المسرّع بقيمة غير منتهية: بوابة مجهولة تُترك
      // على الحياد لا تُغلق
      const weight = Number.isFinite(raw) ? clamp(raw, 0, 1) : 0.5;
      weights.push(weight);
      total += weight;
      // نسخة لأن `input` يُعاد استخدامه للكلمة التالية، والتعزيز يأتي بعد النبضة
      this.lastInputs.push(this.input.slice());
    }
    this.lastWeights = weights.slice();

    // المتوسط الموزون. ومجموع أوزان صفري (بوابة مغلقة تماماً) نسقط فيه إلى المتوسط
    // غير الموزون بدل تصفير الحصيلة: جملة تُمحى بالكامل تعني درساً فُقد، وذلك أسوأ
    // ضرراً من درس وصل بأوزان متساوية
    const open = total > GATE_EPS;
    const denominator = open ? total : n;
    for (let i = 0; i < n; i++) {
      const wordVec = vecs[i]!;
      const share = (open ? weights[i]! : 1) / denominator;
      const copy = Math.min(DIMS.word, wordVec.length);
      for (let d = 0; d < copy; d++) {
        const value = wordVec[d]!;
        if (Number.isFinite(value)) bag[d]! += share * value;
      }
    }

    return { weights, bag };
  }

  /**
   * تعزيز مباشر لا انتشار خلفي من خسارة حقيقية.
   *
   * الفرق جوهري ويجب أن يُقال صريحاً: لا هدف معلوم لهذه البوابة. لا أحد يعرف ما
   * كان «الوزن الصحيح» لكلمة «القطة» في تلك الجملة، فلا خسارة تُشتقّ. الذي نعرفه
   * أن جواب زبير أرضى أباه أو لم يُرضه، وأن هذه الكلمات هي التي مرّت. فندفع خرج
   * البوابة في اتجاه المكافأة: `dy = −reward` هو تدرّج صناعي معناه «ارفع الخرج إن
   * كان المدح، واخفضه إن كان الخطأ»، ثم يتولّى انتشار `Dense` الخلفي توزيعه على
   * الأوزان بحسب مشاركة كل مدخل، وAdam يعاير الخطوة.
   *
   * ولماذا يكفي هذا هنا: خرج البوابة بُعد واحد بلا طبقة مخفية، فاتجاه التدرّج
   * الصناعي هو اتجاه التدرّج الحقيقي لو وُجدت خسارة — الخطأ الممكن في المقدار لا
   * في الاتجاه، وAdam أصلاً يُهمل المقدار. أما لو صارت البوابة شبكة عميقة فهذا
   * التبسيط لا يكفي ويجب أن يُستبدل بخطأ تنبؤ حقيقي كما في العُقد القاعدية.
   */
  reinforce(reward: number, lr = 0.05): void {
    if (this.lastInputs.length === 0) return; // لم تُفتح بوابة بعد: لا شيء يُنسب إليه الحكم
    const r = Number.isFinite(reward) ? clamp(reward, -1, 1) : 0;
    if (r === 0) return; // حكم محايد لا يُعلّم شيئاً، وخطوة Adam بتدرّج صفري تُحرّك العزوم بلا داعٍ

    let total = 0;
    for (const weight of this.lastWeights) total += weight;
    const count = this.lastInputs.length;

    const dy = vec(1);
    let contributing = 0;
    for (let i = 0; i < count; i++) {
      const x = this.lastInputs[i]!;
      // إعادة التمرير لازمة لا زائدة: `Dense.backward` يقرأ آخر مدخل وخرج من الطبقة.
      // وخرجه هذا هو وزن البوابة الآن لا وزنها وقت النبضة، وعليه وحده يصحّ فحص
      // التشبّع: لو فُحِص على الوزن المحفوظ لجاز أن يُدفَع وزنٌ بلغ طرفه فعلاً حين
      // تُعزَّز النبضة نفسها أكثر من مرة
      const now = this.net.forward(x)[0]!;
      if (!Number.isFinite(now)) continue;
      if (r > 0 && now >= SATURATED_HIGH) continue;
      if (r < 0 && now <= SATURATED_LOW) continue;
      // أما النصيب فمن وقت البوابة لا من الآن: الحكم يُنسب إلى ما شارك في الجواب
      // فعلاً. الكلمة التي مرّت كاملة تتحمّل منه أكثر من التي كادت تُحجَب، والقسمة
      // على المجموع تمنع جملةً طويلة من إحداث قفزة أكبر لمجرّد طولها
      const share = total > GATE_EPS ? (this.lastWeights[i] ?? 0) / total : 1 / count;
      dy[0] = -r * share;
      this.net.backward(dy);
      contributing++;
    }
    // خطوة واحدة للجملة كلها بعد تراكم تدرّجات كلماتها. ولا تُطلب الخطوة إن لم
    // يُسهم أحد: خطوة Adam بتدرّج صفري تُحرّك الأوزان بعزمها السابق وتُقدّم عدّاد
    // تصحيح الانحياز، فتُغيّر البوابة بلا سبب تعليمي
    if (contributing > 0) this.net.step(lr);
  }

  save(): ThalamusState {
    return { inDim: GATE_IN, gate: this.net.save() };
  }

  load(state: ThalamusState): void {
    try {
      if (!state || state.inDim !== GATE_IN) return;
      const gate = state.gate;
      if (!gate || gate.inDim !== GATE_IN || gate.outDim !== 1) return;
      // كل مصفوفة تُفحَص طولاً وقيماً: وزن واحد NaN يُغلق البوابة على كل كلمة إلى الأبد
      if (!finiteArray(gate.w, GATE_IN)) return;
      if (!finiteArray(gate.b, 1)) return;
      if (!finiteArray(gate.mW, GATE_IN) || !finiteArray(gate.vW, GATE_IN)) return;
      if (!finiteArray(gate.mB, 1) || !finiteArray(gate.vB, 1)) return;
      if (!Number.isFinite(gate.steps)) return;
      this.net.load(gate);
    } catch {
      // حالة معطوبة بشكل لم نتوقّعه: تُترك البوابة كما وُلدت، ولا يُرمى استثناء
    }
  }

  /** الترتيب ثابت لأن الأوزان تُحفظ وتُستعاد: تبديل حقلين يعني وزناً تعلّمه على
   *  «التعب» يُقرأ بعد الاستعادة على «الفضول». */
  private encodeIntero(intero: Interoception): void {
    const out = this.interoceptive;
    out[0] = unitValue(intero.arousal);
    out[1] = unitValue(intero.fatigue);
    out[2] = unitValue(intero.curiosity);
    out[3] = unitValue(intero.attachment);
    out[4] = unitValue(intero.boredom);
    out[5] = unitValue(intero.confidence);
  }

  private fillInput(wordVec: Vec): void {
    const x = this.input;
    const copy = Math.min(DIMS.word, wordVec.length);
    for (let d = 0; d < copy; d++) {
      const value = wordVec[d]!;
      x[d] = Number.isFinite(value) ? value : 0;
    }
    // تمثيل أقصر من البُعد يُكمَّل أصفاراً لا يُترك على بقايا الكلمة السابقة
    for (let d = copy; d < DIMS.word; d++) x[d] = 0;
    for (let d = 0; d < INTERO_DIMS; d++) x[DIMS.word + d] = this.interoceptive[d]!;
  }
}
