/* ————— العتاد: أين يفكّر زبير فعلاً —————
 *
 * طُلب أن يعمل دماغه على المعالج العصبي (NPU) لا على المعالج العادي. أربع
 * حقائق يجب أن يعبّر عنها الكود بصدق، لا أن يخفيها:
 *
 * ١. الـNPU محرّك استنتاج لا محرّك تعلّم. ينفّذ رسماً ثابتاً من عمليات مكمَّمة
 *    ولا يُجري انتشاراً خلفياً. فدماغ يتعلّم لا يمكن أن يكون كله عليه — وهذه
 *    حدود العتاد لا حدود البناء.
 * ٢. مصفوفات زبير صغيرة (٦٤×٦٤). كلفة إرسال مصفوفة بهذا الصغر إلى المعالج
 *    العصبي أكبر من كلفة حسابها محلياً، فلا ربح في تمريرها إليه. الزعم بغير
 *    ذلك زعم باطل.
 * ٣. العملية الوحيدة التي تستحقّه فعلاً هي البحث في الذاكرة: معنى واحد يُقارَن
 *    بآلاف الذكريات في عملية واحدة. ولذلك هي وحدها تمرّ من هنا.
 * ٤. دعم WebNN على الجوال اليوم تجريبي ومحدود، ويحتاج في أغلب المتصفّحات
 *    تمكيناً يدوياً. فالسقوط إلى المعالج العادي هو الحال الغالب — ويُعلَن
 *    للأب صريحاً، ولا يُسمّى المعالج العادي معالجاً عصبياً بحال.
 */

import { matvec, reluInto, sigmoidInto, tanhInto, vec, type Vec } from './tensor.js';
import type { Accelerator, ComputePort, ComputeUnit } from './types.js';

/** أدنى عدد ذكريات يستحقّ إرسال البحث إلى المسرّع.
 *  تحت هذا العدد يكون الحساب المحلي أسرع من كلفة نقل البيانات، فلا يُرسَل. */
const ACCEL_MIN_KEYS = 256;

/** لا يُعاد بناء رسم WebNN إلا إذا تغيّر عدد الذكريات بهذه النسبة:
 *  بناء الرسم أغلى من تنفيذه بمراتب، فإعادته في كل نبضة تُبطل الفائدة كلها. */
const REBUILD_RATIO = 1.35;

/** نواتنا على المعالج العادي — لا مكتبة، ولا تسريع مزعوم. */
export function cpuCompute(): ComputePort {
  const scratch = new Map<number, Vec>();
  const buffer = (n: number): Vec => {
    let existing = scratch.get(n);
    if (!existing) {
      existing = vec(n);
      scratch.set(n, existing);
    }
    return existing;
  };

  return {
    unit: 'cpu',
    describeAr: 'يفكّر على معالج جهازك العادي',

    dense(x, w, b, inDim, outDim, activation) {
      const out = buffer(outDim);
      matvec(out, x, w, inDim, outDim);
      if (b) for (let j = 0; j < outDim; j++) out[j]! += b[j]!;
      switch (activation) {
        case 'tanh': tanhInto(out); break;
        case 'sigmoid': sigmoidInto(out); break;
        case 'relu': reluInto(out); break;
        case 'none': break;
      }
      return out;
    },

    /** المفاتيح والاستفهام يصلان مُسوَّيي الطول من الحُصين، فالتشابه الجيبي
     *  يساوي الضرب الداخلي مباشرة بلا قسمة في كل مقارنة. هذا ما يجعل البحث في
     *  أربعة آلاف ذكرى ممكناً على جوال متوسط. */
    similarities(query, keys, count, dim) {
      const out = vec(count);
      for (let i = 0; i < count; i++) {
        const base = i * dim;
        let sum = 0;
        for (let d = 0; d < dim; d++) sum += query[d]! * keys[base + d]!;
        out[i] = sum;
      }
      return out;
    },
  };
}

/* ————— واجهة WebNN كما تُعرَّف في المتصفّح —————
 * نُعرّفها بأنفسنا لأنها تجريبية وليست في تعريفات TypeScript القياسية، ولأن
 * إضافة حزمة تعريفات لواجهة قد تتغيّر غداً كلفة بلا مقابل. */
interface MlOperand { readonly __brand?: 'MLOperand' }

interface MlGraphBuilder {
  input(name: string, descriptor: { dataType: 'float32'; shape: number[] }): MlOperand;
  constant(descriptor: { dataType: 'float32'; shape: number[] }, buffer: Float32Array): MlOperand;
  matmul(a: MlOperand, b: MlOperand): MlOperand;
  build(outputs: Record<string, MlOperand>): Promise<MlGraph>;
}

interface MlGraph { readonly __brand?: 'MLGraph' }

interface MlContext {
  compute(
    graph: MlGraph,
    inputs: Record<string, Float32Array>,
    outputs: Record<string, Float32Array>,
  ): Promise<{ outputs: Record<string, Float32Array> }>;
}

interface MlNamespace {
  createContext(options?: { deviceType?: 'npu' | 'gpu' | 'cpu' }): Promise<MlContext>;
}

function mlNamespace(): MlNamespace | null {
  try {
    const nav = (globalThis as { navigator?: { ml?: MlNamespace } }).navigator;
    return nav?.ml ?? null;
  } catch {
    return null;
  }
}

function graphBuilderCtor(): (new (context: MlContext) => MlGraphBuilder) | null {
  try {
    const ctor = (globalThis as { MLGraphBuilder?: new (context: MlContext) => MlGraphBuilder }).MLGraphBuilder;
    return ctor ?? null;
  } catch {
    return null;
  }
}

