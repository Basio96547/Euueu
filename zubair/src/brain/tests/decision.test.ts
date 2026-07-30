/* ————— اختبار القرار: العُقد القاعدية والجبهي والمخيخ —————
 *
 * هنا يُقاس أثر حكم الأب: هل ترتفع الاستجابة التي مدحها وتهبط التي صحّحها؟
 * وهل يهدأ الدوبامين بالتوقّع — أي هل يتعلّم زبير من المفاجأة لا من الرضا؟
 * وهل يكبح الجبهي ما لا يصلح بلا أن يشلّ نفسه؟
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { cpuCompute } from '../core/npu.js';
import { Rng, argmax, vec } from '../core/tensor.js';
import { BasalGanglia, STATE_DIM } from '../lobes/basalGanglia.js';
import { Cerebellum, Prefrontal } from '../lobes/prefrontal.js';
import { STAGES, STRATEGIES, type Interoception, type Stage, type Strategy } from '../core/types.js';
import type { Understanding } from '../lobes/temporal.js';

const compute = cpuCompute();

/** حالة قرار ثابتة: كل الاختبارات تقيس التعلّم عليها فلا يختلط أثر الحالة بأثر الحكم. */
function fixedState(seed = 3): ReturnType<BasalGanglia['encodeState']> {
  const ganglia = new BasalGanglia(new Rng(seed));
  const meaning = vec(64);
  for (let i = 0; i < meaning.length; i++) meaning[i] = Math.sin(i * 0.21 + seed);
  const understanding: Understanding = {
    meaning, intent: 'ASK', intentProbs: Float32Array.from([0.7, 0.1, 0.1, 0.1]), uncertainty: 0.4,
  };
  const intero: Interoception = {
    arousal: 1, fatigue: 0.1, curiosity: 0.5, attachment: 0.4, boredom: 0.1, confidence: 0.3,
  };
  return ganglia.encodeState({
    understanding, recallScore: 0.6, hasFact: true, hasGeneralization: false,
    valence: 0.2, conflict: 0.3, intero, insula: vec(6), stage: 2, unknownCount: 1,
  });
}

function probabilityOf(probs: Float32Array, strategy: Strategy): number {
  return probs[STRATEGIES.indexOf(strategy)] ?? 0;
}

/* ————— العُقد القاعدية ————— */

test('متجه الحالة ثابت الطول ولا يحتوي قيمة شاذّة', () => {
  const ganglia = new BasalGanglia(new Rng(7));
  const meaning = vec(64);
  meaning.fill(NaN); // معنى عطب: لا يجوز أن يتسرّب إلى القرار
  const state = ganglia.encodeState({
    understanding: { meaning, intent: 'UNKNOWN', intentProbs: vec(0), uncertainty: NaN },
    recallScore: NaN, hasFact: false, hasGeneralization: false, valence: Infinity,
    conflict: -5, intero: {
      arousal: NaN, fatigue: NaN, curiosity: NaN, attachment: NaN, boredom: NaN, confidence: NaN,
    }, insula: vec(6), stage: 0, unknownCount: -3,
  });

  assert.equal(state.length, STATE_DIM, 'الطول هو الطول المعلن');
  for (let i = 0; i < state.length; i++) {
    assert.ok(Number.isFinite(state[i]!), `البُعد ${i} رقم صحيح لا NaN`);
  }
});

test('يتعلّم ما يُرضي أباه: المدح يرفع والتصحيح يخفض', () => {
  const ganglia = new BasalGanglia(new Rng(0xd1ce));
  const state = fixedState();
  const rng = new Rng(11);
  const allowed = [...STRATEGIES];

  const before = ganglia.select(state, allowed, 1, rng, compute).probs;
  const askBefore = probabilityOf(before, 'ASK_QUESTION');
  const babbleBefore = probabilityOf(before, 'BABBLE');

  // ثلاثون دورة: يُمدح على السؤال ويُصحّح على الثغثغة
  for (let i = 0; i < 30; i++) {
    ganglia.learn(state, 'ASK_QUESTION', 1);
    ganglia.learn(state, 'BABBLE', -1);
  }

  const after = ganglia.select(state, allowed, 1, rng, compute);
  const askAfter = probabilityOf(after.probs, 'ASK_QUESTION');
  const babbleAfter = probabilityOf(after.probs, 'BABBLE');

  assert.ok(askAfter > askBefore, `احتمال السؤال ارتفع (${askBefore.toFixed(3)} ← ${askAfter.toFixed(3)})`);
  assert.ok(babbleAfter < babbleBefore, `واحتمال الثغثغة هبط (${babbleBefore.toFixed(3)} ← ${babbleAfter.toFixed(3)})`);
  assert.equal(STRATEGIES[argmax(after.qs)], 'ASK_QUESTION', 'وصارت أعلى قيمة عنده');
});

