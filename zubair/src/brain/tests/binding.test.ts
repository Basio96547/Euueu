/* ————— اختبار الربط والدوافع: الجُداري والجهاز الحوفي —————
 *
 * الجُداري يُختبر بما لا يفعله أكثر ممّا يفعله: حقيقة ملفّقة أسوأ من لا حقيقة،
 * لأن زبير يجيب بها واثقاً فيتعلّم أبوه أن يكذّبه. والحوفي يُختبر بحدوده: قيمة
 * تخرج من [0,1] أو تصير NaN تُفسد كل قرار بعدها في الدماغ.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Lexicon } from '../core/text.js';
import { cpuCompute } from '../core/npu.js';
import { Rng, vec } from '../core/tensor.js';
import { Parietal } from '../lobes/parietal.js';
import { Amygdala, Cingulate, Hypothalamus, Insula, INSULA_ORDER } from '../lobes/limbic.js';
import { DIMS, type Interoception } from '../core/types.js';

const compute = cpuCompute();

function lexiconWith(sentences: readonly string[]): Lexicon {
  const lexicon = new Lexicon(new Rng(0x4b1d));
  for (const sentence of sentences) lexicon.perceive(sentence, true);
  return lexicon;
}

/* ————— الفص الجُداري: الاستخلاص ————— */

test('يستخلص العلاقة من ستّ صيغ عربية', () => {
  const parietal = new Parietal();
  const lexicon = new Lexicon(new Rng(1));

  const cases: Array<[string, string, string]> = [
    ['القطة هي حيوان', 'قطه', 'حيوان'],
    ['الكلب هو حيوان', 'كلب', 'حيوان'],
    ['التفاحة يعني فاكهة', 'تفاحه', 'فاكهه'],
    ['الجوال عبارة عن جهاز', 'جوال', 'جهاز'],
    ['هذه تفاحة', 'هذه', 'تفاحه'],
    ['البندورة خضار', 'بندوره', 'خضار'],
  ];

  for (const [sentence, subject, object] of cases) {
    const percept = lexicon.perceive(sentence, true);
    const bound = parietal.bind(percept, 'TEACH_FACT');
    assert.equal(bound.subject, subject, `موضوع «${sentence}»`);
    assert.equal(bound.object, object, `محمول «${sentence}»`);
  }
});

test('لا يفبرك علاقة حيث لا علاقة', () => {
  const parietal = new Parietal();
  const lexicon = new Lexicon(new Rng(2));

  const noRelation = [
    'شو القطة؟',        // سؤال لا تعليم
    'أحسنت',            // كلمة واحدة
    'مرحبا يا زبير',    // تحية
    'خرجت من البيت',    // «من» حرف جرّ لفعل لا رابط
    'القطة هي القطة',   // ترديد لا حقيقة
    '',                 // فراغ
  ];

  for (const sentence of noRelation) {
    const bound = parietal.bind(lexicon.perceive(sentence, true), 'TEACH_FACT');
    assert.equal(bound.subject, null, `«${sentence}» لا موضوع فيها`);
    assert.equal(bound.object, null, `«${sentence}» لا محمول فيها`);
  }
});

/* ————— الفص الجُداري: الثقة ————— */

test('الثقة تقاربية: التكرار يقرّبها من الواحد ولا يبلغه', () => {
  const parietal = new Parietal();
  const first = parietal.learnFact('قطه', 'حيوان', 1, 'أبوه');
  assert.ok(first.confidence > 0 && first.confidence < 1, `ثقة أول سماع ${first.confidence}`);

  let previous = first.confidence;
  for (let i = 0; i < 50; i++) {
    const again = parietal.learnFact('قطه', 'حيوان', i + 2, 'أبوه');
    assert.ok(again.confidence >= previous, 'التكرار لا يُنقص الثقة');
    assert.ok(again.confidence <= 1, `لا تتجاوز الواحد أبداً (${again.confidence})`);
    previous = again.confidence;
  }
  assert.ok(previous > 0.99, `بلغت ما يقارب الواحد بعد خمسين تكراراً (${previous.toFixed(4)})`);
  assert.ok(previous < 1, 'ولا حقيقة في دماغه لا تقبل النقض');
});

