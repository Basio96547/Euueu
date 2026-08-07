/* ————— اختبار التوصيل: أن يصل ما يُحسَب إلى مَن يستعمله —————
 *
 * سأل الأب: «هل الفصوص لا تعمل بشكل منطقي؟». فتُتُبِّع كلُّ ما يُخرجه كل فص
 * وأين يُستهلَك، فوُجدت أربعة مواضع يُحسَب فيها شيءٌ ثم **لا يستقبله أحد**.
 * وفصٌّ لا يُقرأ خرجُه ليس فصاً بل حسابٌ يُهدَر:
 *
 *   ١) الجواب كان يبحث في «الجنس» دائماً مهما سأل الأب. فصار زبير يحفظ صفةَ
 *      الشيء وفعله ثم لا يستطيع إخراجهما أبداً — وحفظٌ لا يُستخرَج ليس معرفة.
 *   ٢) «القطة صغيرة» كان المصنِّف يقرؤها **تصحيحاً**، والنحو يقول «خبرٌ تامّ»،
 *      فيسقط الدرس. رأيُ النحو في البنية أوثق من تصنيفٍ متعلَّم.
 *   ٣) الهدف يُحسَب في كل نبضة ثم يُعرَض ولا يُغيّر قراراً.
 *   ٤) الأذن والجسد يُفرَزان في المهاد ثم لا يستقبلهما فصٌّ واحد.
 *
 * وهذه اختباراتها، وكلها تسأل سؤالاً واحداً: **هل وصل؟**
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Zubair } from '../brain.js';
import { memoryStorage } from '../core/persist.js';
import { Syntax } from '../lobes/syntax.js';
import { Emotion } from '../lobes/emotion.js';
import { Prefrontal, GOAL_FITS } from '../lobes/prefrontal.js';
import { BasalGanglia, STATE_DIM } from '../lobes/basalGanglia.js';
import { Rng, vec } from '../core/tensor.js';
import { cpuCompute } from '../core/npu.js';
import { STRATEGIES, type Strategy } from '../core/types.js';
import type { RawAudio, RawTouch } from '../core/senses.js';

async function child(seed: number) {
  return Zubair.create({ storage: memoryStorage(), seed, fresh: true, heritage: true });
}

/* ————— ١) السؤال يختار العلاقة ————— */

test('كل سؤال يطلب علاقةً بعينها من معرفته', () => {
  const syntax = new Syntax();
  assert.equal(syntax.relationFor('جنس'), 'جنس', '«شو» يطلب الجنس');
  assert.equal(syntax.relationFor('كيفية'), 'صفة', 'و«كيف» يطلب الصفة');
  assert.equal(syntax.relationFor('عدد'), 'عدد');
  assert.equal(syntax.relationFor('مكان'), 'جنس');
  assert.equal(syntax.relationFor('سبب'), null, 'ولا سببية في دماغه فيُقرّ بجهله');
  assert.equal(syntax.relationFor('اختيار'), null);
  assert.equal(syntax.relationFor(null), 'جنس', 'وغير السؤال يُقرأ على الجنس');
});

test('جوابٌ من العلاقة المطلوبة يصلح، ومن غيرها يُردّ', () => {
  const syntax = new Syntax();
  assert.equal(syntax.answerFits('كيفية', 'صغيره', null, 'صفة'), true,
    '«كيف القطة؟» يُجاب من صفاتها');
  assert.equal(syntax.answerFits('كيفية', 'حيوان', 'جنس', 'جنس'), false,
    'ولا يُجاب بجنسها');
  assert.equal(syntax.answerFits('سبب', 'صغيره', null, 'صفة'), false,
    'ولا سببية عنده بحال');
});

test('يُخرِج ما حفظه بالعلاقة التي حُفظ بها — وكان محبوساً', async () => {
  const zubair = await child(0x55);
  await zubair.hear('القطة حيوان');
  await zubair.hear('القطة صغيرة');
  await zubair.hear('القطة تأكل');

  const known = zubair.facts.filter((f) => f.subject === 'قطه').map((f) => f.object);
  assert.ok(known.includes('حيوان') && known.includes('صغيره'),
    `يحفظ الجنس والصفة معاً (${known.join('، ')})`);

  const genus = await zubair.hear('شو القطة؟');
  assert.ok(genus.text.includes('حيوان'), `«شو» يُجاب بالجنس: «${genus.text}»`);

  const manner = await zubair.hear('كيف القطة؟');
  assert.ok(manner.text.includes('صغيرة') || manner.text.includes('صغيره'),
    `و«كيف» يُجاب بالصفة: «${manner.text}»`);
  assert.ok(!manner.text.includes('حيوان'), 'ولا يُجاب بجنسها');
});

