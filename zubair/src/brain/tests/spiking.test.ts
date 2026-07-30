/* ————— اختبار الخلايا النبضية —————
 *
 * الخلية النبضية أسهل ما يُزوَّر في مشروع كهذا: يكفي أن تقارن رقماً بعتبة وتسمّي
 * النتيجة «نبضة». والفرق الحقيقي بين النبضي والمعدّلي **زمني**، ولذلك أكثر ما
 * يُختبر هنا هو ما لا يستطيعه المقارِن بعتبة بحال:
 *
 *   ١) أن يتراكم الخافت المُلحّ حتى يعبر  (تكامل)
 *   ٢) وألّا يتراكم الخافت المتباعد أبداً  (تسريب)
 *   ٣) وألّا يعبر القويّ أسرع من حدٍّ مهما اشتدّ  (جموح)
 *
 * والثلاثة تُقاس بالميلي ثانية الحقيقية لا بعدد الاستدعاءات.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { LifLayer, LifNeuron, LIF_DEFAULTS } from '../core/spiking.js';
import { Thalamus, MODALITIES } from '../lobes/thalamus.js';
import { Zubair } from '../brain.js';
import { memoryStorage } from '../core/persist.js';
import type { Interoception } from '../core/types.js';
import type { RawFrame } from '../core/senses.js';

const T0 = 1_700_000_000_000;

function awake(over: Partial<Interoception> = {}): Interoception {
  return {
    arousal: 1, fatigue: 0, curiosity: 0.3, attachment: 0.4, boredom: 0, confidence: 0.4,
    ...over,
  };
}

/* ————— الخلية وحدها ————— */

test('لا تُطلق دون الحدّ، وتُطلق عنده — والخرج نبضة لا كسر', () => {
  const cell = new LifNeuron();
  assert.equal(cell.charge(0.05, T0), false, 'شحنة دون العتبة لا تُطلق');
  assert.equal(cell.spikeCount, 0);

  const loud = new LifNeuron();
  assert.equal(loud.charge(0.5, T0), true, 'وشحنة فوقها تُطلق فوراً');
  assert.equal(loud.spikeCount, 1);
  assert.equal(loud.potential, LIF_DEFAULTS.reset, 'وتعود إلى راحتها بعد الإطلاق');
});

test('التكامل: الخافت المُلحّ يعبر ولو كان كلُّ نبضٍ منه دون العتبة', () => {
  const cell = new LifNeuron();
  const faint = 0.025; // أقلّ من ثلث العتبة
  let firedAt = -1;

  for (let i = 0; i < 12; i++) {
    if (cell.charge(faint, T0 + i * 50) && firedAt < 0) firedAt = i;
  }

  assert.ok(firedAt > 0, `عبر بعد تراكم (عند النبض رقم ${firedAt})`);
  assert.ok(firedAt >= 2, 'ولم يعبر من أول نبضة: لو عبر لما كان تراكماً');
  assert.ok(cell.spikeCount >= 1);
});

test('التسريب: الشحنات نفسها متباعدةً لا تتراكم أبداً', () => {
  const cell = new LifNeuron();
  const faint = 0.025;

  // نفس العدد ونفس الشدّة، والفارق الوحيد أن بينها عشر ثوانٍ
  for (let i = 0; i < 12; i++) cell.charge(faint, T0 + i * 10_000);

  assert.equal(cell.spikeCount, 0,
    'ما تسرّب لا يتراكم — وهذا ما يفرّق الخلية النبضية من المقارِن بعتبة');
  assert.ok(cell.potential < 0.03, `ولا يبقى في جهدها إلا آخر شحنة (${cell.potential.toFixed(4)})`);
});

test('الجموح: مؤثّر ثابت لا يُغرق القشرة مهما اشتدّ', () => {
  const cell = new LifNeuron();
  let spikes = 0;
  // ثانية كاملة من دخل أقصى، عشرون مرة في الثانية
  for (let i = 0; i < 20; i++) if (cell.charge(1, T0 + i * 50)) spikes++;

  const ceiling = 1000 / LIF_DEFAULTS.refractoryMs;
  assert.ok(spikes <= ceiling,
    `التردّد له سقف (${spikes} نبضة في الثانية، والسقف ${ceiling.toFixed(1)})`);
  assert.ok(spikes >= 4, 'ومع ذلك يمرّ بمعدّل معتبر');
});

test('ترميز التردّد: الأقوى ينبض أكثر — والشدّة تصل بلا رقم متّصل', () => {
  const strong = new LifNeuron();
  const weak = new LifNeuron();
  for (let i = 0; i < 20; i++) {
    strong.charge(1, T0 + i * 50);
    weak.charge(0.02, T0 + i * 50);
  }
  const end = T0 + 1000;
  const fast = strong.rateHz(end, 1000);
  const slow = weak.rateHz(end, 1000);

  assert.ok(fast > slow, `القويّ أعلى تردّداً (${fast.toFixed(1)} مقابل ${slow.toFixed(1)} هرتز)`);
  assert.ok(slow > 0, 'والضعيف يصل أيضاً، لكن أبطأ');
});

