/* ————— اختبار الإدراك: أيرى ويسمع ويحسّ فعلاً؟ —————
 *
 * الحواسّ لا تُختبر بأنها تُخرج أرقاماً، بل بأن أرقامها **تفرّق**: منظران
 * مختلفان يجب أن يتباعدا، ونفس المنظر من زاوية أخرى يجب أن يتقارب. وبلا هذا
 * الشرطين لا يتعلّم زبير اسم شيء أبداً مهما أُريه.
 *
 * الصور والأصوات هنا مولَّدة في الاختبار نفسه: لا ملف ولا كاميرا، فيبقى
 * الاختبار قابلاً للتشغيل في Node العاري وقابلاً للإعادة بنفس النتيجة.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  SENSE_DIMS, fft, transduceAudio, transduceBody, transduceVision,
  type RawAudio, type RawFrame,
} from '../core/senses.js';
import { VisualCortex, VISION_FEATURES } from '../lobes/visualCortex.js';
import { AuditoryCortex, HEARING_FEATURES } from '../lobes/auditoryCortex.js';
import { Somatosensory } from '../lobes/somatosensory.js';
import { Inferotemporal } from '../lobes/inferotemporal.js';
import { cosine } from '../core/tensor.js';

/* ————— مشاهد مولَّدة ————— */

type Rgb = [number, number, number];

function blank(width = 96, height = 96, color: Rgb = [20, 20, 24]): RawFrame {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = color[0];
    rgba[i + 1] = color[1];
    rgba[i + 2] = color[2];
    rgba[i + 3] = 255;
  }
  return { width, height, rgba };
}

function paint(frame: RawFrame, x: number, y: number, color: Rgb): void {
  if (x < 0 || y < 0 || x >= frame.width || y >= frame.height) return;
  const i = (Math.floor(y) * frame.width + Math.floor(x)) * 4;
  frame.rgba[i] = color[0];
  frame.rgba[i + 1] = color[1];
  frame.rgba[i + 2] = color[2];
}

/** دائرة: شكل بلا ميول مستقيمة، وتناظرها تامّ. */
function circle(cx = 48, cy = 48, r = 26, color: Rgb = [235, 70, 60], frame = blank()): RawFrame {
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) paint(frame, x, y, color);
    }
  }
  return frame;
}

/** مربّع: ميول أفقية ورأسية قويّة، ولا ميول مائلة. */
function square(cx = 48, cy = 48, half = 24, color: Rgb = [60, 110, 235], frame = blank()): RawFrame {
  for (let y = cy - half; y <= cy + half; y++) {
    for (let x = cx - half; x <= cx + half; x++) paint(frame, x, y, color);
  }
  return frame;
}

/** خطوط مائلة: ميول مائلة وحدها — به يُختبر كشف الاتجاه صراحةً. */
function diagonals(frame = blank(), color: Rgb = [240, 240, 120]): RawFrame {
  for (let y = 0; y < frame.height; y++) {
    for (let x = 0; x < frame.width; x++) {
      if ((x + y) % 8 < 3) paint(frame, x, y, color);
    }
  }
  return frame;
}

/* ————— أصوات مولَّدة ————— */

function tone(hz: number, sampleRate = 16000, ms = 128, amplitude = 0.5): RawAudio {
  const n = Math.floor((sampleRate * ms) / 1000);
  const samples = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    // توافقيّتان مع الأساس: صوت بشري ليس جيباً نقياً بل نغمة بتوافقيّاتها
    const t = i / sampleRate;
    samples[i] = amplitude * (
      Math.sin(2 * Math.PI * hz * t)
      + 0.5 * Math.sin(4 * Math.PI * hz * t)
      + 0.25 * Math.sin(6 * Math.PI * hz * t)
    ) / 1.75;
  }
  return { sampleRate, samples };
}

function silence(sampleRate = 16000, ms = 128): RawAudio {
  return { sampleRate, samples: new Float32Array(Math.floor((sampleRate * ms) / 1000)) };
}

