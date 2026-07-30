/* ————— الحواسّ: الالتقاط والتحويل العصبي —————
 *
 * الخطوتان الأولى والثانية من الإدراك.
 *
 * ١) الالتقاط: العين تلتقط موجات الضوء، والأذن اهتزازات الهواء، والجلد الضغط.
 *    وفي جوالك: الكاميرا والميكروفون والشاشة ومقياس التسارع.
 *
 * ٢) التحويل (Transduction): الدماغ لا يفهم الضوء ولا الصوت في صورتهما الخام.
 *    فالمستقبلات الحسية تحوّلها إلى إشارات كهربائية — وهنا نحوّل البكسلات
 *    والموجات إلى أرقام في المدى نفسه الذي تفهمه بقية الفصوص.
 *
 * والقاعدة الحاكمة في هذا الملف: **لا تفسير هنا**. التحويل ينقل ولا يفهم، كما
 * أن العصب البصري ينقل ولا يرى. التفسير شأن القشرة المختصّة في الفصوص.
 *
 * وحدّان يجب أن يُقالا: الجوال لا يملك مستقبلات كيميائية، فلا شمّ ولا ذوق —
 * حاسّتان من الخمس تبقيان غائبتين ولا بديل لهما يُزعَم. والأذن هنا تسمع الصوت
 * لا الكلام: علوّه ونبرته وإيقاعه، لا حروفه.
 */

import { clamp, type Vec } from './tensor.js';

/* ————— أبعاد الحواسّ ————— */
export const SENSE_DIMS = {
  /** شبكية مصغّرة: ٣٢×٣٢ خلية. العين البشرية أدقّ بملايين المرات، لكن هذا
   *  القدر يكفي لتمييز شكل ولون على جوال متوسط بلا أن تتجمّد الواجهة. */
  retina: 32,
  /** عدد نطاقات القوقعة: كل نطاق خلايا شعرية تستجيب لمدى تردّدي واحد */
  cochlea: 24,
  /** أبعاد الحسّ الجسدي: موضع اللمس وضغطه ومدّته، والحركة، والضوء المحيط */
  body: 8,
} as const;

/* ————— ما يصل من الحواسّ خاماً ————— */

/** إطار من الكاميرا كما يعطيه المتصفّح: أربع قنوات لكل بكسل. */
export interface RawFrame {
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
}

/** مقطع من الميكروفون: عيّنات في [-1,1] ومعدّل أخذها. */
export interface RawAudio {
  sampleRate: number;
  samples: Float32Array;
}

/** لمسة على الشاشة: الموضع معياريٌّ في [0,1] كي لا يتغيّر المعنى بحجم الشاشة. */
export interface RawTouch {
  x: number;
  y: number;
  /** ضغط الإصبع إن أخبر به المتصفّح، وإلا فمساحة التلامس تقوم مقامه */
  force: number;
  /** مدّة الملامسة بالميلي ثانية */
  durationMs: number;
}

/** حركة الجهاز وضوء محيطه. */
export interface RawBody {
  /** تسارع الجهاز في المحاور الثلاثة (م/ث²) */
  accel: readonly [number, number, number];
  /** ضوء محيط بالـlux إن توفّر المستقبل */
  lux: number | null;
}

/* ————— ما يخرج بعد التحويل ————— */

/**
 * إشارة الشبكية: ثلاث قنوات مفصولة كما تفصلها الشبكية الحقيقية.
 *
 * الشبكية لا تُرسل «صورة ملوّنة» إلى الدماغ، بل ترسل تضادّات: خلايا تستجيب
 * للأحمر ضدّ الأخضر، وأخرى للأزرق ضدّ الأصفر، وأخرى للسطوع وحده. هذا هو
 * «تضادّ الألوان» (color opponency)، وهو سبب أنك لا ترى أحمر مُخضِرّاً أبداً.
 * نحاكيه لأنه يجعل التمييز بين شيئين مختلفي اللون أقوى بكثير من قنوات RGB خاماً.
 */
export interface RetinaSignal {
  size: number;
  /** السطوع: من الخلايا المستجيبة للضوء بلا لون (كالعصيّات) */
  luminance: Float32Array;
  /** أحمر ضدّ أخضر: موجب أحمر، سالب أخضر */
  redGreen: Float32Array;
  /** أزرق ضدّ أصفر */
  blueYellow: Float32Array;
}

/** إشارة القوقعة: طاقة كل نطاق تردّدي، وعلوّ الصوت، وحدّة بدايته. */
export interface CochlearSignal {
  /** طاقة النطاقات مرتّبة من الأدنى تردّداً إلى الأعلى */
  bands: Float32Array;
  /** علوّ الصوت الكلي (جذر متوسط المربّعات، مُسوّى) */
  loudness: number;
  /** تردّد الأساس المقدَّر إن كان الصوت نغميّاً، وإلا null */
  pitchHz: number | null;
}

