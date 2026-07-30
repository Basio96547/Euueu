/* ————— القشرة البصرية (الفص القذالي) —————
 *
 * الخطوة الرابعة من الإدراك في مسارها البصري: تترجم إشارة الشبكية إلى **أشكال
 * وألوان وأبعاد**.
 *
 * وتُبنى هنا كما تُبنى في الدماغ، ثلاث مراحل متعاقبة لا واحدة:
 *
 * ١) الخلايا العقدية والمهاد البصري (تضادّ المركز والمحيط): كل خلية تستجيب
 *    للفرق بين مركز مجالها ومحيطه، فتُبرز الحدود وتُلغي الإضاءة المتساوية. لهذا
 *    ترى حدّ الطاولة ولا «ترى» ضوء الغرفة كشيء.
 *
 * ٢) الخلايا البسيطة في V1 (كشف الاتجاه): كل خلية تستجيب لحدٍّ بميل معيّن.
 *    وهذا أشهر اكتشاف في تشريح الإبصار: القشرة البصرية لا ترى بكسلات بل
 *    **خطوطاً بميول**.
 *
 * ٣) الخلايا المركّبة (التجميع): تجمع استجابات البسيطة على منطقة، فتُبقي «يوجد
 *    حدّ مائل هنا» وتُسقط «في أي بكسل بالضبط». وبهذا يُعرَف الشيء ولو تحرّك
 *    قليلاً أو تغيّر حجمه — وبلا هذه المرحلة يصير كل إزاحة شيئاً جديداً.
 *
 * والقاعدة: هذا الفص لا يعرف أسماء الأشياء ولا معانيها. يُخرج وصفاً هندسياً
 * فقط. الاسمُ شأن التعرّف الذي يليه.
 */

import { SENSE_DIMS, type RetinaSignal } from '../core/senses.js';
import { clamp, normalized, vec, type Vec } from '../core/tensor.js';
import type { Lobe } from '../core/types.js';

/** عدد الميول التي تُكشف: أفقي، ومائل يميناً، ورأسي، ومائل يساراً. */
export const ORIENTATIONS = 4;

/** شبكة التجميع: ثلاث مناطق في كل بُعد — يمين ووسط ويسار، وأعلى ووسط وأسفل. */
const POOL = 3;

/** شبكة اللون أخشن: اللون خصيصة عامة للشيء لا تفصيلٌ موضعيّ. */
const COLOR_POOL = 2;

/**
 * طول الوصف البصري: ٦٤ بُعداً موزّعة بترتيب معلن ثابت.
 *
 *   [0..35]   طاقة الميول: ٤ ميول × ٩ مناطق
 *   [36..47]  اللون: ٣ قنوات × ٤ مناطق
 *   [48..59]  خصائص عامة: سطوع، تضادّ، لونان، كثافة حدود، امتلاء،
 *             مركز الثقل (س، ص)، الانتشار (س، ص)، النسبة، التناظر
 *   [60..63]  الحركة: طاقة اختلاف الإطار في ٤ مناطق
 *
 * الترتيب لا يجوز أن يتغيّر بعد أن يتعلّم زبير: ذاكرة الأشياء تُقارن عليه.
 */
export const VISION_FEATURES = ORIENTATIONS * POOL * POOL + 3 * COLOR_POOL * COLOR_POOL + 12 + 4;

export interface VisualPercept {
  /** الوصف الهندسي مُسوّى الطول — التسوية تُذهب أثر الإضاءة الكلية */
  features: Vec;
  /** مقدار الحركة بين هذا الإطار وسابقه */
  motion: number;
  /** بروز المنظر: كم فيه من حدود وتضادّ. المنظر الفارغ لا يستحقّ انتباهاً */
  salience: number;
  /** أهو مشهد مظلم لا يُرى فيه شيء؟ */
  dark: boolean;
}

export interface VisualCortexState {
  /** عدد الأنظار — لا أوزان: هذا الفص مُوَلَّد لا متعلَّم، انظر أسفل الملف */
  glances: number;
}

export class VisualCortex implements Lobe<VisualCortexState> {
  readonly name = 'visualCortex';
  readonly ar = 'القشرة البصرية';
  readonly role = 'يترجم ما تلتقطه الكاميرا إلى أشكال وألوان وأبعاد وحركة';

  /** مرشّحات الميول، تُبنى مرة واحدة في الباني ولا تتغيّر */
  private readonly gabor: Float32Array[] = [];
  private readonly kernelSize = 5;

  private previous: Float32Array | null = null;
  private glances = 0;

  constructor() {
    for (let o = 0; o < ORIENTATIONS; o++) {
      this.gabor.push(this.buildGabor((o * Math.PI) / ORIENTATIONS));
    }
  }