function noise(sampleRate = 16000, ms = 128, amplitude = 0.4): RawAudio {
  const n = Math.floor((sampleRate * ms) / 1000);
  const samples = new Float32Array(n);
  // ضجيج بمولّد ثابت البذرة: لا Math.random كي يُعاد الاختبار بنفس النتيجة
  let seed = 12345;
  for (let i = 0; i < n; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    samples[i] = ((seed / 0x7fffffff) * 2 - 1) * amplitude;
  }
  return { sampleRate, samples };
}

/* ————— التحويل العصبي ————— */

test('تحويل فورييه يجد التردّد الذي وُضع فيه', () => {
  const size = 256;
  const real = new Float32Array(size);
  const imag = new Float32Array(size);
  const bin = 16; // نضع جيباً بتردّد يقابل هذا الحدّ بالضبط
  for (let i = 0; i < size; i++) real[i] = Math.sin((2 * Math.PI * bin * i) / size);
  fft(real, imag);

  let peak = 0;
  let peakBin = 0;
  for (let i = 1; i < size / 2; i++) {
    const magnitude = Math.hypot(real[i]!, imag[i]!);
    if (magnitude > peak) {
      peak = magnitude;
      peakBin = i;
    }
  }
  assert.equal(peakBin, bin, `القمة عند الحدّ ${bin} لا ${peakBin}`);
});

test('الشبكية تفصل الألوان تضادّاً لا قنوات خاماً', () => {
  const red = transduceVision(circle(48, 48, 30, [240, 40, 40]));
  const green = transduceVision(circle(48, 48, 30, [40, 240, 40]));

  let redMean = 0;
  let greenMean = 0;
  for (let i = 0; i < red.redGreen.length; i++) {
    redMean += red.redGreen[i]!;
    greenMean += green.redGreen[i]!;
  }
  redMean /= red.redGreen.length;
  greenMean /= green.redGreen.length;

  assert.ok(redMean > 0.1, `الأحمر موجب في قناة أحمر-أخضر (${redMean.toFixed(3)})`);
  assert.ok(greenMean < -0.1, `والأخضر سالب فيها (${greenMean.toFixed(3)})`);
  assert.equal(red.size, SENSE_DIMS.retina);
});

test('القوقعة تضع الطاقة في النطاق الصحيح', () => {
  const low = transduceAudio(tone(120));
  const high = transduceAudio(tone(3000));

  const peakBand = (bands: Float32Array): number => {
    let best = 0;
    for (let i = 1; i < bands.length; i++) if (bands[i]! > bands[best]!) best = i;
    return best;
  };

  const lowBand = peakBand(low.bands);
  const highBand = peakBand(high.bands);
  assert.ok(lowBand < highBand,
    `الصوت الغليظ في نطاق أدنى من الحادّ (${lowBand} < ${highBand})`);
  assert.equal(low.bands.length, SENSE_DIMS.cochlea);
});

test('تقدير النبرة يُصيب النغمة ويسكت عن الضجيج', () => {
  for (const hz of [110, 220, 330]) {
    const heard = transduceAudio(tone(hz));
    assert.ok(heard.pitchHz !== null, `${hz} هرتز نغمة تُقدَّر`);
    const error = Math.abs(heard.pitchHz! - hz) / hz;
    assert.ok(error < 0.08, `النبرة المقدَّرة ${heard.pitchHz?.toFixed(0)} والحقيقية ${hz}`);
  }
  assert.equal(transduceAudio(silence()).pitchHz, null, 'الصمت لا نبرة له');
  assert.equal(transduceAudio(noise()).pitchHz, null, 'والضجيج ليس نغمة');
});

