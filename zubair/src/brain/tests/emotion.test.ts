/* ————— اختبار المشاعر —————
 *
 * أسهل ما يُزوَّر في مشروع كهذا هو المشاعر: يكفي أن تُسمّي رقماً «حزناً» فيبدو
 * أن للطفل مشاعر. فأكثر ما يُختبر هنا ليس وجودها بل **أن لكل شعور سببه وحده**،
 * وأن المعقّد **مزيجٌ فعلاً** لا اسمٌ ثالث: إن غاب أحد أطرافه سقط كلُّه.
 *
 * ويُختبر أثرها في الفعل، لأن شعوراً لا يُغيّر سلوكاً ليس شعوراً بل عرضاً.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Zubair } from '../brain.js';
import { memoryStorage } from '../core/persist.js';
import { Lexicon } from '../core/text.js';
import { Rng } from '../core/tensor.js';
import { Syntax } from '../lobes/syntax.js';
import {
  BASIC_EMOTIONS, BLEND_OF, COMPLEX_EMOTIONS, Emotion, type Perceived,
} from '../lobes/emotion.js';
import type { Interoception } from '../core/types.js';

function inner(over: Partial<Interoception> = {}): Interoception {
  return {
    arousal: 1, fatigue: 0, curiosity: 0.3, attachment: 0.4, boredom: 0, confidence: 0.4,
    ...over,
  };
}

function seen(over: Partial<Perceived> = {}): Perceived {
  return {
    valence: 0, conflict: 0, intero: inner(), novelty: 0, othersHave: false, awayMs: 0,
    ...over,
  };
}

/* ————— الستّ الأساسية ————— */

test('المشاعر الستّ الأساسية والأربع المعقّدة موجودة بأسمائها', () => {
  assert.deepEqual([...BASIC_EMOTIONS],
    ['سعادة', 'حزن', 'خوف', 'غضب', 'اشمئزاز', 'مفاجأة']);
  assert.deepEqual([...COMPLEX_EMOTIONS], ['فخر', 'ذنب', 'غيرة', 'حنين']);

  const list = new Emotion().list();
  assert.equal(list.length, 10);
  assert.equal(list.filter((e) => e.complex).length, 4);
});

test('السعادة من المدح، والحزن من التصحيح — ولا يقوم أحدهما مقام الآخر', () => {
  const praised = new Emotion();
  praised.judged({ reward: 1, strategy: 'ANSWER_MEMORY', dopamine: 0.6 });
  const joy = praised.feelings.basic['سعادة'];
  assert.ok(joy > 0.6, `المدح يُسعده (${joy.toFixed(2)})`);
  assert.ok(praised.feelings.basic['حزن'] < 0.05, 'ولا يُحزنه');

  const corrected = new Emotion();
  corrected.judged({ reward: -1, strategy: 'ANSWER_MEMORY', dopamine: -0.6 });
  const sad = corrected.feelings.basic['حزن'];
  assert.ok(sad > 0.5, `والتصحيح يُحزنه (${sad.toFixed(2)})`);
  assert.ok(corrected.feelings.basic['سعادة'] < 0.05, 'ولا يُسعده');
});

test('الخوف من الأذى المباغت، والاشمئزاز من الأذى المستمرّ', () => {
  // أذًى واحد بعد سكون: خوف
  const startled = new Emotion();
  startled.startled(-0.8);
  const fear = startled.feelings.basic['خوف'];
  const disgustOnce = startled.feelings.basic['اشمئزاز'];
  assert.ok(fear > 0.5, `المباغت يُخيف (${fear.toFixed(2)})`);
  assert.ok(fear > disgustOnce * 3, 'ولا يُقزّز');

  // الأذى نفسه متكرّراً: ينقلب اشمئزازاً — رغبةً في الابتعاد لا هرباً
  const repelled = new Emotion();
  for (let i = 0; i < 4; i++) repelled.startled(-0.8);
  const disgust = repelled.feelings.basic['اشمئزاز'];
  assert.ok(disgust > repelled.feelings.basic['خوف'],
    `المستمرّ يُقزّز أكثر مما يُخيف (اشمئزاز ${disgust.toFixed(2)} مقابل خوف ${repelled.feelings.basic['خوف'].toFixed(2)})`);
});

