/* ————— اختبار الفهم: جذع الدماغ والفص الصدغي —————
 *
 * أهم ما يُقاس هنا ليس أن الغريزة تصيب، بل أن **القشرة تتجاوزها بالتعليم**.
 * طفل لا يستطيع أن يخالف فطرته حين يعلّمه أبوه ليس طفلاً يتعلّم بل جدول أنماط.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Lexicon } from '../core/text.js';
import { cpuCompute } from '../core/npu.js';
import { Brainstem } from '../lobes/brainstem.js';
import { TemporalLobe } from '../lobes/temporal.js';
import { Thalamus } from '../lobes/thalamus.js';
import { Rng } from '../core/tensor.js';
import { INTENTS, type Intent } from '../core/types.js';

const compute = cpuCompute();

function born() {
  const rng = new Rng(0x11ce);
  const lexicon = new Lexicon(rng);
  const thalamus = new Thalamus(rng);
  const temporal = new TemporalLobe(rng);
  const stem = new Brainstem();
  const intero = {
    arousal: 1, fatigue: 0, curiosity: 0.5, attachment: 0.3, boredom: 0, confidence: 0.1,
  };

  /** المسار نفسه الذي يسلكه الدماغ: حاسّة ← غريزة ← بوابة ← فهم. */
  const perceive = (text: string, learn = true) => {
    const percept = lexicon.perceive(text, learn);
    const reflex = stem.reflexIntent(percept);
    const gate = thalamus.gate(percept, intero, compute);
    return { percept, reflex, gate };
  };

  return { lexicon, thalamus, temporal, stem, perceive };
}

/* ————— جذع الدماغ ————— */

test('الغريزة تُخمّن قصد الأب من أنماط سطحية', () => {
  const brain = born();
  const cases: Array<[string, Intent]> = [
    ['أحسنت يا زبير', 'PRAISE'],
    ['لا، الصحيح غير هذا', 'CORRECT'],
    ['شو القطة؟', 'ASK'],
    ['اسمك زبير', 'TEACH_NAME'],
    ['القطة هي حيوان', 'TEACH_FACT'],
    ['هذه تُسمّى تفاحة', 'TEACH_WORD'],
    ['مرحبا', 'GREET'],
    ['القطة حيوان', 'TEACH_FACT'],
  ];

  for (const [text, expected] of cases) {
    const { percept, reflex } = brain.perceive(text);
    assert.equal(reflex.intent, expected, `«${text}» → ${reflex.intent} والمنتظر ${expected}`);
    assert.ok(reflex.strength > 0 && reflex.strength <= 1, `قوّة «${text}» في مجالها`);
    assert.ok(percept.tokens.length > 0);
  }
});

test('الالتباسات الخطرة تُحسم بالترتيب لا بالحظّ', () => {
  const brain = born();

  // «لا، أحسنت في الأولى» تصحيحٌ فيه كلمة مدح. لو قُدّم المدح سمع ثناءً حيث وُبِّخ
  assert.equal(brain.perceive('لا، أحسنت في الأولى').reflex.intent, 'CORRECT');

  // «ما اسمك؟» سؤالٌ لا تعليمُ اسم. لو قُدِّمت التسمية لسمّى نفسه بكلمة السؤال
  assert.equal(brain.perceive('ما اسمك؟').reflex.intent, 'ASK');

  // «مرحبا اسمك زبير» درسٌ فيه تحية، والدرس أغلى من التحية
  assert.equal(brain.perceive('مرحبا اسمك زبير').reflex.intent, 'TEACH_NAME');

  // «خرجت من البيت» ليست سؤالاً: «من» حرف جرّ لا أداة استفهام في هذا الموضع
  assert.notEqual(brain.perceive('خرجت من البيت').reflex.intent, 'ASK');
});

test('أول درس يُفهَم ولو كانت كلماته كلها مجهولة', () => {
  const brain = born();
  const { percept, reflex } = brain.perceive('القطة حيوان');

  // الشرط الذي انكشف بالقياس: كل كلمات أول درس مجهولة بالضرورة
  assert.equal(percept.unknown.length, percept.tokens.length, 'الكلمتان مجهولتان فعلاً');
  assert.equal(reflex.intent, 'TEACH_FACT',
    'البنية تُعرَف ولو جُهل المعنى — وإلا استحال التعلّم من الدرس الأول');
});

test('الصمت ليس قصداً: جملة فارغة لا تُدرَّب عليها قشرته', () => {
  const brain = born();
  const { reflex } = brain.perceive('   ');
  assert.equal(reflex.intent, 'UNKNOWN');
  assert.equal(reflex.strength, 0, 'قوّة صفرية كي لا يتعلّم من لا شيء');
});

