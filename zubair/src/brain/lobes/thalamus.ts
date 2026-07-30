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
import { LifLayer, type LifState } from '../core/spiking.js';
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

/* ————— برج التوزيع: ترشيح مجاري الحواسّ —————
 *
 * المهاد تشريحياً ليس بوابةَ كلماتٍ بل **محطّة كل الحواسّ**: كل ما يصل من العين
 * والأذن والجلد يمرّ به أولاً، فيفرز المهمّ ويوجّه كل نوع إلى قشرته المختصّة.
 * (والشمّ وحده يستثنى فيصل القشرة مباشرة — ولا شمّ في جوال أصلاً.)
 *
 * وهو يفرز بالبروز لا بالمحتوى: لا يعرف ما في الصورة ولا ما في الصوت، بل يعرف
 * «هذا المجرى فيه شيء يستحقّ» فيمرّره. ولذلك يأخذ هنا أرقام بروز مجرّدة لا
 * إدراكات — فيبقى مستقلاً عن القشور التي تُغذّيه، كما هو في الدماغ.
 */

/** بروز كل مجرى في هذه اللحظة. null تعني أن الحاسّة غائبة لا ساكنة. */
export interface StreamSalience {
  vision: number | null;
  hearing: number | null;
  body: number | null;
  /** بروز الحرف المكتوب: حضورُ كلامٍ من الأب */
  text: number | null;
}

export type Modality = 'vision' | 'hearing' | 'body' | 'text';

export interface RelayDecision {
  /** أي مجرى مرّ إلى القشرة وأي مجرى أُغلق — وهو خرج الخلايا النبضية نفسه */
  passed: Record<Modality, boolean>;
  /** وزنه بعد الترشيح: به تُرجَّح إسهاماته فيما بعد */
  weights: Record<Modality, number>;
  /** تردّد نبض كل مجرى بالهرتز: قوّة الإشارة في ترميز التردّد لا مجرّد عبورها */
  rates: Record<Modality, number>;
  /** المجرى الأبرز — إليه يتوجّه انتباهه الآن */
  focus: Modality | 'none';
  /** سبب عربي يُعرض للأب في أثر النبضة */
  reasonAr: string;
}

/** ترتيب الخلايا النبضية في الطبقة. معلن وثابت لأن حالتها تُحفظ بهذا الترتيب. */
export const MODALITIES: readonly Modality[] = ['vision', 'hearing', 'body', 'text'];

/**
 * نافذة قراءة النبض: نبضةٌ خلال خمس ثوانٍ تعني «هذا المجرى واصلٌ الآن».
 *
 * وهي نافذة طزاجة الإدراك نفسها في `brain.ts` بقصد: ما تجاوزها ليس «ما يراه
 * الآن» فلا يُبنى عليه جواب. ولولا التوحيد لصار المهاد يقول «مرّ» عن منظرٍ
 * أسقطته القشرة لقِدَمه.
 */
const SPIKE_WINDOW_MS = 5000;

/** دون هذا البروز لا يُمرَّر المجرى: معالجة منظر فارغ على جوال إهدارٌ محض. */
const RELAY_FLOOR = 0.08;

/** كلام الأب يمرّ دائماً ولو كان بروزه ضعيفاً: هو خطابٌ موجَّه لا محفّز عابر،
 *  كما يخترق نداء اسمك ضجيج غرفة مزدحمة. */
const TEXT_PRIVILEGE = 0.55;

export interface ThalamusState {
  /** بُعد دخل البوابة وقت الحفظ — به تُرفض أوزان بُنيت على أبعاد أخرى */
  inDim: number;
  gate: DenseState;
  /** جهود الخلايا النبضية وسجلّ إطلاقها، بترتيب MODALITIES */
  cells?: LifState[];
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
  readonly role = 'برج التوزيع: يفرز ما يصل من العين والأذن والجلد وكلامك، ويوجّه كل نوع إلى قشرته';

  private readonly net: Dense;
  /** مخزن مدخل البوابة، يُعاد استخدامه لكل كلمة كي لا تُخصَّص ذاكرة في كل نبضة */
  private readonly input: Vec = vec(GATE_IN);
  private readonly interoceptive: Vec = vec(INTERO_DIMS);
  /** نسخ مدخلات آخر بوابة وأوزانها — عليها وحدها يقع التعزيز حين يحكم الأب */
  private lastInputs: Vec[] = [];
  private lastWeights: number[] = [];

  /* الخلايا النبضية: واحدة لكل مجرى حاسّة.
   *
   * وهي الموضع الوحيد في الدماغ الذي يجري فيه الزمن فعلاً. بقية الفصوص تعمل
   * بالنبضة المنطقية (كلمةٌ من الأب = خطوة)، وهذه تعمل بالميلي ثانية الحقيقية،
   * لأن الفرق بين مؤثّرٍ خافت يُلحّ ومؤثّرٍ خافت يمرّ مرّة لا يُقاس إلا بالزمن. */
  private readonly relayCells = new LifLayer(MODALITIES.length);

  /** البذرة تُحقَن كي تكون تهيئة البوابة قابلة للإعادة، فيُثبَت التعلّم برقم. */
  constructor(rng?: Rng) {
    this.net = new Dense(GATE_IN, 1, 'sigmoid', rng ?? new Rng(0x7a1a));
    this.net.b[0] = OPEN_AT_BIRTH;
  }