test('اللمسة اللطيفة تُسعده — وهذا أول ما يُسعِد وليداً لا يفهم كلمة', () => {
  const touched = new Emotion();
  touched.startled(0.7);
  assert.ok(touched.feelings.basic['سعادة'] > 0.25);
  assert.equal(touched.feelings.basic['خوف'], 0);
});

test('الغضب من تراكم الإحباط لا من تصحيح واحد', () => {
  const emotion = new Emotion();
  emotion.judged({ reward: -1, strategy: 'ANSWER_MEMORY', dopamine: -0.5 });
  const afterOne = emotion.feelings.basic['غضب'];
  assert.equal(afterOne, 0, 'تصحيحٌ واحد لا يُغضب: الخطأ ليس إهانة');

  for (let i = 0; i < 3; i++) emotion.judged({ reward: -1, strategy: 'ANSWER_MEMORY', dopamine: -0.4 });
  const afterFour = emotion.feelings.basic['غضب'];
  assert.ok(afterFour > 0.3, `وأربعةٌ متتابعة تُحبطه فتُغضبه (${afterFour.toFixed(2)})`);

  // ثم يمدحه فينقطع التتابع
  emotion.judged({ reward: 1, strategy: 'ANSWER_MEMORY', dopamine: 0.5 });
  emotion.judged({ reward: -1, strategy: 'ANSWER_MEMORY', dopamine: -0.4 });
  assert.ok(emotion.feelings.basic['غضب'] < afterFour, 'ومدحةٌ واحدة تُصفّر عدّاد الإحباط');
});

test('المفاجأة «ردّ فعل قصير»: تخمد أسرع من الحزن بكثير', () => {
  const emotion = new Emotion();
  emotion.judged({ reward: -1, strategy: 'ANSWER_MEMORY', dopamine: -1 });
  const surpriseAt0 = emotion.feelings.basic['مفاجأة'];
  const sadAt0 = emotion.feelings.basic['حزن'];
  assert.ok(surpriseAt0 > 0.5, `فاجأه حكمك (${surpriseAt0.toFixed(2)})`);

  for (let i = 0; i < 3; i++) emotion.perceive(seen());
  const surpriseAt3 = emotion.feelings.basic['مفاجأة'];
  const sadAt3 = emotion.feelings.basic['حزن'];

  assert.ok(surpriseAt3 < surpriseAt0 * 0.05,
    `المفاجأة تزول في ثلاث نبضات (${surpriseAt0.toFixed(2)} ← ${surpriseAt3.toFixed(3)})`);
  assert.ok(sadAt3 > sadAt0 * 0.6,
    `والحزن يبقى (${sadAt0.toFixed(2)} ← ${sadAt3.toFixed(2)})`);
});

/* ————— المعقّدة: أنها مزيجٌ فعلاً ————— */

test('الذنب لا يقوم إلا باجتماع الحزن والخوف والغضب', () => {
  assert.deepEqual([...BLEND_OF['ذنب']], ['حزن', 'خوف', 'غضب']);

  // حزنٌ وحده: لا ذنب مهما اشتدّ
  const sadOnly = new Emotion();
  sadOnly.judged({ reward: -1, strategy: 'ANSWER_MEMORY', dopamine: -0.5 });
  assert.ok(sadOnly.feelings.basic['حزن'] > 0.5, 'حزنه قائم');
  assert.equal(sadOnly.feelings.complex['ذنب'], 0, 'ولا ذنب: الغضب غائب فسقط المزيج');

  // ثم تجتمع الثلاثة
  const guilty = new Emotion();
  for (let i = 0; i < 4; i++) guilty.judged({ reward: -1, strategy: 'ANSWER_MEMORY', dopamine: -0.4 });
  const f = guilty.feelings;
  for (const part of BLEND_OF['ذنب']) {
    assert.ok(f.basic[part] > 0.2, `${part} حاضر (${f.basic[part].toFixed(2)})`);
  }
  assert.ok(f.complex['ذنب'] > 0.25, `فقام الذنب (${f.complex['ذنب'].toFixed(2)})`);
});