test('رفع العتبة إغلاقٌ من فوق — وهذا ما يفعله المهاد في النوم', () => {
  const cell = new LifNeuron();
  cell.setThreshold(0.9);
  assert.equal(cell.charge(0.5, T0), false, 'نصف الشدّة لا يعبر عتبةً مرفوعة');

  cell.setThreshold(0.08);
  assert.equal(cell.charge(0.5, T0 + 5000), true, 'وتُفتح فيعبر ما كان يُردّ');
});

test('الطبقة النبضية تُخرج أصفاراً وآحاداً لا كسوراً', () => {
  const layer = new LifLayer(4);
  layer.charge(0, 0.9, T0);
  layer.charge(2, 0.01, T0);
  const out = layer.spikes(T0, 5000);

  assert.equal(out.length, 4);
  for (const value of out) assert.ok(value === 0 || value === 1, `صفرٌ أو واحد (${value})`);
  assert.equal(out[0], 1, 'القويّة أطلقت');
  assert.equal(out[2], 0, 'والضعيفة لا');
});

test('لا تنهار على لحظات أو شحنات شاذّة', () => {
  const cell = new LifNeuron();
  cell.charge(NaN, T0);
  cell.charge(-5, T0 + 10);
  cell.charge(Infinity, NaN);
  cell.charge(0.5, T0 - 99999);
  assert.ok(Number.isFinite(cell.potential), `جهدٌ منتهٍ (${cell.potential})`);
  assert.ok(cell.potential >= 0);
});

test('جهدها وسجلّ إطلاقها يُحفظان ويُستعادان', () => {
  const cell = new LifNeuron();
  for (let i = 0; i < 6; i++) cell.charge(0.05, T0 + i * 40);
  const saved = JSON.parse(JSON.stringify(cell.save()));

  const restored = new LifNeuron();
  restored.load(saved);
  assert.equal(restored.spikeCount, cell.spikeCount);
  assert.ok(Math.abs(restored.potential - cell.potential) < 1e-9);

  const broken = new LifNeuron();
  broken.load({ v: NaN, recent: 'x' } as never);
  assert.ok(Number.isFinite(broken.potential), 'وحالة عطبة تُترك ولا تُسقط الخلية');
});

/* ————— في المهاد ————— */

test('المهاد يُمرّر ما ألحّ ويردّ ما ومض — بنفس الشدّة', () => {
  const streams = { vision: 0.03, hearing: null, body: null, text: 1 };

  const insistent = new Thalamus();
  for (let i = 0; i < 14; i++) insistent.excite('vision', 0.03, T0 + i * 50);
  const passedInsistent = insistent.relay(streams, awake(), 1, T0 + 700).passed.vision;

  const fleeting = new Thalamus();
  for (let i = 0; i < 14; i++) fleeting.excite('vision', 0.03, T0 + i * 10_000);
  const passedFleeting = fleeting.relay(streams, awake(), 1, T0 + 140_000).passed.vision;

  assert.equal(passedInsistent, true, 'المنظر الخافت الدائم يبلغ قشرته');
  assert.equal(passedFleeting, false, 'والخافت الوامض لا يبلغها ولو تكرّر أربع عشرة مرة');
});

test('كلامك يمرّ من أول كلمة: لا ينتظر تراكماً', () => {
  const thalamus = new Thalamus();
  const decision = thalamus.relay(
    { vision: null, hearing: null, body: null, text: 1 }, awake(), 1, T0,
  );
  assert.equal(decision.passed.text, true);
  assert.equal(decision.focus, 'text');
  assert.ok(decision.rates.text > 0, 'وله تردّد يُعرَض للأب');
});

test('النعاس يرفع العتبة، والإلحاح يخترقها — «لا يوقظك ضوءٌ خفيف»', () => {
  const drowsy = awake({ arousal: 0.15 });
  const thalamus = new Thalamus();

  /* العتبة تُضبَط في النبضة وتسري على ما بعدها، فتُقرأ نتيجتها في النبضة
   * التالية — كما أن انتباهك الآن يحكم ما يصلك بعد لحظة لا ما وصلك قبلها. */
  thalamus.relay({ vision: null, hearing: null, body: null, text: null }, drowsy, 0.15, T0);

  thalamus.excite('vision', 0.2, T0 + 100);
  const once = thalamus.relay({ vision: 0.2, hearing: null, body: null, text: null }, drowsy, 0.15, T0 + 150);
  assert.equal(once.passed.vision, false, 'ومضةٌ واحدة لا توقظه');

  for (let i = 0; i < 10; i++) thalamus.excite('vision', 0.2, T0 + 200 + i * 40);
  const kept = thalamus.relay({ vision: 0.2, hearing: null, body: null, text: null }, drowsy, 0.15, T0 + 650);
  assert.equal(kept.passed.vision, true, 'وإلحاحُها يوقظه');
});