test('التصحيح يهدم الثقة، والإصرار يقلب الغالب، والمتهاوي يُنسى', () => {
  const parietal = new Parietal();
  parietal.learnFact('قطه', 'حيوان', 1, 'أبوه');
  const strong = parietal.lookup('قطه')?.confidence ?? 0;

  parietal.contradict('قطه', 'حيوان');
  const hit = parietal.lookup('قطه');
  assert.ok(hit === null || hit.confidence < strong, 'التكذيب يهدم الثقة لا يُبقيها');

  // الإصرار على بديل يقلب الغالب — لا كلمة واحدة تقلب معرفته
  const other = new Parietal();
  other.learnFact('قطه', 'حيوان', 1, 'أبوه');
  other.learnFact('قطه', 'نبات', 2, 'أبوه');
  assert.equal(other.lookup('قطه')?.object, 'حيوان', 'لا يقلب معرفته من مرة واحدة');
  for (let i = 0; i < 6; i++) other.learnFact('قطه', 'نبات', i + 3, 'أبوه');
  assert.equal(other.lookup('قطه')?.object, 'نبات', 'لكنه يقلبها بالإصرار');

  // الثقة المتهاوية تُزيل الحقيقة كلها: خير له أن يجهل من أن يعرف خطأ
  const doomed = new Parietal();
  doomed.learnFact('بندوره', 'حيوان', 1, 'أبوه');
  for (let i = 0; i < 8; i++) doomed.contradict('بندوره', 'حيوان');
  assert.equal(doomed.lookup('بندوره'), null, 'سقطت الحقيقة بعد الإصرار على تكذيبها');
});

/* ————— الفص الجُداري: التعميم ————— */

test('يعمّم على الشبيه القريب، ويسكت حين يكون الشبه بعيداً', () => {
  const lexicon = lexiconWith(['القطة حيوان', 'الكلب حيوان', 'التفاحة فاكهة']);
  const parietal = new Parietal();
  parietal.learnFact('قطه', 'حيوان', 1, 'أبوه');
  parietal.learnFact('تفاحه', 'فاكهه', 2, 'أبوه');

  /* «القطط» جمعُ ما عُلّمه: تشترك معه في ملامح حروفه فتتجاوز العتبة. القياس
   * على الملامح لا على معنى متعلَّم، لأن كلمة لم يسمعها قط لا تمثيل لها بعد.
   * والتشابه المرصود هنا ٠٫٣٤ — فوق العتبة المقيسة (٠٫٣) لا فوق تقدير. */
  const near = parietal.generalize('قطط', lexicon);
  assert.ok(near !== null, `نقل محمولاً إلى موضوع لم يُعلَّم قط`);
  assert.equal(near?.fact.object, 'حيوان', 'ومن أقرب شبيه لا من أي حقيقة');
  assert.ok(near !== null && near.similarity >= 0.3, `الشبه فوق العتبة (${near?.similarity.toFixed(3)})`);
  assert.ok(near !== null && near.fact.confidence < (parietal.lookup('قطه')?.confidence ?? 1),
    'وثقة التخمين أدنى من ثقة الدرس الذي قِيس عليه');
  assert.ok(near !== null && near.fact.taughtBy.includes('تعميم'), 'ويُفصح أنه تخمين لا درس');

  /* العتبة تُقاس بما تمنعه لا بما تسمح به: أي موضوع مهما بَعُد إمّا يُرفض أو
   * يُقبل بشبه فوق العتبة. التعميم بلا عتبة يجعل كل مجهول «حيواناً» لأن شيئاً
   * في دماغه أقرب إليه من غيره — والأقرب ليس قريباً بالضرورة. */
  for (const stranger of ['برتقال', 'زجزج', 'خ', 'كمبيوتر', 'مستشفي']) {
    const guess = parietal.generalize(stranger, lexicon);
    if (guess !== null) {
      assert.ok(guess.similarity >= 0.3,
        `«${stranger}» عُمّم عليه بشبه ${guess.similarity.toFixed(3)} — فوق العتبة`);
    }
  }

  // وما يعرفه صريحاً لا يُخمَّن: الدرس أصدق من القياس عليه
  assert.equal(parietal.generalize('قطه', lexicon), null, 'لا تخمين فيما عُلّم صريحاً');
  assert.equal(parietal.generalize('القطة', lexicon), null, 'ولو جاء معرَّفاً بأل');
});