test('الذنب موجّه نحو النفس: لا يشعر به من لم يُخطئ بجزمه', () => {
  /* هذا هو شرط «التفكير» في الشعور المعقّد: أن يرى الخطأ خطأه هو. من أقرّ
   * بجهله ثم علّمه أبوه لم يُذنب — والطفل يعرف هذا الفرق. */
  const claimed = new Emotion();
  const admitted = new Emotion();
  for (let i = 0; i < 4; i++) {
    claimed.judged({ reward: -1, strategy: 'ANSWER_MEMORY', dopamine: -0.4 });
    admitted.judged({ reward: -1, strategy: 'ADMIT', dopamine: -0.4 });
  }

  const jazm = claimed.feelings.complex['ذنب'];
  const iqrar = admitted.feelings.complex['ذنب'];
  assert.ok(jazm > iqrar * 2.5,
    `ذنبُ من جزم أضعافُ ذنبِ من أقرّ بجهله (${jazm.toFixed(2)} مقابل ${iqrar.toFixed(2)})`);
});

test('الفخر: مدحٌ على إنجاز من عنده، لا على تحيّة', () => {
  assert.deepEqual([...BLEND_OF['فخر']], ['سعادة']);

  const achiever = new Emotion();
  achiever.judged({ reward: 1, strategy: 'ANSWER_MEMORY', dopamine: 0.7 });
  const greeter = new Emotion();
  greeter.judged({ reward: 1, strategy: 'GREET_BACK', dopamine: 0.7 });

  assert.ok(Math.abs(achiever.feelings.basic['سعادة'] - greeter.feelings.basic['سعادة']) < 0.01,
    'سعادتهما واحدة: المدح مدح');
  assert.ok(achiever.feelings.complex['فخر'] > greeter.feelings.complex['فخر'] * 3,
    `والفخر لمن أنجز وحده (${achiever.feelings.complex['فخر'].toFixed(2)} مقابل ${greeter.feelings.complex['فخر'].toFixed(2)})`);
});

test('الغيرة لا تقوم إلا مما عند غيره', () => {
  assert.deepEqual([...BLEND_OF['غيرة']], ['غضب', 'حزن']);

  const frustrated = seen({
    valence: -0.6, conflict: 0.8, intero: inner({ boredom: 0.9, attachment: 0.5 }),
  });

  const jealous = new Emotion();
  const content = new Emotion();
  for (let i = 0; i < 5; i++) {
    jealous.perceive({ ...frustrated, othersHave: true });
    content.perceive({ ...frustrated, othersHave: false });
  }

  assert.ok(jealous.feelings.basic['غضب'] > 0.2 && jealous.feelings.basic['حزن'] > 0.2,
    'طرفا الغيرة قائمان في الحالتين');
  assert.ok(Math.abs(content.feelings.basic['غضب'] - jealous.feelings.basic['غضب']) < 0.01,
    'وغضبهما واحد');
  assert.equal(content.feelings.complex['غيرة'], 0, 'ولا غيرة بلا شيء عند غيره');
  assert.ok(jealous.feelings.complex['غيرة'] > 0.15,
    `والغيرة تقوم بذكره (${jealous.feelings.complex['غيرة'].toFixed(2)})`);
});

test('الحنين: محبّةٌ وحزنٌ على الماضي — لا حزنٌ حاضر', () => {
  const away = new Emotion();
  const present = new Emotion();
  const week = 7 * 24 * 60 * 60 * 1000;
  for (let i = 0; i < 4; i++) {
    away.perceive(seen({ awayMs: week, intero: inner({ attachment: 0.7 }) }));
    present.perceive(seen({ valence: -0.7, awayMs: 0, intero: inner({ attachment: 0.7 }) }));
  }

  assert.ok(present.feelings.basic['حزن'] > 0.3, 'الحاضر عنده حزنٌ قائم');
  assert.equal(present.feelings.complex['حنين'], 0, 'ولا حنين: لا عهد بعيد');
  assert.ok(away.feelings.complex['حنين'] > 0.2,
    `والغياب يُورث حنيناً (${away.feelings.complex['حنين'].toFixed(2)})`);
});