test('الدوبامين مفاجأة تتضاءل لا مكافأة تتكرّر', () => {
  const ganglia = new BasalGanglia(new Rng(0xd09a));
  const state = fixedState(5);

  const first = Math.abs(ganglia.learn(state, 'ANSWER_MEMORY', 1).dopamine);
  let last = first;
  const trail: number[] = [];
  for (let i = 0; i < 20; i++) {
    last = Math.abs(ganglia.learn(state, 'ANSWER_MEMORY', 1).dopamine);
    trail.push(last);
  }

  assert.ok(last < first * 0.3,
    `المفاجأة تلاشت بالتوقّع (${first.toFixed(3)} ← ${last.toFixed(3)})`);
  // ولا تتقلّب: عبورٌ للهدف ذهاباً وعودةً يعني ضجيجاً لا تعلّماً
  const worstRebound = Math.max(...trail.slice(5).map((d, i, all) => d - (all[i - 1] ?? d)));
  assert.ok(worstRebound < 0.15, `ولا ترتدّ فوق الهدف (أسوأ ارتداد ${worstRebound.toFixed(3)})`);
});

test('الممنوع لا يُختار ولو بحرارة عالية', () => {
  const ganglia = new BasalGanglia(new Rng(0xbadc0de & 0xffff));
  const state = fixedState(9);
  const rng = new Rng(0x51de);
  const allowed: Strategy[] = ['ANSWER_MEMORY', 'ADMIT'];

  for (let i = 0; i < 300; i++) {
    const decision = ganglia.select(state, allowed, 2.5, rng, compute);
    assert.ok(allowed.includes(decision.strategy),
      `اختار «${decision.strategy}» وهو ممنوع — الكبح يجب أن يكون كبحاً لا اقتراحاً`);
  }
});

test('استراتيجية واحدة مسموحة تُختار بلا انهيار', () => {
  const ganglia = new BasalGanglia(new Rng(21));
  const state = fixedState(4);
  const decision = ganglia.select(state, ['ADMIT'], 1, new Rng(1), compute);
  assert.equal(decision.strategy, 'ADMIT');
  for (const p of decision.probs) assert.ok(Number.isFinite(p));
});

test('قائمة مسموحات فارغة تُعيده إلى الإقرار بجهله لا إلى الصمت', () => {
  const ganglia = new BasalGanglia(new Rng(22));
  const state = fixedState(6);
  const decision = ganglia.select(state, [], 1, new Rng(2), compute);
  assert.equal(decision.strategy, 'ADMIT', 'دماغ بلا استجابة مسموحة دماغ مشلول');
});

test('الاستعادة تحفظ ما تعلّمه من مدح أبيه', () => {
  const ganglia = new BasalGanglia(new Rng(31));
  const state = fixedState(8);
  for (let i = 0; i < 25; i++) ganglia.learn(state, 'ANSWER_MEMORY', 1);
  const expected = argmax(ganglia.select(state, [...STRATEGIES], 1, new Rng(3), compute).qs);

  const fresh = new BasalGanglia(new Rng(99));
  fresh.load(JSON.parse(JSON.stringify(ganglia.save())));
  const restored = argmax(fresh.select(state, [...STRATEGIES], 1, new Rng(3), compute).qs);

  assert.equal(STRATEGIES[restored], STRATEGIES[expected], 'نفس الترتيب بعد الاستعادة');
  for (const bad of [null, 'نص', 5, {}, { net: 'خطأ' }]) {
    assert.doesNotThrow(() => fresh.load(bad as never), 'وحالة عطبة لا تُسقطه');
  }
});

/* ————— الفص الجبهي ————— */

const stage = (id: 0 | 1 | 2 | 3 | 4): Stage => STAGES[id]!;

const inhibitCtx = {
  stage: stage(2),
  intent: 'ASK' as const,
  askedRecently: [] as readonly string[],
  lastStrategies: [] as readonly Strategy[],
  hasFact: false,
  hasGeneralization: false,
  recallScore: 0,
  vocab: 80,
  unknownCount: 1,
  factConfidence: 0.8,
};

