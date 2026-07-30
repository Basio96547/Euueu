/* ————— اختبار الانتباه الذاتي ولدونة العين —————
 *
 * كلاهما يسهل ادّعاؤه ويصعب إثباته، فالمقياس هنا واحد في الاثنين: **أن يفعل
 * الفصُّ ما يستحيل بدونه**.
 *
 *  الانتباه الذاتي: أن تُوزَن الكلمة الواحدة وزنين مختلفين بحسب جارتها. وهذا
 *  محالٌ على بوابةٍ تنظر إلى الكلمة وحدها، لأن مدخلها في الجملتين واحد بعينه.
 *
 *  لدونة العين: أن يفقد الميلَ الذي لم يره. وهذا محالٌ على نوىً ثابتة.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SelfAttention, HEAD_DIM } from '../core/attention.js';
import { Thalamus } from '../lobes/thalamus.js';
import { VisualCortex, ORIENTATIONS } from '../lobes/visualCortex.js';
import { Lexicon } from '../core/text.js';
import { Rng, vec } from '../core/tensor.js';
import { cpuCompute } from '../core/npu.js';
import { transduceVision, type RawFrame } from '../core/senses.js';
import { DIMS, type Interoception } from '../core/types.js';

const compute = cpuCompute();
const intero: Interoception = {
  arousal: 1, fatigue: 0, curiosity: 0.3, attachment: 0.4, boredom: 0, confidence: 0.4,
};

/* ————— الانتباه وحده ————— */

test('يبدأ محايداً: لا يُغيّر تمثيل كلمة قبل أن يتعلّم شيئاً', () => {
  const attention = new SelfAttention(DIMS.word, new Rng(0x11));
  const a = vec(DIMS.word); a[0] = 1; a[5] = -0.5;
  const b = vec(DIMS.word); b[3] = 0.7;

  const out = attention.forward([a, b]);
  assert.equal(out.length, 2);
  for (let d = 0; d < DIMS.word; d++) {
    assert.ok(Math.abs(out[0]![d]! - a[d]!) < 1e-6,
      'الكلمة تخرج كما دخلت: سياقٌ عشوائي قبل التعلّم إفسادٌ لا إثراء');
  }
});

test('أوزان الانتباه احتمالات: موجبة ومجموعها واحد لكل كلمة', () => {
  const attention = new SelfAttention(DIMS.word, new Rng(0x22));
  const tokens = [vec(DIMS.word), vec(DIMS.word), vec(DIMS.word)];
  tokens[0]![1] = 0.9; tokens[1]![2] = -0.4; tokens[2]![7] = 0.3;
  attention.forward(tokens);

  const map = attention.map;
  assert.equal(map.length, 3, 'صفٌّ لكل كلمة');
  for (const row of map) {
    assert.equal(row.length, 3, 'وكل كلمة تنظر إلى كل كلمة');
    let sum = 0;
    for (const value of row) {
      assert.ok(value >= 0 && Number.isFinite(value), `وزنٌ موجب (${value})`);
      sum += value;
    }
    assert.ok(Math.abs(sum - 1) < 1e-5, `مجموعها واحد (${sum})`);
  }
});

test('مشتقّه صحيح: خطوة واحدة تُنقص الخسارة لا تزيدها', () => {
  /* فحصٌ للاشتقاق نفسه لا للسلوك: هدفٌ ثابت، وخسارة تربيعية، وخطوة واحدة.
   * لو كان مشتقّ softmax مقلوب الإشارة لارتفعت الخسارة بدل أن تهبط. */
  const attention = new SelfAttention(DIMS.word, new Rng(0x33));
  const tokens = [vec(DIMS.word), vec(DIMS.word)];
  tokens[0]![0] = 1; tokens[1]![1] = 1;
  const target = vec(DIMS.word); target[2] = 0.5;

  const lossOf = (): number => {
    const out = attention.forward(tokens);
    let loss = 0;
    for (let d = 0; d < DIMS.word; d++) loss += (out[0]![d]! - target[d]!) ** 2;
    return loss;
  };

  const before = lossOf();
  for (let round = 0; round < 20; round++) {
    const out = attention.forward(tokens);
    const grad = [vec(DIMS.word), vec(DIMS.word)];
    for (let d = 0; d < DIMS.word; d++) grad[0]![d] = 2 * (out[0]![d]! - target[d]!);
    attention.backward(grad);
    attention.step(0.05);
  }
  const after = lossOf();
  assert.ok(after < before, `الخسارة تهبط (${before.toFixed(4)} ← ${after.toFixed(4)})`);
});