/** إشارة الجسد: متجه واحد بترتيب معلن ثابت. */
export interface BodySignal {
  values: Vec;
  /** أهناك لمسة الآن؟ */
  touched: boolean;
  /** مقدار الحركة: الجهاز ساكن أم يُهَزّ */
  motion: number;
}

/* ————— تحويل الضوء ————— */

/**
 * يحوّل إطار الكاميرا إلى إشارة شبكية.
 *
 * التصغير بالمتوسّط لا بالقفز: أخذ بكسل واحد من كل منطقة يُدخل ضجيجاً عالي
 * التردّد يُربك كشف الحدود بعده، والمتوسّط هو ما تفعله الخلايا العقدية فعلاً
 * إذ تجمع من عدة مستقبلات.
 */
export function transduceVision(frame: RawFrame, size = SENSE_DIMS.retina): RetinaSignal {
  const luminance = new Float32Array(size * size);
  const redGreen = new Float32Array(size * size);
  const blueYellow = new Float32Array(size * size);

  if (frame.width <= 0 || frame.height <= 0 || frame.rgba.length < 4) {
    return { size, luminance, redGreen, blueYellow };
  }

  const cellW = frame.width / size;
  const cellH = frame.height / size;

  for (let gy = 0; gy < size; gy++) {
    const y0 = Math.floor(gy * cellH);
    const y1 = Math.max(y0 + 1, Math.floor((gy + 1) * cellH));
    for (let gx = 0; gx < size; gx++) {
      const x0 = Math.floor(gx * cellW);
      const x1 = Math.max(x0 + 1, Math.floor((gx + 1) * cellW));

      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let y = y0; y < y1 && y < frame.height; y++) {
        for (let x = x0; x < x1 && x < frame.width; x++) {
          const i = (y * frame.width + x) * 4;
          r += frame.rgba[i] ?? 0;
          g += frame.rgba[i + 1] ?? 0;
          b += frame.rgba[i + 2] ?? 0;
          n++;
        }
      }
      if (n === 0) continue;
      r /= n * 255;
      g /= n * 255;
      b /= n * 255;

      const index = gy * size + gx;
      /* أوزان السطوع ليست متساوية: العين أحسّ للأخضر منها للأزرق بكثير، وهذه
       * الأوزان (0.299/0.587/0.114) هي المقيسة على الحسّ البشري. */
      luminance[index] = 0.299 * r + 0.587 * g + 0.114 * b;
      redGreen[index] = r - g;
      blueYellow[index] = b - (r + g) * 0.5;
    }
  }

  return { size, luminance, redGreen, blueYellow };
}

/* ————— تحويل الصوت ————— */

/**
 * تحويل فورييه المنفصل بطريقة كولي–توكي (radix-2)، مكتوب بيدنا.
 *
 * لماذا نحتاجه: القوقعة في أذنك محلّل تردّدات فيزيائي — غشاؤها القاعدي يهتزّ
 * عند مواضع مختلفة بترددات مختلفة، فتُخرج للدماغ «طاقة كل تردّد» لا الموجة
 * الخام. فلا مفرّ من تحليل تردّدي إن أردنا أذناً لا ميكروفوناً.
 *
 * يعمل في مكانه على مصفوفتي الحقيقي والتخيّلي، وطول المدخل يجب أن يكون قوّة
 * للعدد اثنين.
 */
export function fft(real: Float32Array, imag: Float32Array): void {
  const n = real.length;
  if (n <= 1 || (n & (n - 1)) !== 0) return;

  // إعادة ترتيب البتات المعكوسة: بها يصير التحويل في مكانه بلا ذاكرة إضافية
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = real[i]!;
      real[i] = real[j]!;
      real[j] = tr;
      const ti = imag[i]!;
      imag[i] = imag[j]!;
      imag[j] = ti;
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len;
    const wR = Math.cos(angle);
    const wI = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let curR = 1;
      let curI = 0;
      for (let k = 0; k < len / 2; k++) {
        const aR = real[i + k]!;
        const aI = imag[i + k]!;
        const bR = real[i + k + len / 2]!;
        const bI = imag[i + k + len / 2]!;
        const tR = bR * curR - bI * curI;
        const tI = bR * curI + bI * curR;
        real[i + k] = aR + tR;
        imag[i + k] = aI + tI;
        real[i + k + len / 2] = aR - tR;
        imag[i + k + len / 2] = aI - tI;
        const nextR = curR * wR - curI * wI;
        curI = curR * wI + curI * wR;
        curR = nextR;
      }
    }
  }
}