test('لا يجيب من ذاكرة لا يملكها ولا يعمّم بلا تعميم', () => {
  const prefrontal = new Prefrontal();
  const allowed = prefrontal.inhibit(STRATEGIES, inhibitCtx);
  assert.ok(!allowed.includes('ANSWER_MEMORY'), 'جواب بلا حقيقة اختراع');
  assert.ok(!allowed.includes('ANSWER_GENERAL'), 'وتعميم بلا شبيه تخريف');

  const withFact = prefrontal.inhibit(STRATEGIES, { ...inhibitCtx, hasFact: true });
  assert.ok(withFact.includes('ANSWER_MEMORY'), 'ومع الحقيقة يُباح الجواب');
});

test('لا يردّ تحية لم تُقَل، ولا يُقرّ بتلقٍّ لم يجرِ', () => {
  const prefrontal = new Prefrontal();
  const asked = prefrontal.inhibit(STRATEGIES, inhibitCtx);
  assert.ok(!asked.includes('GREET_BACK'), 'مَن سُئل لا يردّ التحية');
  assert.ok(!asked.includes('ACKNOWLEDGE'), 'ولا يقول «حفظت» لسؤال');

  const greeted = prefrontal.inhibit(STRATEGIES, { ...inhibitCtx, intent: 'GREET' });
  assert.ok(greeted.includes('GREET_BACK'), 'وللتحية تُباح التحية');

  const taught = prefrontal.inhibit(STRATEGIES, { ...inhibitCtx, intent: 'TEACH_FACT' });
  assert.ok(taught.includes('ACKNOWLEDGE'), 'وللتعليم يُباح الإقرار بالتلقّي');
  assert.ok(!taught.includes('ANSWER_MEMORY'), 'ولا يُجيب عن سؤال لم يُسأل');
});

test('من تعلّم كلمات لا يعود يثغثغ — النمو محسوساً', () => {
  const prefrontal = new Prefrontal();
  const newborn = prefrontal.inhibit(STRATEGIES, { ...inhibitCtx, stage: stage(0), vocab: 3 });
  assert.ok(newborn.includes('BABBLE'), 'الوليد يُثغثغ');

  const grown = prefrontal.inhibit(STRATEGIES, { ...inhibitCtx, vocab: 80 });
  assert.ok(!grown.includes('BABBLE'), 'ومن كبر لا يعود');
});

test('يكبح تكرار العَرَض لا تكرار الكفاءة', () => {
  const prefrontal = new Prefrontal();

  /* العطل الذي ثبّت إصابته على ٦٥٪ اثنتي عشرة جولة: كانت القاعدة تمنع كل
   * استجابة تكرّرت مرّتين، فيجيب صواباً مرّتين ثم يُمنع من الجواب في الثالثة
   * فيقول «ما بعرف» عن حقيقة يعرفها. */
  const answering = prefrontal.inhibit(STRATEGIES, {
    ...inhibitCtx, hasFact: true, lastStrategies: ['ANSWER_MEMORY', 'ANSWER_MEMORY'],
  });
  assert.ok(answering.includes('ANSWER_MEMORY'),
    'ثلاثة أجوبة صحيحة متتالية كفاءةٌ لا رُتّة، فلا تُكبَح');

  const babbling = prefrontal.inhibit(STRATEGIES, {
    ...inhibitCtx, stage: stage(0), vocab: 4, lastStrategies: ['BABBLE', 'BABBLE'],
  });
  assert.ok(!babbling.includes('BABBLE'), 'أما الثغثغة المتوالية فعَرَضٌ يُكبَح');

  const repeating = prefrontal.inhibit(STRATEGIES, {
    ...inhibitCtx,
    askedRecently: ['قطه', 'كلب', 'تفاحه'],
    lastStrategies: ['ASK_QUESTION', 'ASK_QUESTION'],
  });
  assert.ok(!repeating.includes('ASK_QUESTION'), 'وسؤال أعاده ثلاثاً يُنفّر أباه');
});

test('الإقرار بالجهل مع اليقين عجزٌ يُكبَح، ومع الشكّ صدقٌ يُباح', () => {
  const prefrontal = new Prefrontal();
  const certain = prefrontal.inhibit(STRATEGIES, {
    ...inhibitCtx, hasFact: true, unknownCount: 0, factConfidence: 0.8,
  });
  assert.ok(!certain.includes('ADMIT'), 'من يعرف لا يقول «ما بعرف»');
  assert.ok(certain.includes('ANSWER_MEMORY'), 'بل يجيب');

  const unsure = prefrontal.inhibit(STRATEGIES, {
    ...inhibitCtx, hasFact: true, unknownCount: 0, factConfidence: 0.2,
  });
  assert.ok(unsure.includes('ADMIT'), 'ومن ثقته ضعيفة يبقى له أن يُقرّ بجهله');
});