test('حالة الخلايا تُحفظ مع المهاد ولا تُفسد أوزانه المتعلَّمة', () => {
  const thalamus = new Thalamus();
  for (let i = 0; i < 5; i++) thalamus.excite('vision', 0.03, T0 + i * 50);
  const saved = JSON.parse(JSON.stringify(thalamus.save()));
  assert.equal(saved.cells.length, MODALITIES.length, 'خلية لكل مجرى');

  const restored = new Thalamus();
  restored.load(saved);
  restored.excite('vision', 0.03, T0 + 250);
  const decision = restored.relay(
    { vision: 0.03, hearing: null, body: null, text: null }, awake(), 1, T0 + 300,
  );
  assert.equal(decision.passed.vision, true, 'يكمل التراكم من حيث وقف قبل الإغلاق');

  // ودماغ محفوظ قديم بلا خلايا يُقرأ ولا يُرفض
  const old = { ...saved, cells: undefined };
  const legacy = new Thalamus();
  legacy.load(old as never);
  assert.ok(legacy.relay({ vision: null, hearing: null, body: null, text: 1 }, awake(), 1, T0).passed.text);
});

/* ————— في الدماغ كاملاً ————— */

function faintScene(): RawFrame {
  const size = 96;
  const rgba = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = 22; rgba[i + 1] = 22; rgba[i + 2] = 26; rgba[i + 3] = 255;
  }
  // بقعة صغيرة أفتح قليلاً من الخلفية: بروزها نحو ٠٫٠١ — عُشر العتبة
  for (let y = 46; y <= 50; y++) {
    for (let x = 46; x <= 50; x++) {
      const i = (y * size + x) * 4;
      rgba[i] = 40; rgba[i + 1] = 40; rgba[i + 2] = 46;
    }
  }
  return { width: size, height: size, rgba };
}

async function newborn(seed: number) {
  return Zubair.create({ storage: memoryStorage(), seed, fresh: true });
}

test('ما يومض أمام عينه لا يصل وعيه، وما يدوم يصل', async () => {
  const glimpse = await newborn(0x4b1c);
  glimpse.see(faintScene(), T0);
  const brief = await glimpse.hear('شو هذا؟', T0 + 20);
  const sawBrief = brief.trace.some((step) => step.lobe === 'inferotemporal');
  assert.equal(sawBrief, false, 'ومضةٌ خافتة لا تبلغ قشرته فلا يُعالجها أصلاً');

  const stared = await newborn(0x4b1c);
  for (let i = 0; i < 16; i++) stared.see(faintScene(), T0 + i * 50);
  const long = await stared.hear('شو هذا؟', T0 + 850);
  const sawLong = long.trace.some((step) => step.lobe === 'inferotemporal');
  assert.equal(sawLong, true, 'ونصف ثانية من النظر إليها يُبلغها');
});

test('أثر النبضة يُري الأب تردّد نبض حواسّه', async () => {
  const zubair = await newborn(0x7d2e);
  const out = await zubair.hear('مرحبا', T0);
  const step = out.trace.find((s) => s.lobe === 'thalamus' && s.note.includes('هرتز'));
  assert.ok(step !== undefined, `يذكر التردّد: ${out.trace.filter((s) => s.lobe === 'thalamus').map((s) => s.note).join(' | ')}`);
});

test('المنظر الواضح يمرّ من أول إطار — ولم ينكسر ما كان يعمل', async () => {
  const zubair = await newborn(0x11aa);
  const apple: RawFrame = (() => {
    const size = 96;
    const rgba = new Uint8ClampedArray(size * size * 4);
    for (let i = 0; i < rgba.length; i += 4) {
      rgba[i] = 22; rgba[i + 1] = 22; rgba[i + 2] = 26; rgba[i + 3] = 255;
    }
    for (let y = 24; y <= 72; y++) {
      for (let x = 24; x <= 72; x++) {
        if ((x - 48) ** 2 + (y - 48) ** 2 <= 576) {
          const i = (y * size + x) * 4;
          rgba[i] = 235; rgba[i + 1] = 60; rgba[i + 2] = 50;
        }
      }
    }
    return { width: size, height: size, rgba };
  })();

  zubair.see(apple, T0);
  await zubair.hear('هذه تفاحة', T0 + 30);
  assert.equal(zubair.metrics.objectsSeen, 1, 'إطارٌ واحد بارز يكفي ليربط الشكل بالاسم');
});