test('التحويل لا ينهار على مدخلات فارغة أو شاذّة', () => {
  const emptyFrame: RawFrame = { width: 0, height: 0, rgba: new Uint8ClampedArray(0) };
  const retina = transduceVision(emptyFrame);
  assert.equal(retina.luminance.length, SENSE_DIMS.retina ** 2);
  for (const value of retina.luminance) assert.ok(Number.isFinite(value));

  const emptyAudio = transduceAudio({ sampleRate: 0, samples: new Float32Array(0) });
  assert.equal(emptyAudio.loudness, 0);
  for (const band of emptyAudio.bands) assert.ok(Number.isFinite(band));

  const body = transduceBody(null, null);
  assert.equal(body.touched, false);
  for (const value of body.values) assert.ok(Number.isFinite(value));
});

/* ————— القشرة البصرية ————— */

test('القشرة البصرية تفرّق الشكل عن الشكل', () => {
  const cortex = new VisualCortex();
  const asCircle = cortex.see(transduceVision(circle())).features.slice();
  const asSquare = cortex.see(transduceVision(square())).features.slice();
  const asDiagonals = cortex.see(transduceVision(diagonals())).features.slice();

  assert.equal(asCircle.length, VISION_FEATURES);
  const circleVsSquare = cosine(asCircle, asSquare);
  const circleVsDiagonals = cosine(asCircle, asDiagonals);
  assert.ok(circleVsSquare < 0.95, `الدائرة والمربّع يتباعدان (${circleVsSquare.toFixed(3)})`);
  assert.ok(circleVsDiagonals < 0.9, `والدائرة والخطوط أبعد (${circleVsDiagonals.toFixed(3)})`);
});

test('نفس الشيء من موضع آخر يبقى هو — وإلا لم يُعرَف شيء أبداً', () => {
  const cortex = new VisualCortex();
  const middle = cortex.see(transduceVision(circle(48, 48, 26))).features.slice();
  const shifted = cortex.see(transduceVision(circle(56, 44, 26))).features.slice();
  const smaller = cortex.see(transduceVision(circle(48, 48, 21))).features.slice();
  const other = cortex.see(transduceVision(square())).features.slice();

  const sameShifted = cosine(middle, shifted);
  const sameSmaller = cosine(middle, smaller);
  const different = cosine(middle, other);

  assert.ok(sameShifted > different,
    `الدائرة المُزاحة أقرب إلى الدائرة من المربّع (${sameShifted.toFixed(3)} > ${different.toFixed(3)})`);
  assert.ok(sameSmaller > different,
    `والدائرة الأصغر كذلك (${sameSmaller.toFixed(3)} > ${different.toFixed(3)})`);
});

test('يرى الحركة ويعرف الظلمة', () => {
  const cortex = new VisualCortex();
  cortex.see(transduceVision(circle(30, 48)));
  const moved = cortex.see(transduceVision(circle(70, 48)));
  assert.ok(moved.motion > 0.01, `رأى الحركة (${moved.motion.toFixed(3)})`);

  const still = cortex.see(transduceVision(circle(70, 48)));
  assert.ok(still.motion < moved.motion, 'والسكون أقلّ حركة');

  const dark = cortex.see(transduceVision(blank(64, 64, [2, 2, 3])));
  assert.equal(dark.dark, true, 'ويعرف أن كفّاً على الكاميرا ظلمة');
  assert.ok(dark.salience < 0.3, 'والمنظر الفارغ لا يستحقّ انتباهاً');
});

test('البروز يرتفع بما في المنظر من حدود', () => {
  const cortex = new VisualCortex();
  const empty = cortex.see(transduceVision(blank(64, 64, [120, 120, 120])));
  const busy = cortex.see(transduceVision(diagonals()));
  assert.ok(busy.salience > empty.salience,
    `المنظر المزدحم أبرز (${busy.salience.toFixed(3)} > ${empty.salience.toFixed(3)})`);
});

/* ————— القشرة السمعية ————— */