/** أكبر قوّة للعدد اثنين لا تتجاوز n — لأن التحويل يشترطها. */
function floorPow2(n: number): number {
  let p = 1;
  while (p * 2 <= n) p *= 2;
  return p;
}

/**
 * حدود نطاقات القوقعة على مقياس mel.
 *
 * التوزيع ليس متساوياً بقصد: أذنك تفرّق بين ٢٠٠ و٣٠٠ هرتز بسهولة، ولا تكاد
 * تفرّق بين ٨٠٠٠ و٨١٠٠. فالنطاقات المنخفضة ضيّقة والعالية واسعة، وهذا ما
 * يصفه مقياس mel، وهو مقيس على الحسّ البشري لا مُقدَّر.
 */
function melBands(count: number, sampleRate: number, fftSize: number): number[] {
  const toMel = (hz: number): number => 2595 * Math.log10(1 + hz / 700);
  const fromMel = (mel: number): number => 700 * (10 ** (mel / 2595) - 1);

  const lowHz = 60; // دون هذا ضجيج المبنى لا صوت
  const highHz = Math.min(8000, sampleRate / 2);
  const lowMel = toMel(lowHz);
  const highMel = toMel(highHz);

  const edges: number[] = [];
  for (let i = 0; i <= count; i++) {
    const mel = lowMel + ((highMel - lowMel) * i) / count;
    const hz = fromMel(mel);
    edges.push(Math.min(fftSize / 2 - 1, Math.round((hz * fftSize) / sampleRate)));
  }
  return edges;
}

/** يحوّل مقطعاً صوتياً إلى إشارة قوقعة: طاقة النطاقات وعلوّ الصوت ونغمته. */
export function transduceAudio(audio: RawAudio, bandCount = SENSE_DIMS.cochlea): CochlearSignal {
  const bands = new Float32Array(bandCount);
  const samples = audio.samples;
  if (!samples || samples.length < 32 || !(audio.sampleRate > 0)) {
    return { bands, loudness: 0, pitchHz: null };
  }

  // علوّ الصوت: جذر متوسط المربّعات — وهو ما يقابل الإحساس بالعلوّ لا القمة
  let sumSquares = 0;
  for (let i = 0; i < samples.length; i++) sumSquares += samples[i]! * samples[i]!;
  const rms = Math.sqrt(sumSquares / samples.length);

  const size = floorPow2(Math.min(samples.length, 2048));
  const real = new Float32Array(size);
  const imag = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    /* نافذة هان قبل التحويل: قطع المقطع فجأةً يُدخل ترددات كاذبة لا وجود لها في
     * الصوت (انفلات طيفي)، فتُسمَع حدودُ المقطع نفسها كصوت. */
    const window = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1));
    real[i] = samples[i]! * window;
  }
  fft(real, imag);

  const edges = melBands(bandCount, audio.sampleRate, size);
  for (let band = 0; band < bandCount; band++) {
    const from = edges[band] ?? 0;
    const to = Math.max(from + 1, edges[band + 1] ?? from + 1);
    let energy = 0;
    for (let bin = from; bin < to; bin++) {
      const re = real[bin] ?? 0;
      const im = imag[bin] ?? 0;
      energy += re * re + im * im;
    }
    /* لوغاريتم الطاقة لا الطاقة: الإحساس بالعلوّ لوغاريتمي (ولذلك يُقاس
     * بالديسيبل)، وبلا اللوغاريتم يُغطّي نطاقٌ واحد قويّ على البقية كلها. */
    bands[band] = clamp(Math.log10(1 + energy / (to - from)) / 3, 0, 1);
  }

  return { bands, loudness: clamp(rms * 4, 0, 1), pitchHz: estimatePitch(samples, audio.sampleRate) };
}

/**
 * تقدير تردّد الأساس بالارتباط الذاتي.
 *
 * الطريقة: نُزيح الموجة على نفسها ونبحث عن الإزاحة التي تُعيد أكبر تشابه — تلك
 * هي دورة الموجة. أبسط من استخراج النغمة من الطيف وأمتن على الأصوات البشرية،
 * وتُعيد null للصوت غير النغمي (تصفيق، ضجيج) لأنه لا نغمة له تُقدَّر.
 */