test('الاستعادة تحفظ الحقائق وثقتها وبديلها', () => {
  const parietal = new Parietal();
  parietal.learnFact('قطه', 'حيوان', 5, 'أبوه');
  parietal.learnFact('قطه', 'حيوان', 6, 'أبوه');
  parietal.learnFact('قطه', 'نبات', 7, 'أبوه');
  parietal.learnFact('دمشق', 'مدينه', 8, 'أبوه');
  const expected = parietal.facts.length;
  const confidence = parietal.lookup('قطه')?.confidence ?? 0;

  const fresh = new Parietal();
  fresh.load(JSON.parse(JSON.stringify(parietal.save())));

  assert.equal(fresh.facts.length, expected, 'كل الحقائق انتقلت');
  assert.equal(fresh.lookup('قطه')?.object, 'حيوان');
  assert.ok(Math.abs((fresh.lookup('قطه')?.confidence ?? 0) - confidence) < 1e-6, 'بنفس الثقة');

  // والبديل المتنازع محفوظ أيضاً: بلاه يعود الإصرار من الصفر
  for (let i = 0; i < 5; i++) fresh.learnFact('قطه', 'نبات', 20 + i, 'أبوه');
  assert.equal(fresh.lookup('قطه')?.object, 'نبات', 'البديل استُعيد فقلب الغالب');
});

test('الحالة العطبة لا تُسقط الجُداري', () => {
  const parietal = new Parietal();
  const junk: unknown[] = [
    null, 'نص', 7, [], {}, { facts: 'خطأ' },
    { facts: [null, 3, { subject: '' }, { subject: 'س', object: 'ص', confidence: NaN }] },
  ];
  for (const bad of junk) assert.doesNotThrow(() => parietal.load(bad as never));
  assert.doesNotThrow(() => parietal.learnFact('قطه', 'حيوان', 1, 'أبوه'));
});

/* ————— اللوزة ————— */

test('اللوزة تتعلّم الخوف بالاشتراط', () => {
  const amygdala = new Amygdala(new Rng(0xa1));
  const meaning = vec(DIMS.meaning);
  for (let i = 0; i < meaning.length; i++) meaning[i] = Math.sin(i * 0.3);

  const before = amygdala.valence(meaning, compute);
  for (let i = 0; i < 25; i++) amygdala.condition(meaning, -1, 0.06);
  const after = amygdala.valence(meaning, compute);

  assert.ok(after < before, `الوسم صار أسلب (${before.toFixed(3)} ← ${after.toFixed(3)})`);
  assert.ok(after < -0.2, `وصار سلبياً فعلاً (${after.toFixed(3)})`);
  assert.ok(after >= -1 && after <= 1, 'وبقي في مجاله');

  // والمدح يعكسه: ليس خوفاً دائماً بل وسماً يتبع التجربة
  for (let i = 0; i < 40; i++) amygdala.condition(meaning, 1, 0.06);
  assert.ok(amygdala.valence(meaning, compute) > after, 'المدح المتكرّر يعكس الوسم');
});

/* ————— الوطاء ————— */

const zeroInput = {
  unknownCount: 0, repeatedInput: false, awayMs: 0, lessonsSinceSleep: 0, knownVocab: 0,
};