test('القشرة السمعية تصنّف الصوت بلا أن تزعم فهم الكلام', () => {
  const cortex = new AuditoryCortex();
  assert.equal(cortex.listen(transduceAudio(silence())).kind, 'صمت');

  const voice = cortex.listen(transduceAudio(tone(180)));
  assert.equal(voice.kind, 'صوت بشري', 'النغمة الخشنة صوت بشري');
  assert.ok(voice.pitchHz !== null && Math.abs(voice.pitchHz - 180) < 20);
  assert.equal(voice.features.length, HEARING_FEATURES);

  const hiss = cortex.listen(transduceAudio(noise()));
  assert.ok(hiss.kind === 'ضجيج' || hiss.kind === 'طرق', `الضجيج ليس صوتاً بشرياً (${hiss.kind})`);
});

test('كشف البداية: يلتفت إلى صوت يبدأ لا إلى صوت قائم', () => {
  const cortex = new AuditoryCortex();
  cortex.listen(transduceAudio(silence()));
  const startled = cortex.listen(transduceAudio(tone(200, 16000, 128, 0.9)));
  const settled = cortex.listen(transduceAudio(tone(200, 16000, 128, 0.9)));

  assert.ok(startled.salience > settled.salience,
    `بداية الصوت أبرز من استمراره (${startled.salience.toFixed(3)} > ${settled.salience.toFixed(3)})`);
});

test('يعرف صوتك من صوت غريب بنبرته', () => {
  const cortex = new AuditoryCortex();
  // نبرة أبيه: يسمعها مراراً فتصير مألوفة
  for (let i = 0; i < 20; i++) cortex.listen(transduceAudio(tone(150)));
  assert.ok(cortex.familiarPitchHz !== null);

  const father = cortex.familiarity(150);
  const stranger = cortex.familiarity(320);
  assert.ok(father > stranger, `نبرة أبيه أعرف (${father.toFixed(2)} > ${stranger.toFixed(2)})`);
  assert.ok(father > 0.8, 'ويعرفها معرفةً واثقة');
  assert.equal(cortex.familiarity(null), 0, 'وصوتٌ بلا نبرة لا يُعرَف');
});

/* ————— القشرة الحسية الجسدية ————— */

test('يفرّق النقرة من الضغط من المسح', () => {
  const cortex = new Somatosensory();
  const still = { accel: [0, 0, 9.81] as const, lux: 200 };

  const tap = cortex.feel(transduceBody({ x: 0.5, y: 0.5, force: 0.3, durationMs: 80 }, still));
  assert.equal(tap.kind, 'نقرة');

  const press = cortex.feel(transduceBody({ x: 0.5, y: 0.5, force: 0.6, durationMs: 900 }, still));
  assert.equal(press.kind, 'ضغط');

  const swipe = cortex.feel(transduceBody({ x: 0.8, y: 0.5, force: 0.3, durationMs: 120 }, still));
  assert.equal(swipe.kind, 'مسح', 'الانتقال يجعلها مسحاً لا نقرة');

  assert.equal(cortex.feel(transduceBody(null, still)).kind, 'لا لمس');
});

test('الهزّ أذى واللمس اللطيف خير — وسمٌ فطري لا متعلَّم', () => {
  const cortex = new Somatosensory();
  const gentle = cortex.feel(transduceBody({ x: 0.4, y: 0.5, force: 0.2, durationMs: 100 },
    { accel: [0, 0, 9.81], lux: 300 }));
  assert.ok(gentle.innateValence > 0, `اللمس اللطيف موجب (${gentle.innateValence.toFixed(2)})`);

  let shaken = gentle;
  for (let i = 0; i < 8; i++) {
    const sign = i % 2 === 0 ? 1 : -1;
    shaken = cortex.feel(transduceBody(null, { accel: [18 * sign, 14 * sign, 9.81], lux: 300 }));
  }
  assert.ok(shaken.innateValence < 0, `والهزّ العنيف سالب (${shaken.innateValence.toFixed(2)})`);
  assert.ok(cortex.shakeCount > 0, 'ويُحصى عليه');
});

test('يعرف الظلمة من كفّ على الجهاز', () => {
  const cortex = new Somatosensory();
  const bright = cortex.feel(transduceBody(null, { accel: [0, 0, 9.81], lux: 5000 }));
  const dark = cortex.feel(transduceBody(null, { accel: [0, 0, 9.81], lux: 0 }));
  const darkness = (percept: typeof bright): number => percept.features[SENSE_DIMS.body + 3] ?? 0;
  assert.ok(darkness(dark) > darkness(bright), 'الظلمة محسوسة');
});

