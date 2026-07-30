/* ————— اختبار العتاد والحفظ والنمو —————
 *
 * موضع حساسية خاصة: الأب طلب أن يعمل الدماغ على المعالج العصبي. فأهم ما يُختبر
 * هنا ليس السرعة بل **الصدق**: أن لا يُسمّى المعالج العادي معالجاً عصبياً في نصّ
 * يقرؤه، وأن لا يقول سجل النمو تقدّماً حيث وقع تراجع.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { bestAccelerator, cpuCompute, accelReport } from '../core/npu.js';
import { browserStorage, memoryStorage, quotaHint } from '../core/persist.js';
import { accuracyOf, stageOf, summarize, toNextStage, WINDOW } from '../core/growth.js';
import { cosine, vec } from '../core/tensor.js';
import { STAGES, type GrowthMetrics } from '../core/types.js';

/* ————— نواة الحساب على المعالج ————— */

test('ضرب المصفوفة يطابق حساباً مرجعياً محسوباً بيدنا', () => {
  const compute = cpuCompute();
  // W شكلها (٣ دخل × ٢ خرج) بترتيب الصفوف
  const w = Float32Array.from([1, 2, 3, 4, 5, 6]);
  const b = Float32Array.from([0.5, -0.5]);
  const x = Float32Array.from([1, 0, 2]);

  // بالحساب اليدوي: y0 = 1×1 + 0×3 + 2×5 + 0.5 = 11.5، وy1 = 1×2 + 0×4 + 2×6 − 0.5 = 13.5
  const linear = compute.dense(x, w, b, 3, 2, 'none');
  assert.ok(Math.abs(linear[0]! - 11.5) < 1e-5, `y0 = ${linear[0]}`);
  assert.ok(Math.abs(linear[1]! - 13.5) < 1e-5, `y1 = ${linear[1]}`);

  const tanhOut = compute.dense(x, w, b, 3, 2, 'tanh');
  assert.ok(Math.abs(tanhOut[0]! - Math.tanh(11.5)) < 1e-5, 'وtanh مطبّق على النتيجة');

  const sigmoidOut = compute.dense(x, w, b, 3, 2, 'sigmoid');
  assert.ok(sigmoidOut[0]! > 0.999 && sigmoidOut[0]! <= 1, 'وsigmoid في مجاله');

  const negative = compute.dense(Float32Array.from([-1, 0, -2]), w, b, 3, 2, 'relu');
  assert.equal(negative[0], 0, 'وrelu تقصّ السالب');
});

test('البحث في الذاكرة يطابق التشابه الجيبي مفتاحاً مفتاحاً', () => {
  const compute = cpuCompute();
  const dim = 4;
  const count = 5;
  const keys = new Float32Array(count * dim);
  const query = Float32Array.from([1, 0, 0, 0]);

  // مفاتيح مُسوّاة الطول كما يخزّنها الحُصين، فالضرب الداخلي يساوي التشابه الجيبي
  const rows = [[1, 0, 0, 0], [0, 1, 0, 0], [0.7071, 0.7071, 0, 0], [-1, 0, 0, 0], [0, 0, 0, 1]];
  rows.forEach((row, i) => keys.set(row, i * dim));

  const scores = compute.similarities(query, keys, count, dim);
  assert.equal(scores.length, count);
  rows.forEach((row, i) => {
    const expected = cosine(query, Float32Array.from(row));
    assert.ok(Math.abs(scores[i]! - expected) < 1e-4,
      `المفتاح ${i}: ${scores[i]} والمنتظر ${expected}`);
  });
});

test('البحث في ذاكرة فارغة لا ينهار', () => {
  const compute = cpuCompute();
  assert.equal(compute.similarities(vec(4), new Float32Array(0), 0, 4).length, 0);
});

/* ————— المعالج العصبي: الصدق أولاً ————— */

test('بلا معالج عصبي يقول ذلك صريحاً ولا يزعم غيره', async () => {
  // Node بلا navigator.ml: هذه هي الحال الغالبة على المتصفّحات اليوم أيضاً
  const accelerator = await bestAccelerator();
  assert.equal(accelerator.unit, 'cpu', 'يُفصح أنه المعالج العادي');

  const report = accelReport(accelerator);
  assert.equal(report.unit, 'cpu');
  assert.ok(report.describeAr.includes('معالج جهازك'), `يسمّيه بما هو: «${report.describeAr}»`);
  assert.ok(report.describeAr.includes('لا معالج عصبي'),
    `وينفي المعالج العصبي صراحةً: «${report.describeAr}»`);
  assert.ok(report.details.length > 0, 'ويشرح السبب للتشخيص');
  assert.ok(/[؀-ۿ]/.test(report.describeAr), 'بالعربية كي يقرأه الأب');

  accelerator.dispose();
});