function estimatePitch(samples: Float32Array, sampleRate: number): number | null {
  // مدى الصوت البشري: ٦٥–٤٠٠ هرتز يغطّي الرجال والنساء والأطفال
  const minLag = Math.floor(sampleRate / 400);
  const maxLag = Math.floor(sampleRate / 65);
  if (samples.length < maxLag * 2) return null;

  let zeroLagEnergy = 0;
  for (let i = 0; i < maxLag; i++) zeroLagEnergy += samples[i]! * samples[i]!;
  if (zeroLagEnergy < 1e-6) return null;

  const scores = new Float32Array(maxLag + 1);
  let bestScore = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    for (let i = 0; i + lag < samples.length && i < maxLag; i++) {
      sum += samples[i]! * samples[i + lag]!;
    }
    scores[lag] = sum;
    if (sum > bestScore) bestScore = sum;
  }

  // عتبة الثقة: ارتباط أدنى من نصف طاقة الإزاحة الصفرية ليس نغمة بل مصادفة
  if (bestScore < zeroLagEnergy * 0.5) return null;

  /* رفض التوافقيّة الدنيا — وهذا إصلاح عطل حقيقي كُشف بالقياس.
   *
   * الموجة الدورية تتشابه مع نفسها عند دورتها وعند مضاعفاتها كلها بالقدر نفسه
   * تقريباً. فأخذُ أعلى ارتباط يقع في فخّ الأوكتاف الأدنى: قِسته على نغمة ٢٢٠
   * هرتز، فسجّلت الإزاحة ٢١٨ (ثلاث دورات) ١٣٫٥٨ والإزاحة ٧٣ (دورة واحدة)
   * ١٣٫٥٨ نفسها، ففازت الأولى بفارق لا يُذكر فصار الصوت ٧٣ هرتز — أغلظ ثلاث
   * مرات مما هو، فيسمع زبير صوت أبيه صوت رجل آخر.
   *
   * والدورة الحقيقية هي **أصغر** إزاحة تبلغ القمة، لأن ما بعدها مضاعفاتها. */
  const tolerance = bestScore * 0.95;
  for (let lag = minLag; lag <= maxLag; lag++) {
    if (scores[lag]! >= tolerance) return sampleRate / lag;
  }
  return null;
}

/* ————— تحويل اللمس والحركة ————— */

/** ترتيب أبعاد الحسّ الجسدي — معلن وثابت لأن القشرة الحسية تتعلّم عليه. */
export const BODY_ORDER = [
  'touchX', 'touchY', 'touchForce', 'touchDuration', 'accelX', 'accelY', 'accelZ', 'light',
] as const;

export function transduceBody(touch: RawTouch | null, body: RawBody | null): BodySignal {
  const values = new Float32Array(SENSE_DIMS.body);

  if (touch) {
    values[0] = clamp(touch.x, 0, 1);
    values[1] = clamp(touch.y, 0, 1);
    values[2] = clamp(touch.force, 0, 1);
    // مدّة الملامسة تُسوّى بثانية واحدة: اللمسة القصيرة نقرة والطويلة ضغط
    values[3] = clamp(touch.durationMs / 1000, 0, 1);
  }

  let motion = 0;
  if (body) {
    /* التسارع يُقسم على تسارع الجاذبية (٩٫٨١) فيصير الرقم بلا وحدة ومفهوماً:
     * واحدٌ يعني هزّة بقوّة الجاذبية. ونطرح الجاذبية من محور z لأن جهازاً ساكناً
     * يقرأ ٩٫٨ فيه دائماً، ولو تُركت لظنّ زبير نفسه في هزّة دائمة. */
    values[4] = clamp(body.accel[0] / 9.81, -1, 1);
    values[5] = clamp(body.accel[1] / 9.81, -1, 1);
    values[6] = clamp((body.accel[2] - 9.81) / 9.81, -1, 1);
    motion = clamp(Math.hypot(values[4]!, values[5]!, values[6]!), 0, 1);
    // الضوء لوغاريتمي كالسمع: الفرق بين غرفة مظلمة ومضاءة أهمّ من الفرق بين
    // مضاءة وشمس ساطعة
    values[7] = body.lux === null ? 0.5 : clamp(Math.log10(1 + Math.max(0, body.lux)) / 4, 0, 1);
  } else {
    values[7] = 0.5; // لا مستقبل ضوء: منتصف المدى بدل صفر يعني ظلاماً كاذباً
  }

  return { values, touched: touch !== null, motion };
}

/* ————— ما تجتمع عليه الحواسّ ————— */

/** حزمة إدراك واحدة: ما وصل من الحواسّ في هذه اللحظة. أي حاسّة غائبة تكون null. */
export interface SensoryPacket {
  vision: RetinaSignal | null;
  hearing: CochlearSignal | null;
  body: BodySignal | null;
  /** لحظة الالتقاط بالميلي ثانية */
  at: number;
}