test('الفضول من الجهل الحاضر لا من العشوائية', () => {
  const hypothalamus = new Hypothalamus();
  for (let i = 0; i < 5; i++) hypothalamus.update({ ...zeroInput, unknownCount: 4 });
  const curious = hypothalamus.state.curiosity;
  for (let i = 0; i < 5; i++) hypothalamus.update({ ...zeroInput, unknownCount: 0 });
  const calm = hypothalamus.state.curiosity;

  assert.ok(curious > calm, `الفضول يرتفع بالمجهول ويهدأ بلا مجهول (${curious.toFixed(2)} ← ${calm.toFixed(2)})`);
  assert.ok(curious > 0.5, 'ويبلغ حدّاً يدفعه للسؤال');
});

test('الملل من تكرارك، والتعب من التعلّم بلا نوم', () => {
  const hypothalamus = new Hypothalamus();
  hypothalamus.update({ ...zeroInput, repeatedInput: false });
  const fresh = hypothalamus.state.boredom;
  for (let i = 0; i < 6; i++) hypothalamus.update({ ...zeroInput, repeatedInput: true });
  const bored = hypothalamus.state.boredom;
  assert.ok(bored > fresh, `الملل يرتفع بالتكرار (${fresh.toFixed(2)} ← ${bored.toFixed(2)})`);

  hypothalamus.update({ ...zeroInput, repeatedInput: false });
  assert.ok(hypothalamus.state.boredom < bored, 'وجملة جديدة تُذهبه');

  hypothalamus.update({ ...zeroInput, lessonsSinceSleep: 25 });
  assert.ok(hypothalamus.state.fatigue > 0.9, 'التعلّم بلا تثبيت يُتعبه فيطلب النوم');
  hypothalamus.onSleep();
  assert.equal(hypothalamus.state.fatigue, 0, 'والنوم يُصفّر تعبه');
  assert.equal(hypothalamus.state.boredom, 0, 'ومَلله');
});

test('التعلّق ينمو بالصحبة ويهبط بالغياب، ولا ينكر أباه أبداً', () => {
  const hypothalamus = new Hypothalamus();
  for (let i = 0; i < 200; i++) hypothalamus.update(zeroInput);
  const attached = hypothalamus.state.attachment;
  assert.ok(attached > 0.3, `التعلّق نما بطول الصحبة (${attached.toFixed(2)})`);

  // سنة غياب كاملة
  hypothalamus.update({ ...zeroInput, awayMs: 365 * 24 * 60 * 60 * 1000 });
  const faded = hypothalamus.state.attachment;
  assert.ok(faded < attached, `هبط بالغياب (${attached.toFixed(2)} ← ${faded.toFixed(2)})`);
  assert.ok(faded >= 0.25, `ولم ينزل عن أرضيته: لا ينكر أباه (${faded.toFixed(2)})`);
});

test('كل دوافعه في مجالها ولو كانت المدخلات متطرّفة', () => {
  const hypothalamus = new Hypothalamus();
  const extremes = [
    { unknownCount: 1e9, repeatedInput: true, awayMs: 1e15, lessonsSinceSleep: 1e6, knownVocab: 1e9 },
    { unknownCount: -5, repeatedInput: false, awayMs: -1, lessonsSinceSleep: -10, knownVocab: -100 },
    { unknownCount: NaN, repeatedInput: true, awayMs: NaN, lessonsSinceSleep: NaN, knownVocab: NaN },
    { unknownCount: Infinity, repeatedInput: false, awayMs: Infinity, lessonsSinceSleep: Infinity, knownVocab: Infinity },
  ];

  for (let round = 0; round < 25; round++) {
    for (const input of extremes) {
      const state = hypothalamus.update(input as never);
      for (const key of Object.keys(state) as Array<keyof Interoception>) {
        const value = state[key];
        assert.ok(Number.isFinite(value), `${key} رقم صحيح لا NaN`);
        assert.ok(value >= 0 && value <= 1, `${key} = ${value} داخل [0,1]`);
      }
    }
  }
});

/* ————— الجزيرة ————— */