test('اليقظة تهبط بالجلسة وترتفع بالراحة، ولا تنزل عن أرضيتها', () => {
  const stem = new Brainstem();
  let at = 1_000_000;
  const first = stem.tick(at);
  assert.equal(first.ticks, 1);
  assert.equal(first.awayMs, 0, 'أول نبضة لا غياب قبلها');

  for (let i = 0; i < 60; i++) at += 1000, stem.tick(at);
  const tired = stem.tick(at + 1000).arousal;
  assert.ok(tired < first.arousal, `اليقظة هبطت (${first.arousal.toFixed(2)} ← ${tired.toFixed(2)})`);
  assert.ok(tired >= 0.2, 'لا تنزل عن أرضيتها: دماغ بلا يقظة لا يستجيب');

  const rested = stem.tick(at + 60 * 60 * 1000);
  assert.ok(rested.arousal > tired, 'الراحة تُعيد يقظته');
  assert.ok(rested.awayMs > 0, 'يعرف كم غاب أبوه');

  stem.onSleep();
  // النوم يُعيدها كاملة، ثم تستهلك النبضة التالية جزءاً منها: نقيس أنها عادت
  // إلى ما يقارب الكمال لا أنها تساوي واحداً بالضبط — النبضة نفسها تُتعب
  const afterSleep = stem.tick(at + 2 * 60 * 60 * 1000).arousal;
  assert.ok(afterSleep > tired && afterSleep >= 0.95,
    `النوم يُعيد يقظته (${tired.toFixed(3)} ← ${afterSleep.toFixed(3)})`);
});

/* ————— الفص الصدغي ————— */

test('الوليد يعتمد على غريزته: قصده هو قصدها', () => {
  const brain = born();
  const { percept, reflex, gate } = brain.perceive('أحسنت');
  const understanding = brain.temporal.understand(percept, gate.bag, reflex, compute);

  assert.equal(understanding.intent, reflex.intent, 'بلا تعليم، الغريزة هي الحاكم');
  assert.equal(understanding.meaning.length, 64);
  assert.equal(understanding.intentProbs.length, INTENTS.length);
  for (const p of understanding.intentProbs) assert.ok(Number.isFinite(p) && p >= 0);
});

test('التعليم يخفض خسارته: التدريب يعمل فعلاً', () => {
  const brain = born();
  const samples: Array<[string, Intent]> = [
    ['القطة حيوان', 'TEACH_FACT'],
    ['شو القطة؟', 'ASK'],
    ['أحسنت', 'PRAISE'],
    ['لا خطأ', 'CORRECT'],
    ['مرحبا', 'GREET'],
  ];
  const prepared = samples.map(([text, intent]) => ({ ...brain.perceive(text), intent }));

  let firstLoss = 0;
  let lastLoss = 0;
  for (let epoch = 0; epoch < 25; epoch++) {
    let total = 0;
    for (const sample of prepared) {
      total += brain.temporal.teachIntent(sample.percept, sample.gate.bag, sample.intent, 0.03);
    }
    if (epoch === 0) firstLoss = total / prepared.length;
    lastLoss = total / prepared.length;
  }

  assert.ok(lastLoss < firstLoss * 0.5,
    `الخسارة هبطت إلى أقلّ من نصفها (${firstLoss.toFixed(3)} ← ${lastLoss.toFixed(3)})`);

  // وما تعلّمه يُقرأ فعلاً في تصنيفه، لا في الخسارة وحدها
  let right = 0;
  for (const sample of prepared) {
    const understanding = brain.temporal.understand(
      sample.percept, sample.gate.bag, { intent: 'UNKNOWN', strength: 0 }, compute,
    );
    if (understanding.intent === sample.intent) right++;
  }
  assert.ok(right >= 4, `صنّف ${right} من ${prepared.length} صحيحاً بلا معونة غريزته`);
});