/* ————— ٢) البنية أوثق من التصنيف ————— */

test('جملةٌ خبرية تامّة تُحفَظ ولو أخطأ المصنِّف قصدها', async () => {
  /* «القطة صغيرة» كان المصنِّف يقرؤها CORRECT، فلا يُحفظ منها شيء — والنحو
   * يقول عنها «اسمية · علاقة صفة»، أي خبرٌ تامّ الطرفين بلا نفي. */
  for (const [lesson, subject, object] of [
    ['القطة صغيرة', 'قطه', 'صغيره'],
    ['الفيل ضخم', 'فيل', 'ضخم'],
    ['البحر أزرق', 'بحر', 'ازرق'],
  ] as const) {
    const zubair = await child(0x55);
    await zubair.hear(lesson);
    const known = zubair.facts.filter((f) => f.subject === subject).map((f) => f.object);
    assert.ok(known.includes(object), `«${lesson}» درسٌ يُحفظ (${known.join('، ') || 'لا شيء'})`);
  }
});

test('والنفي يبقى نفياً لا تعليماً: البنية تفرّقهما', async () => {
  const zubair = await child(0x31bb);
  await zubair.hear('القطة حيوان');
  const before = zubair.facts.find((f) => f.subject === 'قطه')?.confidence ?? 0;
  await zubair.hear('القطة ليست حيوان');
  const after = zubair.facts.find((f) => f.subject === 'قطه')?.confidence ?? 0;
  assert.ok(after < before, `النفي يهدم لا يبني (${before.toFixed(2)} ← ${after.toFixed(2)})`);
});

/* ————— ٣) الهدف يوجّه ————— */

test('لكل هدف استجاباتٌ توافقه', () => {
  assert.ok(GOAL_FITS.LEARN.has('ASK_QUESTION'), 'مَن يتعلّم يسأل');
  assert.ok(GOAL_FITS.ANSWER.has('ANSWER_MEMORY'), 'ومَن يُجيب يُجيب');
  assert.ok(GOAL_FITS.BOND.has('GREET_BACK'), 'ومَن يقترب يُحيّي');
  assert.ok(GOAL_FITS.REST.has('ACKNOWLEDGE'), 'ومَن يستريح يُقصّر');
  assert.ok(!GOAL_FITS.REST.has('ASK_QUESTION'), 'ولا يسأل المتعب');
});

test('ميل الهدف يُزيح الاختيار فعلاً — ولا يُلغي المخالف', () => {
  const ganglia = new BasalGanglia(new Rng(0x2f2f));
  const state = vec(STATE_DIM);
  for (let i = 0; i < state.length; i++) state[i] = 0.1;
  const compute = cpuCompute();

  /* مولّدٌ واحد لكل القياس لا مولّدٌ ببذرةٍ جديدة في كل دورة: بذورٌ متتالية في
   * xorshift تُعطي أوائل متقاربة، فتخرج المئتان قرعةً واحدة مكرّرة لا مئتين. */
  const countWith = (bias?: (s: Strategy) => number): number => {
    const rng = new Rng(0x5eed);
    let asked = 0;
    for (let i = 0; i < 400; i++) {
      // حرارة معتبرة: عندها يبقى الاستكشاف حيّاً فيُقاس الميل لا الحسم
      const out = ganglia.select(state, STRATEGIES, 1.2, rng, compute, bias);
      if (out.strategy === 'ASK_QUESTION') asked++;
    }
    return asked;
  };

  const neutral = countWith();
  const leaning = countWith((s) => (s === 'ASK_QUESTION' ? 0.3 : 0));
  assert.ok(leaning > neutral,
    `الميل يرفع نصيب ما يوافق الهدف (${neutral} ← ${leaning} من ٤٠٠)`);
  assert.ok(leaning < 400 * 0.9,
    `ولا يحسم: المخالف يبقى ممكناً (${400 - leaning} من ٤٠٠)`);
});