/* ————— أثر المشاعر في الفعل ————— */

test('الغضب يدفعه للتجريب، والفرح والخوف يثبّتانه — وهذا ما ضاع في الوسم الواحد', () => {
  const angry = new Emotion();
  for (let i = 0; i < 4; i++) angry.judged({ reward: -1, strategy: 'ANSWER_MEMORY', dopamine: -0.4 });
  assert.ok(angry.temperatureShift > 0.1,
    `الغاضب يعاند فيجرّب (${angry.temperatureShift.toFixed(2)})`);

  const happy = new Emotion();
  happy.judged({ reward: 1, strategy: 'ANSWER_MEMORY', dopamine: 0.7 });
  assert.ok(happy.temperatureShift < 0,
    `والفرِح يلتزم ما أرضى أباه (${happy.temperatureShift.toFixed(2)})`);

  const afraid = new Emotion();
  afraid.startled(-0.9);
  assert.ok(afraid.temperatureShift < 0,
    `والخائف يتجمّد على المأمون (${afraid.temperatureShift.toFixed(2)})`);
});

test('ما يُشعِر يُحفَر أعمق: الشدّة تضاعف معدّل الوسم', () => {
  const calm = new Emotion();
  assert.ok(Math.abs(calm.imprint - 1) < 0.01, 'الهادئ يوسم بمعدّله الطبيعي');

  const shaken = new Emotion();
  shaken.startled(-0.95);
  assert.ok(shaken.imprint > 1.5, `والمذعور يوسم أضعافاً (${shaken.imprint.toFixed(2)})`);
});

test('النوم يهدّئ ولا يمحو', () => {
  const emotion = new Emotion();
  for (let i = 0; i < 3; i++) emotion.judged({ reward: -1, strategy: 'ANSWER_MEMORY', dopamine: -0.5 });
  const before = emotion.feelings.basic['حزن'];

  emotion.onSleep();
  const after = emotion.feelings.basic['حزن'];
  assert.ok(after < before * 0.5, `يستيقظ أهدأ (${before.toFixed(2)} ← ${after.toFixed(2)})`);
  assert.ok(after > 0, 'ولا يستيقظ خالياً: النوم ليس محواً');
});

test('لا ينهار على قيم شاذّة', () => {
  const emotion = new Emotion();
  emotion.startled(NaN);
  emotion.judged({ reward: NaN, strategy: 'ADMIT', dopamine: Infinity });
  emotion.perceive(seen({ valence: NaN, conflict: Infinity, novelty: -5, awayMs: -1 }));

  for (const value of Object.values(emotion.feelings.basic)) {
    assert.ok(Number.isFinite(value) && value >= 0 && value <= 1, `شعورٌ في مداه (${value})`);
  }
  for (const value of Object.values(emotion.feelings.complex)) {
    assert.ok(Number.isFinite(value) && value >= 0 && value <= 1, `مزيجٌ في مداه (${value})`);
  }
});

test('مشاعره تُحفظ وتُستعاد', () => {
  const emotion = new Emotion();
  for (let i = 0; i < 3; i++) emotion.judged({ reward: -1, strategy: 'ANSWER_MEMORY', dopamine: -0.5 });
  const saved = JSON.parse(JSON.stringify(emotion.save()));

  const restored = new Emotion();
  restored.load(saved);
  assert.ok(Math.abs(restored.feelings.basic['حزن'] - emotion.feelings.basic['حزن']) < 1e-6);
  assert.ok(Math.abs(restored.feelings.complex['ذنب'] - emotion.feelings.complex['ذنب']) < 1e-6);

  // ولا يسقط على حالة عطبة
  const broken = new Emotion();
  broken.load({ basic: null, blame: 'x' } as never);
  assert.ok(Number.isFinite(broken.feelings.basic['حزن']));
});

/* ————— المِلك: مدخل الغيرة الوحيد ————— */