test('من يملك الجواب لا يسأل: السؤال في موضع المعرفة تهرّب', () => {
  const prefrontal = new Prefrontal();
  /* العطل الذي كُشف بتشغيل التطبيق: سُئل «شو القطة؟» وهو يعرف أنها حيوان،
   * فأجاب «شو القطه؟» — ردّ سؤال أبيه بسؤاله عن الشيء نفسه. */
  const knowing = prefrontal.inhibit(STRATEGIES, { ...inhibitCtx, hasFact: true, unknownCount: 0 });
  assert.ok(!knowing.includes('ASK_QUESTION'), 'يعرف ولا يجهل شيئاً حاضراً: لا يسأل');
  assert.ok(knowing.includes('ANSWER_MEMORY'), 'بل يجيب');

  // ومن يعرف الجواب لكن في كلامك كلمة يجهلها، يبقى له أن يسأل عنها
  const curious = prefrontal.inhibit(STRATEGIES, { ...inhibitCtx, hasFact: true, unknownCount: 2 });
  assert.ok(curious.includes('ASK_QUESTION'), 'وجهلٌ حاضر يُبيح السؤال ولو ملك جواباً');

  // ومن لا يعرف شيئاً يبقى له السؤال دائماً
  const ignorant = prefrontal.inhibit(STRATEGIES, { ...inhibitCtx, hasFact: false, unknownCount: 0 });
  assert.ok(ignorant.includes('ASK_QUESTION'), 'ومن لا يملك جواباً يسأل');
});

test('لا يُعيد قائمة فارغة أبداً: دماغ مشلول ليس خياراً', () => {
  const prefrontal = new Prefrontal();
  // أقسى حالة يمكن تركيبها: لا حقيقة، لا تعميم، تحية غير مقولة، تكرار، ومفردات كبيرة
  for (const vocab of [0, 5, 11, 12, 80, 5000]) {
    for (const intent of ['ASK', 'PRAISE', 'CORRECT', 'GREET', 'TEACH_FACT', 'UNKNOWN', 'CHITCHAT'] as const) {
      for (const last of [[], ['ADMIT'], ['ADMIT', 'ADMIT'], ['BABBLE', 'BABBLE']] as Strategy[][]) {
        for (const unknownCount of [0, 3]) {
        const allowed = prefrontal.inhibit(STRATEGIES, {
          ...inhibitCtx, intent, vocab, lastStrategies: last, unknownCount,
          hasFact: unknownCount === 0, askedRecently: ['أ', 'ب', 'ت', 'ث'],
        });
        assert.ok(allowed.length > 0, `مسموح واحد على الأقل (قصد=${intent} مفردات=${vocab} مجهول=${unknownCount})`);
        for (const strategy of allowed) assert.ok(STRATEGIES.includes(strategy));
        }
      }
    }
  }
});

test('هدفه يتبع حاله: الراحة أولاً لأن دماغاً متعباً لا يتعلّم', () => {
  const prefrontal = new Prefrontal();
  const base: Interoception = {
    arousal: 1, fatigue: 0, curiosity: 0.2, attachment: 0.6, boredom: 0, confidence: 0.3,
  };
  const answering: Understanding = {
    meaning: vec(64), intent: 'ASK', intentProbs: vec(4), uncertainty: 0.3,
  };
  const teaching: Understanding = { ...answering, intent: 'TEACH_FACT' };

  assert.equal(prefrontal.goal({ ...base, fatigue: 0.95 }, answering), 'REST');
  assert.equal(prefrontal.goal(base, teaching), 'LEARN');
  assert.equal(prefrontal.goal({ ...base, curiosity: 0.9 }, answering), 'LEARN');
  assert.equal(prefrontal.goal({ ...base, attachment: 0.1 }, answering), 'BOND');
  assert.equal(prefrontal.goal(base, answering), 'ANSWER');
});