test('المسرّع البديل يعطي نفس أرقام المعالج بالضبط', async () => {
  const accelerator = await bestAccelerator();
  const compute = cpuCompute();
  const dim = 8;
  const count = 12;
  const keys = new Float32Array(count * dim);
  for (let i = 0; i < keys.length; i++) keys[i] = Math.sin(i * 0.37);
  const query = Float32Array.from({ length: dim }, (_, i) => Math.cos(i * 0.11));

  const viaAccel = await accelerator.similarities(query, keys, count, dim);
  const viaCpu = compute.similarities(query, keys, count, dim);
  assert.equal(viaAccel.length, viaCpu.length);
  for (let i = 0; i < count; i++) {
    assert.ok(Math.abs(viaAccel[i]! - viaCpu[i]!) < 1e-5,
      `المفتاح ${i}: المسرّع ${viaAccel[i]} والمعالج ${viaCpu[i]}`);
  }
  accelerator.dispose();
});

test('استدعاء المسرّع مرتين لا يُفسد حالته', async () => {
  const accelerator = await bestAccelerator();
  const keys = new Float32Array(4 * 3);
  keys.fill(0.5);
  const first = await accelerator.similarities(Float32Array.from([1, 0, 0]), keys, 4, 3);
  const second = await accelerator.similarities(Float32Array.from([1, 0, 0]), keys, 4, 3);
  assert.deepEqual(Array.from(first), Array.from(second), 'نتيجة ثابتة');
  accelerator.dispose();
  assert.doesNotThrow(() => accelerator.dispose(), 'والتحرير مرتين لا يرمي');
});

/* ————— الحفظ ————— */

test('التخزين في الذاكرة يحفظ ويقرأ ويمحو', async () => {
  const storage = memoryStorage();
  assert.equal(await storage.read('لا يوجد'), null, 'مفتاح غائب يعيد null لا يرمي');
  await storage.write('دماغ', '{"نسخة":1}');
  assert.equal(await storage.read('دماغ'), '{"نسخة":1}');
  await storage.write('دماغ', 'جديد');
  assert.equal(await storage.read('دماغ'), 'جديد', 'والكتابة تستبدل');
  await storage.remove('دماغ');
  assert.equal(await storage.read('دماغ'), null);
  assert.doesNotThrow(() => storage.remove('غير موجود'), 'ومحو غير الموجود لا يرمي');
  assert.ok(storage.describeAr.includes('مؤقتة'), 'ويُفصح أنه لا يبقى بعد الإغلاق');
});

test('تخزين المتصفّح يسقط في Node بلا انفجار', async () => {
  // الشرط الذي يجعل الدماغ قابلاً للاختبار: طبقة الحفظ لا تفترض متصفّحاً
  const storage = browserStorage();
  assert.doesNotThrow(() => storage);
  await storage.write('اختبار', 'قيمة');
  assert.equal(await storage.read('اختبار'), 'قيمة', 'ويعمل فعلاً لا أن يسقط صامتاً');
  await storage.remove('اختبار');
  assert.ok(storage.describeAr.length > 0, 'ويقول للأب أين حُفظ دماغ ابنه');
});

test('قياس الحجم لا يرمي حين لا يُخبر المتصفّح', async () => {
  const hint = await quotaHint();
  assert.ok(hint.usedBytes === null || typeof hint.usedBytes === 'number');
  assert.ok(hint.note.length > 0 && /[؀-ۿ]/.test(hint.note), `يشرح بالعربية: «${hint.note}»`);
});

/* ————— سجل النمو ————— */