  /**
   * مرشّح غابور: جيبٌ مضروب في غلاف غاوسي.
   *
   * هذا الشكل ليس اختياراً جمالياً: قياس استجابة الخلايا البسيطة في القشرة
   * البصرية أظهر أنها تُوصَف بهذه الدالة بدقّة. ولذلك نستعملها بدل مرشّح حدود
   * عام — نحاكي الخلية لا نُقارب وظيفتها.
   */
  private buildGabor(theta: number): Float32Array {
    const size = this.kernelSize;
    const half = (size - 1) / 2;
    const sigma = 1.6;
    const lambda = 3.2;
    const kernel = new Float32Array(size * size);
    let sum = 0;

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = x - half;
        const dy = y - half;
        const xr = dx * Math.cos(theta) + dy * Math.sin(theta);
        const yr = -dx * Math.sin(theta) + dy * Math.cos(theta);
        const value = Math.exp(-(xr * xr + yr * yr) / (2 * sigma * sigma))
          * Math.cos((2 * Math.PI * xr) / lambda);
        kernel[y * size + x] = value;
        sum += value;
      }
    }

    // تصفير المجموع: مرشّح مجموعه غير صفري يستجيب للسطوع الكلي لا للحدّ، فيصير
    // كشف الاتجاه تابعاً لإضاءة الغرفة
    const mean = sum / kernel.length;
    for (let i = 0; i < kernel.length; i++) kernel[i]! -= mean;
    return kernel;
  }

  /** تضادّ المركز والمحيط: فرق غاوسيّين — أوّل ما يفعله الجهاز البصري. */
  private centerSurround(input: Float32Array, size: number): Float32Array {
    const out = new Float32Array(size * size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const center = input[y * size + x] ?? 0;
        let surround = 0;
        let n = 0;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            if (dx === 0 && dy === 0) continue;
            const yy = y + dy;
            const xx = x + dx;
            if (yy < 0 || xx < 0 || yy >= size || xx >= size) continue;
            surround += input[yy * size + xx] ?? 0;
            n++;
          }
        }
        out[y * size + x] = center - (n > 0 ? surround / n : 0);
      }
    }
    return out;
  }

  /** التفاف مرشّح واحد على الخريطة، بحدود مُثبَّتة على أقرب بكسل. */
  private convolve(input: Float32Array, size: number, kernel: Float32Array): Float32Array {
    const out = new Float32Array(size * size);
    const half = (this.kernelSize - 1) / 2;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let sum = 0;
        for (let ky = 0; ky < this.kernelSize; ky++) {
          const yy = clampIndex(y + ky - half, size);
          for (let kx = 0; kx < this.kernelSize; kx++) {
            const xx = clampIndex(x + kx - half, size);
            sum += (input[yy * size + xx] ?? 0) * (kernel[ky * this.kernelSize + kx] ?? 0);
          }
        }
        // التقويم: الخلية البسيطة لا تُطلق بإشارة سالبة، بل تُطلق بشدّة الاستجابة
        out[y * size + x] = Math.abs(sum);
      }
    }
    return out;
  }

  /** تجميع بالمتوسّط على شبكة — مرحلة الخلايا المركّبة. */
  private pool(map: Float32Array, size: number, grid: number, out: Vec, offset: number): void {
    const cell = size / grid;
    for (let gy = 0; gy < grid; gy++) {
      for (let gx = 0; gx < grid; gx++) {
        let sum = 0;
        let n = 0;
        const y0 = Math.floor(gy * cell);
        const y1 = Math.max(y0 + 1, Math.floor((gy + 1) * cell));
        const x0 = Math.floor(gx * cell);
        const x1 = Math.max(x0 + 1, Math.floor((gx + 1) * cell));
        for (let y = y0; y < y1 && y < size; y++) {
          for (let x = x0; x < x1 && x < size; x++) {
            sum += map[y * size + x] ?? 0;
            n++;
          }
        }
        out[offset + gy * grid + gx] = n > 0 ? sum / n : 0;
      }
    }
  }

  /** النظر: من إشارة الشبكية إلى وصف هندسي. */
  see(retina: RetinaSignal): VisualPercept {
    this.glances++;
    const size = retina.size || SENSE_DIMS.retina;
    const features = vec(VISION_FEATURES);

    const edges = this.centerSurround(retina.luminance, size);

    // ١. طاقة الميول
    let edgeEnergy = 0;
    for (let o = 0; o < ORIENTATIONS; o++) {
      const response = this.convolve(edges, size, this.gabor[o]!);
      this.pool(response, size, POOL, features, o * POOL * POOL);
      for (let i = 0; i < response.length; i++) edgeEnergy += response[i]!;
    }
    edgeEnergy /= ORIENTATIONS * size * size;

    // ٢. اللون على شبكة أخشن
    const colorBase = ORIENTATIONS * POOL * POOL;
    this.pool(retina.luminance, size, COLOR_POOL, features, colorBase);
    this.pool(retina.redGreen, size, COLOR_POOL, features, colorBase + COLOR_POOL * COLOR_POOL);
    this.pool(retina.blueYellow, size, COLOR_POOL, features, colorBase + 2 * COLOR_POOL * COLOR_POOL);

    // ٣. خصائص عامة: أبعاد الشيء وموضعه — «الأبعاد» في وصف الإدراك
    const globalBase = colorBase + 3 * COLOR_POOL * COLOR_POOL;
    const stats = this.describeShape(retina, edges, size);
    for (let i = 0; i < stats.length && i < 12; i++) features[globalBase + i] = stats[i]!;

    // ٤. الحركة: فرق هذا الإطار عن سابقه — وهذا مسار مستقلّ في الدماغ (الظهري)
    const motionBase = globalBase + 12;
    let motion = 0;
    if (this.previous && this.previous.length === retina.luminance.length) {
      const diff = new Float32Array(size * size);
      for (let i = 0; i < diff.length; i++) {
        diff[i] = Math.abs((retina.luminance[i] ?? 0) - (this.previous[i] ?? 0));
        motion += diff[i]!;
      }
      motion /= diff.length;
      this.pool(diff, size, COLOR_POOL, features, motionBase);
    }
    this.previous = retina.luminance.slice();

    /* التسوية بعد كل شيء: تُذهب أثر الإضاءة الكلية فيبقى **الشكل**. بلا هذه
     * الخطوة يصير الشيء نفسه في غرفة مظلمة شيئاً آخر عند زبير. */
    const description = normalized(features);

    const meanLuminance = stats[0] ?? 0;
    return {
      features: description,
      motion: clamp(motion * 4, 0, 1),
      salience: clamp(edgeEnergy * 6 + (stats[1] ?? 0), 0, 1),
      dark: meanLuminance < 0.06,
    };
  }

  /** أبعاد الشيء: امتلاؤه وموضعه وانتشاره ونسبته وتناظره. */
  private describeShape(retina: RetinaSignal, edges: Float32Array, size: number): number[] {
    let sum = 0;
    let sumSquares = 0;
    let mass = 0;
    let cx = 0;
    let cy = 0;

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const l = retina.luminance[y * size + x] ?? 0;
        sum += l;
        sumSquares += l * l;
        const strength = Math.abs(edges[y * size + x] ?? 0);
        mass += strength;
        cx += strength * x;
        cy += strength * y;
      }
    }

    const count = size * size;
    const mean = sum / count;
    const variance = Math.max(0, sumSquares / count - mean * mean);
    const contrast = Math.sqrt(variance);

    // مركز ثقل الحدود: أين الشيء في المنظر — يسار أم يمين، أعلى أم أسفل
    const centroidX = mass > 1e-6 ? cx / mass / (size - 1) : 0.5;
    const centroidY = mass > 1e-6 ? cy / mass / (size - 1) : 0.5;

    let spreadX = 0;
    let spreadY = 0;
    let leftMass = 0;
    let rightMass = 0;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const strength = Math.abs(edges[y * size + x] ?? 0);
        const nx = x / (size - 1);
        const ny = y / (size - 1);
        spreadX += strength * (nx - centroidX) ** 2;
        spreadY += strength * (ny - centroidY) ** 2;
        if (nx < 0.5) leftMass += strength;
        else rightMass += strength;
      }
    }
    spreadX = mass > 1e-6 ? Math.sqrt(spreadX / mass) : 0;
    spreadY = mass > 1e-6 ? Math.sqrt(spreadY / mass) : 0;

    // نسبة الشيء: أعرض أم أطول. والتناظر: هل شقّاه متشابهان
    const aspect = spreadY > 1e-6 ? clamp(spreadX / spreadY, 0, 3) / 3 : 0.5;
    const total = leftMass + rightMass;
    const symmetry = total > 1e-6 ? 1 - Math.abs(leftMass - rightMass) / total : 1;

    let redGreenMean = 0;
    let blueYellowMean = 0;
    for (let i = 0; i < count; i++) {
      redGreenMean += retina.redGreen[i] ?? 0;
      blueYellowMean += retina.blueYellow[i] ?? 0;
    }

    return [
      mean, contrast, redGreenMean / count, blueYellowMean / count,
      clamp(mass / count * 4, 0, 1), clamp(mean * 1.2, 0, 1),
      centroidX, centroidY, spreadX, spreadY, aspect, symmetry,
    ];
  }

  get glanceCount(): number {
    return this.glances;
  }

  /* هذا الفص مُوَلَّد لا متعلَّم: مرشّحاته مبنيّة من دالة غابور لا مُدرَّبة على
   * بيانات. وهذا موافق لتشريحه: بنية V1 تنمو قبل أن يرى الوليد شيئاً، والتعلّم
   * يقع في الطبقات التي بعدها لا فيها. فلا شيء يُحفَظ منه إلا عدد أنظاره. */
  save(): VisualCortexState {
    return { glances: this.glances };
  }

  load(state: VisualCortexState): void {
    try {
      if (typeof state?.glances === 'number' && Number.isFinite(state.glances)) {
        this.glances = Math.max(0, Math.floor(state.glances));
      }
    } catch { /* لا أثر: الفص لا يحمل معرفة تُفقَد */ }
  }
}

function clampIndex(value: number, size: number): number {
  return value < 0 ? 0 : value >= size ? size - 1 : value;
}