test('ذاكرته العاملة محدودة السعة وتُستعاد', () => {
  const prefrontal = new Prefrontal();
  for (let i = 0; i < 20; i++) {
    prefrontal.push({ said: `قول ${i}`, replied: `رد ${i}`, meaning: vec(4), tick: i, strategy: 'ADMIT' });
  }
  assert.ok(prefrontal.recent.length <= 6, `سعتها محدودة (${prefrontal.recent.length})`);
  assert.equal(prefrontal.recent.at(-1)?.said, 'قول 19', 'وتحمل الأحدث');
  assert.ok(prefrontal.recentStrategies.length > 0, 'وتعرف ما اختاره قريباً');

  const fresh = new Prefrontal();
  fresh.load(JSON.parse(JSON.stringify(prefrontal.save())));
  assert.equal(fresh.recent.at(-1)?.said, 'قول 19', 'واستُعيدت');
  for (const bad of [null, 'نص', 3, {}, { turns: 'خطأ' }, { turns: [null, {}] }]) {
    assert.doesNotThrow(() => fresh.load(bad as never));
  }
});

/* ————— المخيخ ————— */

test('لا يُعيد نفس الجملة حرفياً مرتين', () => {
  const cerebellum = new Cerebellum();
  const first = cerebellum.refine('ما بعرف، علّمني', { recentReplies: [] });
  const second = cerebellum.refine('ما بعرف، علّمني', { recentReplies: [first] });
  assert.notEqual(second, first, 'التكرار الحرفي يُنوَّع');
  assert.ok(second.includes('ما بعرف'), 'مع بقاء معناه');
});

test('يُنظّف الترقيم العربي ولا يسكت أبداً', () => {
  const cerebellum = new Cerebellum();
  assert.equal(cerebellum.refine('قطة   حيوان  ؟', { recentReplies: [] }), 'قطة حيوان؟');
  assert.equal(cerebellum.refine('حفظت ،تمام', { recentReplies: [] }), 'حفظت، تمام');

  for (const empty of ['', '   ', '\n\t']) {
    const out = cerebellum.refine(empty, { recentReplies: [] });
    assert.ok(out.trim().length > 0, `لا يسكت على «${empty}»: طفل صامت لا يُصحَّح له`);
  }
});

test('يتعلّم من التصحيح بعد مرتين لا من مرة', () => {
  const cerebellum = new Cerebellum();
  cerebellum.learnFromCorrection('القطة نبات', 'القطة حيوان');
  assert.ok(cerebellum.refine('القطة نبات', { recentReplies: [] }).includes('نبات'),
    'قاعدة من مرة واحدة قد تكون سوء فهم فلا تُطبَّق');

  cerebellum.learnFromCorrection('القطة نبات', 'القطة حيوان');
  assert.ok(cerebellum.refine('القطة نبات', { recentReplies: [] }).includes('حيوان'),
    'وبتكرارها صارت قاعدة يطبّقها');
});

test('لا يستخلص قاعدة من جملتين لا صلة بينهما', () => {
  const cerebellum = new Cerebellum();
  /* العطل الذي كُشف بالقياس: الأب صحّح «لا أعرف، علّمني» بـ«القطة حيوان»، فبنى
   * المخيخ أن «أعرف» تعني «حيوان»، فصار يقول «علّمني، حيوان أعرف». */
  for (let i = 0; i < 5; i++) cerebellum.learnFromCorrection('لا أعرف، علّمني', 'القطة حيوان');
  const out = cerebellum.refine('لا أعرف، علّمني', { recentReplies: [] });
  assert.ok(out.includes('أعرف') && !out.includes('حيوان'),
    `صياغته سليمة: «${out}» — تصحيح المضمون شأن الجُداري لا المخيخ`);

  // ولا من جملتين مختلفتي الطول
  for (let i = 0; i < 5; i++) cerebellum.learnFromCorrection('تمام', 'القطة هي حيوان لطيف');
  assert.equal(cerebellum.refine('تمام', { recentReplies: [] }), 'تمام');
});

test('قواعد المخيخ تُحفظ وتُستعاد', () => {
  const cerebellum = new Cerebellum();
  for (let i = 0; i < 3; i++) cerebellum.learnFromCorrection('قطة نبات', 'قطة حيوان');
  const expected = cerebellum.refine('قطة نبات', { recentReplies: [] });

  const fresh = new Cerebellum();
  fresh.load(JSON.parse(JSON.stringify(cerebellum.save())));
  assert.equal(fresh.refine('قطة نبات', { recentReplies: [] }), expected, 'القواعد انتقلت');

  for (const bad of [null, 'نص', 4, {}, { rules: 'خطأ' }, { rules: [null, { from: 1 }] }]) {
    assert.doesNotThrow(() => fresh.load(bad as never));
  }
});