test('لا ينهار على جملة فارغة ولا على متجهات شاذّة', () => {
  const attention = new SelfAttention(DIMS.word, new Rng(0x44));
  assert.deepEqual(attention.forward([]), []);
  attention.backward([]);

  const bad = vec(DIMS.word); bad[0] = NaN; bad[1] = Infinity;
  const out = attention.forward([bad, vec(DIMS.word)]);
  for (const value of out[0]!) assert.ok(Number.isFinite(value), `خرجٌ منتهٍ (${value})`);
});

test('يُحفظ ويُستعاد، ويرفض حالةً بأبعاد أخرى', () => {
  const attention = new SelfAttention(DIMS.word, new Rng(0x55));
  const tokens = [vec(DIMS.word), vec(DIMS.word)];
  tokens[0]![4] = 1; tokens[1]![9] = -1;
  for (let i = 0; i < 10; i++) {
    const out = attention.forward(tokens);
    attention.backward([out[0]!, out[1]!]);
    attention.step(0.05);
  }
  const saved = JSON.parse(JSON.stringify(attention.save()));
  assert.equal(saved.head, HEAD_DIM);

  const restored = new SelfAttention(DIMS.word, new Rng(0x99));
  restored.load(saved);
  const mine = attention.forward(tokens);
  const theirs = restored.forward(tokens);
  for (let d = 0; d < DIMS.word; d++) {
    assert.ok(Math.abs(mine[0]![d]! - theirs[0]![d]!) < 1e-6);
  }

  const other = new SelfAttention(16, new Rng(0x99));
  other.load(saved); // أبعادٌ مختلفة: تُرفض بصمت ولا تُسقط الفص
  assert.equal(other.forward([vec(16)]).length, 1);
});

/* ————— في المهاد: ما كان محالاً قبله ————— */

test('الكلمة الواحدة تُوزَن وزنين بحسب جارتها — وهذا محالٌ بلا سياق', () => {
  const lexicon = new Lexicon(new Rng(0x1234));
  const thalamus = new Thalamus(new Rng(0x7a1a));

  const question = lexicon.perceive('شو القطة', true);   // «القطة» هنا لبّ السؤال
  const statement = lexicon.perceive('القطة حيوان', true); // وهنا مجرّد موضوع

  const weightIn = (percept: typeof question, index: number): number =>
    thalamus.gate(percept, intero, compute).weights[index]!;

  const before = Math.abs(weightIn(question, 1) - weightIn(statement, 0));
  assert.ok(before < 1e-6,
    'قبل التعليم الوزنان سواء: مدخل البوابة عن «القطة» واحدٌ في الجملتين');

  // يُمدح على الأولى ويُصحَّح في الثانية: إشارة متعارضة عن الكلمة نفسها
  for (let round = 0; round < 60; round++) {
    thalamus.gate(question, intero, compute);
    thalamus.reinforce(1);
    thalamus.gate(statement, intero, compute);
    thalamus.reinforce(-1);
  }

  const inQuestion = weightIn(question, 1);
  const inStatement = weightIn(statement, 0);
  assert.ok(inQuestion - inStatement > 0.5,
    `فرّق بينهما بالسياق (${inQuestion.toFixed(3)} في السؤال مقابل ${inStatement.toFixed(3)} في الخبر)`);
});

test('خريطة الانتباه تُعرَض: مَن نظر إلى مَن', () => {
  const lexicon = new Lexicon(new Rng(0x88));
  const thalamus = new Thalamus(new Rng(0x7a1a));
  thalamus.gate(lexicon.perceive('شو القطة', true), intero, compute);

  const map = thalamus.attentionMap;
  assert.equal(map.length, 2);
  assert.ok(map.every((row) => row.length === 2));
});

/* ————— لدونة العين: الفترة الحرجة ————— */

function stripes(horizontal: boolean, phase = 0): RawFrame {
  const size = 96;
  const rgba = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const along = horizontal ? y : x;
      const bright = Math.floor((along + phase) / 4) % 2 === 0;
      const i = (y * size + x) * 4;
      const value = bright ? 230 : 25;
      rgba[i] = value; rgba[i + 1] = value; rgba[i + 2] = value; rgba[i + 3] = 255;
    }
  }
  return { width: size, height: size, rgba };
}