/* ————— التعرّف: أن يعرف الشيء بعينه ————— */

test('يتعلّم اسم شيء من عرضة واحدة ثم يعرفه', () => {
  const cortex = new VisualCortex();
  const memory = new Inferotemporal();

  const apple = cortex.see(transduceVision(circle(48, 48, 26, [235, 60, 50]))).features;
  memory.teach('تفاحة', apple, 1);

  const again = cortex.see(transduceVision(circle(48, 48, 26, [235, 60, 50]))).features;
  const seen = memory.recognize(again);
  assert.ok(seen !== null, 'عرفه من عرضة واحدة — كما يتعلّم الطفل');
  assert.equal(seen?.name, 'تفاحة');
  assert.ok((seen?.confidence ?? 0) > 0.3, `بثقة معتبرة (${seen?.confidence.toFixed(2)})`);
});

test('لا يسمّي ما لا يعرف', () => {
  const cortex = new VisualCortex();
  const memory = new Inferotemporal();
  assert.equal(memory.recognize(cortex.see(transduceVision(circle())).features), null,
    'دماغٌ لم يُعلَّم شيئاً لا يسمّي شيئاً');

  memory.teach('تفاحة', cortex.see(transduceVision(circle(48, 48, 26, [235, 60, 50]))).features, 1);
  const strange = cortex.see(transduceVision(diagonals())).features;
  const guess = memory.recognize(strange);
  assert.ok(guess === null || guess.similarity >= 0.82,
    `منظرٌ غريب: إمّا يسكت أو يبلغ عتبته (${guess?.similarity.toFixed(3) ?? 'سكت'})`);
});

test('يفرّق شيئين علّمته إياهما', () => {
  const cortex = new VisualCortex();
  const memory = new Inferotemporal();

  const appleFrame = () => circle(48, 48, 26, [235, 60, 50]);
  const bookFrame = () => square(48, 48, 24, [60, 110, 235]);

  memory.teach('تفاحة', cortex.see(transduceVision(appleFrame())).features, 1);
  memory.teach('كتاب', cortex.see(transduceVision(bookFrame())).features, 2);

  const asApple = memory.recognize(cortex.see(transduceVision(appleFrame())).features);
  const asBook = memory.recognize(cortex.see(transduceVision(bookFrame())).features);

  assert.equal(asApple?.name, 'تفاحة', 'يعرف التفاحة');
  assert.equal(asBook?.name, 'كتاب', 'ويعرف الكتاب');
  assert.equal(memory.knownCount, 2);
});