test('يعرف مَن يملك: أبوه أم هو أم ثالث', () => {
  const syntax = new Syntax();
  const lexicon = new Lexicon(new Rng(0x2c1d));
  const owner = (text: string) => syntax.possession(lexicon.perceive(text, true));

  assert.equal(owner('أنا عندي قطة'), 'الأب', 'المتكلّم أبوه');
  assert.equal(owner('أنت عندك قطة'), 'زبير', 'والمخاطَب هو نفسه');
  assert.equal(owner('أحمد عنده قطة'), 'غيره');
  assert.equal(owner('القطة حيوان'), null, 'ولا مِلك في الخبر');
  assert.equal(owner('ذهبت إلى البيت'), null, '«إلى» ليست مِلكاً وإن تشابهت صورتها');
});

/* ————— في الدماغ كاملاً ————— */

async function child(seed = 0x6e11, heritage = false) {
  return Zubair.create({ storage: memoryStorage(), seed, fresh: true, heritage });
}

test('فص المشاعر ظاهر في خريطة دماغه', async () => {
  const zubair = await child();
  const lobe = zubair.lobes.find((l) => l.name === 'emotion');
  assert.ok(lobe, 'موجود بين فصوصه');
  assert.equal(lobe?.ar, 'المشاعر');
  assert.equal(zubair.moodList.length, 10, 'وعشرة مشاعر تُعرض للأب');
});

test('يشعر بما يجري في الحوار، ويظهر أثره في نبضته', async () => {
  const zubair = await child(0x4411, true);
  await zubair.hear('القطة حيوان');
  const out = await zubair.hear('شو القطة؟');
  await zubair.judge({ verdict: 'praise' });

  const mood = zubair.mood;
  assert.ok(mood.basic['سعادة'] > 0.5, `المدح أسعده (${mood.basic['سعادة'].toFixed(2)})`);
  assert.ok(mood.dominant !== null, 'وله شعور غالب يُسمّى');
  assert.ok(out.trace.length > 0);
});

test('يقول شعوره بعد أن يملك لساناً — والوليد يشعر ولا يقول', async () => {
  const grown = await child(0x77c2, true);
  await grown.hear('القطة حيوان');
  await grown.hear('شو القطة؟');
  await grown.judge({ verdict: 'praise' });

  const dominant = grown.mood.dominant;
  assert.ok(dominant !== null);
  const said = await grown.hear('شو القطة؟');
  assert.ok(/مبسوط|سعيد|شفت|عرفتُها/.test(said.text),
    `يذكر شعوره في كلامه: «${said.text}»`);

  // الوليد: يشعر ولا يصف
  const newborn = await child(0x77c3, false);
  const first = await newborn.hear('مرحبا');
  assert.ok(!/مبسوط|سعيد|خايف|خائف/.test(first.text),
    `الوليد لا يصف شعوره: «${first.text}»`);
});

test('حكمك يظهر في ما تعلّمه: يذكر ما شعر به', async () => {
  const zubair = await child(0x1b9c, true);
  await zubair.hear('القطة حيوان');
  await zubair.hear('شو القطة؟');
  const result = await zubair.judge({ verdict: 'praise' });
  assert.ok(result.learned.some((line) => line.includes('شعر بـ')),
    `يُخبر أباه بما شعر به: ${result.learned.join(' | ')}`);
});

test('مشاعره تبقى بعد إغلاق التطبيق', async () => {
  const storage = memoryStorage();
  const first = await Zubair.create({ storage, seed: 0x5f5f, fresh: true });
  await first.hear('القطة حيوان');
  await first.hear('شو القطة؟');
  await first.judge({ verdict: 'correct', correction: 'القطة حيوان' });
  const sadBefore = first.mood.basic['حزن'];
  assert.ok(sadBefore > 0.3, 'حزنه قائم قبل الإغلاق');

  const second = await Zubair.create({ storage, seed: 0x5f5f });
  assert.ok(Math.abs(second.mood.basic['حزن'] - sadBefore) < 1e-6,
    'ويستيقظ بما نام عليه');
});