/** مسرّع على المعالج العادي — الحال الغالب، ويقول عن نفسه الحقيقة. */
function cpuAccelerator(reason: string): Accelerator {
  const compute = cpuCompute();
  return {
    unit: 'cpu',
    describeAr: 'يفكّر على معالج جهازك العادي — لا معالج عصبي متاح',
    details: reason,
    async similarities(query, keys, count, dim) {
      return compute.similarities(query, keys, count, dim);
    },
    dispose() {},
  };
}

/**
 * يحاول المعالج العصبي أولاً، ثم بطاقة الرسوميات، ثم يسقط إلى المعالج العادي.
 *
 * كل خطوة ملفوفة بحراسة: واجهة WebNN تجريبية ومتغيّرة، وسقوطها لا يجوز أن
 * يُسقط دماغ زبير. والسقوط معلن دائماً في describeAr وdetails.
 */
export async function bestAccelerator(): Promise<Accelerator> {
  const ml = mlNamespace();
  if (!ml) return cpuAccelerator('لا واجهة WebNN في هذه البيئة');

  const BuilderCtor = graphBuilderCtor();
  if (!BuilderCtor) return cpuAccelerator('واجهة WebNN موجودة لكن باني الرسوم غائب');

  for (const deviceType of ['npu', 'gpu'] as const) {
    try {
      const context = await ml.createContext({ deviceType });
      if (!context) continue;
      return webnnAccelerator(context, BuilderCtor, deviceType);
    } catch {
      // جهاز غير متاح أو صلاحية مرفوضة: نجرّب التالي بهدوء
    }
  }

  return cpuAccelerator('واجهة WebNN موجودة لكن لا جهاز npu ولا gpu متاح لها');
}

function webnnAccelerator(
  context: MlContext,
  BuilderCtor: new (context: MlContext) => MlGraphBuilder,
  deviceType: 'npu' | 'gpu',
): Accelerator {
  const fallback = cpuCompute();
  const unit: ComputeUnit = deviceType === 'npu' ? 'npu' : 'gpu';

  /* الرسم المبني محفوظ: البحث يتكرّر في كل نبضة، والبناء أغلى من التنفيذ
   * بمراتب. يُعاد البناء فقط حين تنمو الذكريات نمواً معتبراً (REBUILD_RATIO)
   * لا مع كل ذكرى جديدة. */
  let graph: MlGraph | null = null;
  let graphKeys = 0;
  let graphDim = 0;
  let keysBuffer: Float32Array | null = null;
  let rebuilds = 0;
  let dispatched = 0;
  let fellBack = 0;

  const describe = deviceType === 'npu'
    ? 'يفكّر على المعالج العصبي في جهازك (NPU)'
    : 'يفكّر على بطاقة الرسوميات في جهازك (GPU)';

  return {
    unit,
    describeAr: describe,
    get details() {
      return `WebNN/${deviceType} — بُني الرسم ${rebuilds} مرة، ونُفِّذ ${dispatched} بحثاً`
        + (fellBack > 0 ? `، وسقط ${fellBack} مرة إلى المعالج العادي` : '')
        + `. البحث وحده يمرّ من هنا؛ باقي الحساب محلي لأن مصفوفاته أصغر من أن تربح بالإرسال.`;
    },

    async similarities(query, keys, count, dim) {
      // ذكريات قليلة: النقل أغلى من الحساب، فلا يُرسَل شيء
      if (count < ACCEL_MIN_KEYS) return fallback.similarities(query, keys, count, dim);

      try {
        const needsRebuild =
          graph === null || dim !== graphDim || count > graphKeys || count * REBUILD_RATIO < graphKeys;

        if (needsRebuild) {
          // نبني بسعة أوسع من الحاجة كي تستوعب نمو الذكريات بلا إعادة بناء
          graphKeys = Math.max(ACCEL_MIN_KEYS, Math.ceil(count * REBUILD_RATIO));
          graphDim = dim;
          keysBuffer = new Float32Array(graphKeys * dim);
          const builder = new BuilderCtor(context);
          const keysOperand = builder.input('keys', { dataType: 'float32', shape: [graphKeys, dim] });
          const queryOperand = builder.input('query', { dataType: 'float32', shape: [dim, 1] });
          graph = await builder.build({ scores: builder.matmul(keysOperand, queryOperand) });
          rebuilds++;
        }

        const buffer = keysBuffer;
        if (!graph || !buffer) return fallback.similarities(query, keys, count, dim);

        // الحشو أصفار: صفوف زائدة تُعطي تشابهاً صفرياً ثم تُقصّ عند القراءة
        buffer.fill(0);
        buffer.set(keys.subarray(0, count * dim));
        const queryInput = new Float32Array(dim);
        queryInput.set(query.subarray(0, dim));
        const scores = new Float32Array(graphKeys);

        const result = await context.compute(
          graph,
          { keys: buffer, query: queryInput },
          { scores },
        );
        const produced = result.outputs['scores'] ?? scores;
        dispatched++;
        return produced.subarray(0, count) as Vec;
      } catch {
        // أي فشل في الواجهة التجريبية يسقط إلى الحساب المحلي بلا ضجيج،
        // ويُحصى في details كي يرى الأب أن المسرّع لا يعمل فعلاً
        fellBack++;
        graph = null;
        return fallback.similarities(query, keys, count, dim);
      }
    },

    dispose() {
      graph = null;
      keysBuffer = null;
    },
  };
}

/** وصف صادق للعرض في التطبيق. */
export function accelReport(a: Accelerator): { unit: ComputeUnit; describeAr: string; details: string } {
  return { unit: a.unit, describeAr: a.describeAr, details: a.details };
}