test('الطفل يتجاوز غريزته بالتعليم — أهمّ اختبار في هذا الفص', () => {
  const brain = born();
  /* جملة تخطئ فيها الغريزة. تُسمَع مرتين أولاً: في المرة الأولى كل كلماتها
   * مجهولة فتُقرأ «جهلاً» لا «كلاماً عادياً»، وفرق الحالتين مقصود في الجذع. */
  brain.perceive('الجو حلو اليوم كثير');
  const sample = brain.perceive('الجو حلو اليوم كثير');
  assert.equal(sample.reflex.intent, 'CHITCHAT', 'الغريزة تقرؤها كلاماً عادياً');

  const before = brain.temporal.understand(sample.percept, sample.gate.bag, sample.reflex, compute);
  assert.equal(before.intent, 'CHITCHAT', 'وقبل التعليم يتبع غريزته');

  // الأب يصرّ أنها تعليم حقيقة، ثلاثين مرة — كأب يكرّر على ابنه
  for (let i = 0; i < 30; i++) {
    brain.temporal.teachIntent(sample.percept, sample.gate.bag, 'TEACH_FACT', 0.04);
  }

  const after = brain.temporal.understand(sample.percept, sample.gate.bag, sample.reflex, compute);
  assert.equal(after.intent, 'TEACH_FACT',
    `تجاوز غريزته: كانت تقول ${sample.reflex.intent} فصار يقول ${after.intent}`);
});

test('يقين قشرته يزيد بالتعليم — لا يقين غريزته', () => {
  const brain = born();
  const sample = brain.perceive('القطة حيوان');

  /* الغريزة تُحيَّد في القياس، وهذا ليس تسهيلاً بل هو المقصود:
   * الوليد يبدو **قاطعاً** لأن غريزته ترميز واحد ساخن فإنتروبياه صفر، فلو
   * قِسنا القصد الممزوج لقِسنا يقيناً موروثاً لا يقيناً متعلَّماً. ما يجب أن
   * ينمو هو ثقة القشرة بنفسها. */
  const mute = { intent: 'UNKNOWN' as const, strength: 0 };
  const before = brain.temporal.understand(sample.percept, sample.gate.bag, mute, compute);
  assert.ok(before.uncertainty > 0.8,
    `الوليد لا تعرف قشرته شيئاً فاحتمالاته موزّعة (${before.uncertainty.toFixed(3)})`);

  for (let i = 0; i < 40; i++) {
    brain.temporal.teachIntent(sample.percept, sample.gate.bag, 'TEACH_FACT', 0.04);
  }
  const after = brain.temporal.understand(sample.percept, sample.gate.bag, mute, compute);

  assert.ok(after.uncertainty < before.uncertainty * 0.7,
    `عدم يقين قشرته هبط (${before.uncertainty.toFixed(3)} ← ${after.uncertainty.toFixed(3)})`);
  assert.ok(after.uncertainty >= 0 && before.uncertainty <= 1, 'الإنتروبيا المعيارية في [0,1]');
});

test('الاستعادة تحفظ ما تعلّمه وعدد دروسه', () => {
  const brain = born();
  const sample = brain.perceive('الجو حلو اليوم كثير');
  for (let i = 0; i < 30; i++) {
    brain.temporal.teachIntent(sample.percept, sample.gate.bag, 'TEACH_FACT', 0.04);
  }
  const expected = brain.temporal.understand(sample.percept, sample.gate.bag, sample.reflex, compute);
  const saved = JSON.parse(JSON.stringify(brain.temporal.save()));

  const fresh = new TemporalLobe(new Rng(0x999));
  fresh.load(saved);
  const restored = fresh.understand(sample.percept, sample.gate.bag, sample.reflex, compute);

  assert.equal(restored.intent, expected.intent, 'نفس القصد بعد الاستعادة');
  assert.equal(fresh.lessonCount, brain.temporal.lessonCount, 'عدد الدروس محفوظ');
  // وزن الغريزة يعتمد على عدد الدروس، فلو ضاع العدد لعاد يتبع فطرته
  assert.ok(fresh.lessonCount >= 30);
});

test('الحالة العطبة تُتجاهل ولا تُسقط الفص', () => {
  const lobe = new TemporalLobe(new Rng(1));
  const junk: unknown[] = [null, undefined, 'نص', 42, [], {}, { encoder: 'خطأ', head: null, lessons: -5 }];
  for (const bad of junk) {
    assert.doesNotThrow(() => lobe.load(bad as never), `الحالة ${JSON.stringify(bad)} لا ترمي`);
  }
  assert.ok(lobe.lessonCount >= 0, 'وعدّاده يبقى سليماً');
});

test('الفصّان يعملان في Node العاري بلا متصفّح', () => {
  // الشرط الذي يجعل الدماغ قابلاً للاختبار: لا DOM في أي فص
  assert.equal(typeof (globalThis as { document?: unknown }).document, 'undefined');
  const brain = born();
  const { percept, reflex, gate } = brain.perceive('القطة حيوان');
  assert.ok(brain.temporal.understand(percept, gate.bag, reflex, compute).meaning.length > 0);
});