test('دقّة تعرّفه ترتفع بالتعليم فوق المصادفة', () => {
  const cortex = new VisualCortex();
  const memory = new Inferotemporal();

  /* أربعة أشياء بأشكال وألوان مختلفة، وكلٌّ يُعرَض من أربعة مواضع كما يُري الأب
   * ابنه الشيء من زوايا. المصادفة ٢٥٪، فما فوقها تعلّمٌ لا حظّ. */
  const objects: Array<[string, (cx: number, cy: number) => RawFrame]> = [
    ['تفاحة', (cx, cy) => circle(cx, cy, 24, [235, 60, 50])],
    ['كتاب', (cx, cy) => square(cx, cy, 22, [60, 110, 235])],
    ['ليمونة', (cx, cy) => circle(cx, cy, 18, [240, 230, 70])],
    ['علبة', (cx, cy) => square(cx, cy, 30, [90, 200, 120])],
  ];
  const trainPositions: Array<[number, number]> = [[48, 48], [40, 52], [56, 44], [48, 40]];
  const testPositions: Array<[number, number]> = [[44, 50], [52, 46], [50, 54]];

  const measure = (): number => {
    let right = 0;
    let total = 0;
    for (const [name, draw] of objects) {
      for (const [x, y] of testPositions) {
        total++;
        const seen = memory.recognize(cortex.see(transduceVision(draw(x, y))).features);
        if (seen?.name === name) right++;
      }
    }
    return right / total;
  };

  const before = measure();
  assert.equal(before, 0, 'قبل التعليم لا يعرف شيئاً — ولا يخمّن');

  for (const [name, draw] of objects) {
    memory.teach(name, cortex.see(transduceVision(draw(48, 48))).features, 1);
  }
  const afterOne = measure();

  for (const [x, y] of trainPositions) {
    for (const [name, draw] of objects) {
      memory.teach(name, cortex.see(transduceVision(draw(x, y))).features, 2);
    }
  }
  const afterMany = measure();

  assert.ok(afterOne > 0.25,
    `عرضةٌ واحدة لكل شيء تكفي لتجاوز المصادفة (${Math.round(afterOne * 100)}٪ > ٢٥٪)`);
  assert.ok(afterMany >= afterOne,
    `والزوايا الأكثر لا تُنقصه (${Math.round(afterOne * 100)}٪ ← ${Math.round(afterMany * 100)}٪)`);
  assert.ok(afterMany >= 0.75,
    `ويبلغ ثلاثة أرباع ما يُريه (${Math.round(afterMany * 100)}٪)`);
});

test('التصحيح يُضعف الخطأ ويبني الصواب', () => {
  const cortex = new VisualCortex();
  const memory = new Inferotemporal();
  const lemonFrame = () => circle(48, 48, 18, [240, 230, 70]);

  // أبوه سمّاها خطأً ثم صحّح
  memory.teach('تفاحة', cortex.see(transduceVision(lemonFrame())).features, 1);
  for (let i = 0; i < 4; i++) {
    memory.correct('تفاحة', 'ليمونة', cortex.see(transduceVision(lemonFrame())).features, i + 2);
  }

  const seen = memory.recognize(cortex.see(transduceVision(lemonFrame())).features);
  assert.equal(seen?.name, 'ليمونة', 'صار يعرفها بالاسم الصحيح');
});

test('ذاكرة الأشياء تُحفظ وتُستعاد', () => {
  const cortex = new VisualCortex();
  const memory = new Inferotemporal();
  const frame = () => circle(48, 48, 26, [235, 60, 50]);
  memory.teach('تفاحة', cortex.see(transduceVision(frame())).features, 1);
  const expected = memory.recognize(cortex.see(transduceVision(frame())).features);

  const fresh = new Inferotemporal();
  fresh.load(JSON.parse(JSON.stringify(memory.save())));
  const restored = fresh.recognize(cortex.see(transduceVision(frame())).features);

  assert.equal(restored?.name, expected?.name, 'يعرفه بعد إغلاق التطبيق');
  assert.equal(fresh.knownCount, memory.knownCount);

  for (const bad of [null, 'نص', 5, {}, { objects: 'خطأ' }, { objects: [null, { name: '' }] }]) {
    assert.doesNotThrow(() => fresh.load(bad as never), 'وحالة عطبة لا تُسقطه');
  }
});

test('الفصوص الحسّية كلها تعمل في Node بلا متصفّح', () => {
  assert.equal(typeof (globalThis as { navigator?: unknown }).navigator === 'undefined'
    || typeof (globalThis as { document?: unknown }).document === 'undefined', true);
  const visual = new VisualCortex();
  const auditory = new AuditoryCortex();
  const somatic = new Somatosensory();
  assert.ok(visual.see(transduceVision(circle())).features.length > 0);
  assert.ok(auditory.listen(transduceAudio(tone(200))).features.length > 0);
  assert.ok(somatic.feel(transduceBody(null, null)).features.length > 0);
  for (const lobe of [visual, auditory, somatic]) {
    assert.ok(/[؀-ۿ]/.test(lobe.ar) && /[؀-ۿ]/.test(lobe.role), `${lobe.name} معرَّف بالعربية`);
  }
});