test('الجزيرة تُشفّر حاله بترتيب ثابت معلن', () => {
  const insula = new Insula();
  const state: Interoception = {
    arousal: 0.9, fatigue: 0.1, curiosity: 0.7, attachment: 0.4, boredom: 0.2, confidence: 0.5,
  };
  const encoded = insula.encode(state);

  assert.equal(encoded.length, INSULA_ORDER.length, 'ستّة أبعاد');
  // الترتيب ليس تفصيلاً: أوزان العُقد القاعدية تتعلّم عليه، وتغييره يُفسد ما تعلّمه
  INSULA_ORDER.forEach((key, index) => {
    assert.ok(Math.abs((encoded[index] ?? 0) - state[key]) < 1e-6, `البُعد ${index} هو ${key}`);
  });
});

test('لا يتشكّى في كل نبضة: يقول حاله عند الصدق فقط', () => {
  const insula = new Insula();
  const calm: Interoception = {
    arousal: 1, fatigue: 0.1, curiosity: 0.3, attachment: 0.6, boredom: 0, confidence: 0.2,
  };
  assert.equal(insula.express(calm), null, 'حالٌ عادي لا يُقال');

  const tired = { ...calm, fatigue: 0.95 };
  const said = insula.express(tired);
  assert.ok(said !== null && said.includes('تعبت'), `يقول تعبه: ${said}`);
  assert.equal(insula.express(tired), null, 'ولا يعيدها في النبضة التالية');
});

/* ————— الحزام الحوفي ————— */

test('الحزام يفرّق اليقين من الجهل — وبه يقول «لا أعرف»', () => {
  const cingulate = new Cingulate();

  const certain = cingulate.conflict({
    intentProbs: Float32Array.from([0.97, 0.01, 0.01, 0.01]),
    recallScore: 0.95, factConfidence: 0.9, valence: 0.5,
  });
  const lost = cingulate.conflict({
    intentProbs: Float32Array.from([0.25, 0.25, 0.25, 0.25]),
    recallScore: 0, factConfidence: 0, valence: -0.8,
  });

  assert.ok(certain.level < lost.level, `اليقين أدنى تعارضاً (${certain.level.toFixed(2)} < ${lost.level.toFixed(2)})`);
  assert.ok(certain.level < 0.3, 'واليقين التام تعارضه ضئيل');
  assert.ok(lost.level > 0.7, 'والجهل التام تعارضه مرتفع');
  assert.ok(lost.reason.length > 0, 'ويسمّي أقوى مصدر لتعارضه');
  assert.ok(/[؀-ۿ]/.test(lost.reason), 'بالعربية كي يُعرض للأب');
});

test('الحزام لا ينهار على مدخلات فارغة أو شاذّة', () => {
  const cingulate = new Cingulate();
  const inputs = [
    { intentProbs: vec(0), recallScore: NaN, factConfidence: NaN, valence: NaN },
    { intentProbs: vec(9), recallScore: -5, factConfidence: 99, valence: -99 },
    { intentProbs: Float32Array.from([1]), recallScore: Infinity, factConfidence: 0.5, valence: 0 },
  ];
  for (const input of inputs) {
    const out = cingulate.conflict(input as never);
    assert.ok(Number.isFinite(out.level) && out.level >= 0 && out.level <= 1, `التعارض ${out.level} في مجاله`);
  }
});

test('الحوفي يحفظ حاله ويستعيده', () => {
  const hypothalamus = new Hypothalamus();
  for (let i = 0; i < 30; i++) hypothalamus.update({ ...zeroInput, unknownCount: 3, knownVocab: 40 });
  const expected = { ...hypothalamus.state };

  const fresh = new Hypothalamus();
  fresh.load(JSON.parse(JSON.stringify(hypothalamus.save())));
  for (const key of Object.keys(expected) as Array<keyof Interoception>) {
    assert.ok(Math.abs(fresh.state[key] - expected[key]) < 1e-6, `${key} استُعيد`);
  }

  for (const lobe of [new Amygdala(new Rng(1)), new Insula(), new Cingulate()]) {
    for (const bad of [null, 'نص', 5, [], {}]) {
      assert.doesNotThrow(() => lobe.load(bad as never), `${lobe.ar} يتحمّل حالة عطبة`);
    }
  }
});