const POOL = 3;
function orientationEnergy(cortex: VisualCortex, frame: RawFrame): number[] {
  const percept = cortex.see(transduceVision(frame));
  const per: number[] = [];
  for (let o = 0; o < ORIENTATIONS; o++) {
    let sum = 0;
    for (let i = 0; i < POOL * POOL; i++) sum += Math.abs(percept.features[o * POOL * POOL + i] ?? 0);
    per.push(sum);
  }
  return per;
}

test('عينه تفرّق الاتجاهات أصلاً — وهذا وحده كان معطّلاً', () => {
  /* «طاقة الميول» كانت تُجمَّع بإشارتها، فيُلغي موجبُ استجابة غابور سالبَها في
   * المنطقة الواحدة، فتخرج الطاقة صفراً مهما كان المشهد. أي أن زبير كان يملك
   * مرشّحات اتجاه صحيحة ولا يفرّق بها اتجاهاً. */
  const eye = new VisualCortex();
  const onHorizontal = orientationEnergy(eye, stripes(true, 3));
  const onVertical = orientationEnergy(eye, stripes(false, 3));

  const bestH = onHorizontal.indexOf(Math.max(...onHorizontal));
  const bestV = onVertical.indexOf(Math.max(...onVertical));
  assert.notEqual(bestH, bestV,
    `الخطوط الأفقية تُثير ميلاً غير الذي تُثيره العمودية (${bestH} مقابل ${bestV})`);
  assert.ok(Math.max(...onHorizontal) > 1, 'وللطاقة قيمة معتبرة لا صفر');
});

test('ما لم يره لا يراه: الميل المهمَل يضمر — «قطّ الخطوط الأفقية»', () => {
  const test = stripes(true, 3);

  const newborn = new VisualCortex();
  const fresh = orientationEnergy(newborn, test);

  const reared = new VisualCortex();
  for (let i = 0; i < 600; i++) reared.see(transduceVision(stripes(true, i % 8)));
  const grown = orientationEnergy(reared, test);

  // الميل الأقوى على هذا المشهد هو المُدرَّب، والمائلان لم يُريا شيئاً قط
  const trained = fresh.indexOf(Math.max(...fresh));
  const idle = [0, 1, 2, 3].filter((o) => o !== trained);
  const idleFresh = idle.reduce((a, o) => a + fresh[o]!, 0) / idle.length;
  const idleGrown = idle.reduce((a, o) => a + grown[o]!, 0) / idle.length;

  const before = fresh[trained]! / Math.max(1e-6, idleFresh);
  const after = grown[trained]! / Math.max(1e-6, idleGrown);
  assert.ok(after > before * 1.5,
    `حدّة انتقائه للميل الذي رآه تضاعفت (${before.toFixed(1)} ← ${after.toFixed(1)})`);
});

test('الفترة الحرجة تنغلق: ما تشكّل أولاً لا يمحوه ما بعده', () => {
  const early = new VisualCortex();
  for (let i = 0; i < 800; i++) early.see(transduceVision(stripes(true, i % 8)));
  const snapshot = orientationEnergy(early, stripes(true, 3));

  // ثم يُعرَض عليه العكس مثلَ ما رأى أولاً — ولا ينقلب لأن لدونته خفتت
  for (let i = 0; i < 800; i++) early.see(transduceVision(stripes(false, i % 8)));
  const after = orientationEnergy(early, stripes(true, 3));

  const kept = after.indexOf(Math.max(...after));
  const was = snapshot.indexOf(Math.max(...snapshot));
  assert.equal(kept, was, 'أقوى ميوله على مشهده الأول باقٍ هو هو');
});

test('نواه تُحفظ وتُستعاد، وحالةٌ عطبة لا تُعميه', () => {
  const eye = new VisualCortex();
  for (let i = 0; i < 200; i++) eye.see(transduceVision(stripes(true, i % 8)));
  const saved = JSON.parse(JSON.stringify(eye.save()));
  assert.equal(saved.kernels.length, ORIENTATIONS);

  const restored = new VisualCortex();
  restored.load(saved);
  const mine = orientationEnergy(eye, stripes(true, 1));
  const theirs = orientationEnergy(restored, stripes(true, 1));
  assert.ok(Math.abs(mine[0]! - theirs[0]!) < 1e-3, 'يرى بما تشكّلت به عينه قبل الإغلاق');

  const broken = new VisualCortex();
  broken.load({ glances: 5, kernels: [[1, 2], null, 'x', undefined] } as never);
  const still = orientationEnergy(broken, stripes(true, 1));
  assert.ok(still.every((value) => Number.isFinite(value)), 'ونواةٌ عطبة تُترك مولودةً لا عمياء');
});