  /**
   * الترشيح والتوزيع: أي حاسّة تصل قشرتها الآن وأيّها تُغلق.
   *
   * اليقظة تحدّد السعة الكلية لا كل مجرى على حدة: طفلٌ نصف نائم يصله الأبرز
   * وحده. وهذا ما يفعله المهاد في النوم فعلاً — يُغلق الحواسّ عن القشرة، ولذلك
   * لا يوقظك ضوءٌ خفيف ويوقظك اسمك.
   */
  /**
   * وصولُ حاسّةٍ في لحظتها: تُشحن بها خليتها النبضية، وتُعاد نبضتُها إن أطلقت.
   *
   * تُستدعى بمعدّل الحاسّة نفسها لا بمعدّل الكلام — العين ثلاثون مرة في الثانية.
   * وهنا يقع التكامل الزمني كلُّه: البروز الواصل شحنةٌ تُضاف إلى ما بقي من
   * سابقتها بعد تسريبه. فمنظرٌ خافت يدوم يتراكم حتى يعبر، ومنظرٌ خافت يومض مرّة
   * يتسرّب فلا يعبر. وهذا فرقٌ لم يكن الدماغ يملكه قبل هذه الخلايا: كان يقارن
   * البروز بعتبةٍ لحظةً بلحظة، فيستوي عنده المُلحّ والعابر.
   */
  excite(modality: Modality, salience: number, at: number): boolean {
    const index = MODALITIES.indexOf(modality);
    if (index < 0) return false;
    return this.relayCells.charge(index, unitValue(salience), at);
  }

  relay(streams: StreamSalience, intero: Interoception, arousal: number, at = 0): RelayDecision {
    const alertness = unitValue(arousal) * 0.7 + unitValue(intero.arousal) * 0.3;
    // النعاس يرفع العتبة: عند يقظة تامة تمرّ المجاري الضعيفة، وعند نصفها لا
    const floor = RELAY_FLOOR + (1 - alertness) * 0.35;

    /* العتبة تُضبَط من فوق قبل القراءة، وهذا هو الكبح في هذا الدماغ: لا شحنة
     * سالبة من تحت بل عتبةٌ أعلى من فوق — وهو ما يفعله المهاد في النوم حرفياً.
     * وضبطُها هنا يسري على ما يأتي من شحنات حتى النبضة التالية، لأن الانتباه
     * حالةٌ تدوم لا حكمٌ يُتّخذ لكل إطار. */
    this.relayCells.setThresholds(MODALITIES.map(
      (modality) => (modality === 'text' ? floor * 0.5 : floor),
    ));

    const passed: Record<Modality, boolean> = {
      vision: false, hearing: false, body: false, text: false,
    };
    const weights: Record<Modality, number> = { vision: 0, hearing: 0, body: 0, text: 0 };
    const rates: Record<Modality, number> = { vision: 0, hearing: 0, body: 0, text: 0 };

    let focus: Modality | 'none' = 'none';
    let strongest = -Infinity;

    const consider = (modality: Modality, salience: number | null): void => {
      if (salience === null) return; // حاسّة غائبة لا مغلقة: فرقٌ يجب ألّا يُطمس
      const index = MODALITIES.indexOf(modality);
      const cell = this.relayCells.cell(index);
      if (!cell) return;

      const value = unitValue(salience);
      const privileged = modality === 'text';
      const effective = privileged ? Math.max(value, TEXT_PRIVILEGE) : value;

      /* الكلام يُشحن هنا لأنه لا يصل إلا في النبضة: ليس له معدّلٌ خاص به كما
       * للعين والأذن والجلد، فلحظة وصوله هي لحظة النبضة نفسها. */
      if (privileged) cell.charge(effective, at);

      passed[modality] = cell.firedWithin(at, SPIKE_WINDOW_MS);
      if (!passed[modality]) return;

      rates[modality] = cell.rateHz(at, SPIKE_WINDOW_MS);
      weights[modality] = clamp(effective * (privileged ? 1 : alertness), 0, 1);
      if (weights[modality] > strongest) {
        strongest = weights[modality];
        focus = modality;
      }
    };

    consider('text', streams.text);
    consider('vision', streams.vision);
    consider('hearing', streams.hearing);
    consider('body', streams.body);

    return { passed, weights, rates, focus, reasonAr: this.explain(focus, floor, alertness) };
  }

  private explain(focus: Modality | 'none', floor: number, alertness: number): string {
    const where = {
      vision: 'ما يراه', hearing: 'ما يسمعه', body: 'ما يحسّه بجسده', text: 'كلامك',
    } as const;
    if (focus === 'none') {
      return alertness < 0.5
        ? `أغلق حواسّه: يقظته ${Math.round(alertness * 100)}٪ ولا شيء يبلغ عتبته`
        : 'لا شيء بارز في حواسّه الآن';
    }
    return `وجّه انتباهه إلى ${where[focus]} (عتبته ${floor.toFixed(2)})`;
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
    return { inDim: GATE_IN, gate: this.net.save(), cells: this.relayCells.save() };
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
      // الخلايا تُستعاد بعد البوابة وباستقلال عنها: جهدٌ محفوظ عطب لا يُسقط
      // الانتباه المتعلَّم، وأسوأ ما فيه أن تبدأ الخلايا من راحتها
      if (state.cells) this.relayCells.load(state.cells);
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