test('والكبح يبقى كبحاً: الهدف لا يُبيح ممنوعاً', () => {
  const prefrontal = new Prefrontal();
  const allowed = prefrontal.inhibit(STRATEGIES, {
    stage: { id: 3, name: 'مميّز', minVocab: 200, maxWords: 12, questionBias: 0.3 },
    intent: 'GREET',
    askedRecently: [],
    lastStrategies: [],
    hasFact: false,
    hasGeneralization: false,
    recallScore: 0,
    vocab: 300,
    unknownCount: 0,
    factConfidence: 0,
    generalizeStrength: 0,
    lessonLanded: false,
    ruleToTest: false,
  });
  assert.ok(!allowed.includes('ANSWER_MEMORY'), 'جوابٌ بلا حقيقة ممنوع مهما كان هدفه');
});

/* ————— ٤) الأذن والجسد يصلان ————— */

test('الصوت العالي المجهول يُفزعه، والمألوف يُطمئنه', () => {
  const startled = new Emotion();
  startled.heard({ loudness: 0.9, familiarity: 0.05, harsh: true });
  assert.ok(startled.feelings.basic['خوف'] > 0.3,
    `الضجيج العالي يُخيف (${startled.feelings.basic['خوف'].toFixed(2)})`);

  const soothed = new Emotion();
  soothed.heard({ loudness: 0.4, familiarity: 0.9, harsh: false });
  assert.ok(soothed.feelings.basic['سعادة'] > 0.2,
    `والصوت المألوف يُطمئن (${soothed.feelings.basic['سعادة'].toFixed(2)})`);
  assert.equal(soothed.feelings.basic['خوف'], 0, 'ولا يُخيف');
});

test('ما تسمعه أذنه يبلغ حوفيّه في النبضة — وكان لا يبلغ أحداً', async () => {
  const zubair = await child(0x6c1a);
  const at = Date.now();

  // ضجيج عالٍ: موجة عشوائية قوية
  const samples = new Float32Array(2048);
  for (let i = 0; i < samples.length; i++) samples[i] = ((i * 7919) % 211) / 105 - 1;
  const audio: RawAudio = { samples, sampleRate: 16000 };

  const before = zubair.mood.basic['خوف'];
  for (let i = 0; i < 6; i++) zubair.listen(audio, at + i * 60);
  const out = await zubair.hear('مرحبا', at + 400);

  const heardStep = out.trace.some((step) => step.lobe === 'auditoryCortex');
  assert.ok(heardStep,
    `أثر النبضة يذكر ما سمعه: ${out.trace.map((s) => s.lobe).join('، ')}`);
  assert.ok(zubair.mood.basic['خوف'] >= before, 'وما سمعه بلغ مشاعره');
});

test('وما يحسّه جسده يُذكَر في نبضته', async () => {
  const zubair = await child(0x7d3b);
  const at = Date.now();
  const touch: RawTouch = { x: 0.5, y: 0.5, force: 0.7, durationMs: 800 };
  for (let i = 0; i < 4; i++) zubair.feel(touch, null, at + i * 80);

  const out = await zubair.hear('مرحبا', at + 400);
  assert.ok(out.trace.some((step) => step.lobe === 'somatosensory'),
    `أثر النبضة يذكر ما حسّه: ${out.trace.map((s) => s.lobe).join('، ')}`);
});

/* ————— ولا قائمةَ تُكتب مرّتين ————— */

test('نوع العلاقة يُعرَّف في موضع واحد', async () => {
  const { RELATION_KINDS } = await import('../lobes/parietal.js');
  const syntax = new Syntax();
  // كل ما يطلبه سؤالٌ يجب أن يكون علاقةً يعرفها الجُداري
  for (const asks of ['جنس', 'كيفية', 'عدد', 'مكان', 'زمان', 'شخص', 'تصديق'] as const) {
    const relation = syntax.relationFor(asks);
    if (relation === null) continue;
    assert.ok(RELATION_KINDS.includes(relation),
      `«${asks}» يطلب «${relation}» وهي علاقة يعرفها الجُداري`);
  }
});