test('المراحل تُحسب على حدودها بالضبط', () => {
  const expected: Array<[number, string]> = [
    [0, 'وليد'], [11, 'وليد'], [12, 'مُهد'], [59, 'مُهد'], [60, 'طفل'],
    [199, 'طفل'], [200, 'مميّز'], [499, 'مميّز'], [500, 'يافع'], [10000, 'يافع'],
  ];
  for (const [vocab, name] of expected) {
    assert.equal(stageOf(vocab).name, name, `${vocab} كلمة → ${name}`);
  }
  // ومدخلات شاذّة لا تُسقطه
  for (const bad of [-5, NaN, Infinity, -Infinity]) {
    assert.ok(STAGES.includes(stageOf(bad as number)), `${bad} يعيد مرحلة صالحة`);
  }
});

test('ما يحتاجه للمرحلة التالية يُحسب صحيحاً', () => {
  assert.equal(toNextStage(0), 12, 'الوليد يحتاج ١٢ كلمة');
  assert.equal(toNextStage(11), 1);
  assert.equal(toNextStage(12), 48, 'والمُهد يحتاج ٤٨ ليصير طفلاً');
  assert.equal(toNextStage(500), 0, 'وبالغُ المراحل لا ينتظر شيئاً');
  assert.equal(toNextStage(99999), 0);
});

test('نسبة الإصابة تُحسب من نافذتين لا من واحدة', () => {
  assert.deepEqual(accuracyOf([]), { recent: 0, previous: 0 }, 'الفارغ صفر لا NaN');

  // أقلّ من نافذة: كلها حديثة ولا سابقة لها
  const few = accuracyOf([1, 1, -1, 1]);
  assert.ok(Math.abs(few.recent - 0.75) < 1e-9, `٣ من ٤ = ${few.recent}`);
  assert.equal(few.previous, 0);

  // نافذتان تامّتان: عشرون خطأ ثم عشرون صواباً
  const exact = accuracyOf([...Array(WINDOW).fill(-1), ...Array(WINDOW).fill(1)]);
  assert.equal(exact.recent, 1, 'الحديثة كلها صواب');
  assert.equal(exact.previous, 0, 'والسابقة كلها خطأ');

  // خمسة وأربعون حكماً: تُقرأ النافذتان الأخيرتان لا الأولى
  const long = accuracyOf([...Array(25).fill(1), ...Array(WINDOW).fill(-1)]);
  assert.equal(long.recent, 0, 'آخر عشرين خطأ');
  assert.equal(long.previous, 1, 'والعشرون قبلها صواب');
});

function metrics(recent: number, previous: number, lessons = 30, vocab = 34): GrowthMetrics {
  return {
    ticks: 100, lessons, vocab, facts: 12, factsInherited: 8, factsFromFather: 4,
    objectsSeen: 3, episodes: 80, questionsAsked: 9,
    recentAccuracy: recent, previousAccuracy: previous, sleeps: 2,
    stage: stageOf(vocab), toNextStage: toNextStage(vocab),
  };
}

test('سجل النمو يقول التراجع ولا يُجمّله', () => {
  const falling = summarize(metrics(0.4, 0.65));
  assert.ok(/هبطت|تراجع/.test(falling), `يقول الهبوط: «${falling}»`);
  assert.ok(!/أعلى|تقدّم/.test(falling), 'ولا يزعم تقدّماً');
  assert.ok(falling.includes('40') && falling.includes('65'), 'ويعرض الرقمين للمقارنة');

  const rising = summarize(metrics(0.7, 0.45));
  assert.ok(rising.includes('أعلى'), `ويقول الارتفاع حين يقع: «${rising}»`);

  const flat = summarize(metrics(0.5, 0.5));
  assert.ok(/ثابتة|بلا تقدّم/.test(flat), `والثبات ثبات: «${flat}»`);

  const untaught = summarize(metrics(0, 0, 0, 0));
  assert.ok(untaught.includes('لم تُعلّمه'), `ومن لم يُعلَّم يُقال له ذلك: «${untaught}»`);
});

test('الجملة التي يقرؤها الأب صحيحة عربية وفيها أرقامه', () => {
  const text = summarize(metrics(0.55, 0.3));
  assert.ok(/[؀-ۿ]/.test(text), 'عربية');
  assert.ok(text.includes('34'), 'وفيها عدد كلماته');
  assert.ok(text.includes('مُهد'), 'ومرحلته');
  assert.ok(text.trim().endsWith('.'), 'وجملة تامة');
  assert.ok(!text.includes('NaN') && !text.includes('undefined'), 'ولا قيمة عطبة');
});
