/* ————— اختبار النحو: أساس العربية —————
 *
 * هذا الفص مفتاح خمسة عيوب كانت في زبير، فأكثر ما يُختبر هنا هو **زوالها**:
 * أن تتعايش الصفة مع الجنس، وأن يُفهَم النفي معرفةً، وأن يعود الضمير على شيء،
 * وأن يعرف ما يطلبه السؤال فلا يُجيب عن غيره، وأن يعرف نفسه.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Zubair } from '../brain.js';
import { memoryStorage } from '../core/persist.js';
import { Lexicon } from '../core/text.js';
import { Rng } from '../core/tensor.js';
import { Syntax } from '../lobes/syntax.js';
import { Parietal } from '../lobes/parietal.js';

const syntax = new Syntax();
const lexicon = new Lexicon(new Rng(0x5a17));
const parse = (text: string) => syntax.parse(lexicon.perceive(text, true));

/* ————— الصرف: الكلمة ————— */

test('يميّز الاسم من الفعل من الحرف', () => {
  assert.equal(syntax.classify('القطه').pos, 'اسم', 'أداة التعريف أقطع علامة على الاسمية');
  assert.equal(syntax.classify('مدرسه').pos, 'اسم', 'وتاء التأنيث كذلك');
  assert.equal(syntax.classify('معلمون').pos, 'اسم', 'وجمع المذكر السالم');
  assert.equal(syntax.classify('يكتب').pos, 'فعل', 'وحرف المضارعة علامة الفعل');
  assert.equal(syntax.classify('كتبت').pos, 'فعل', 'وتاء الفاعل');
  assert.equal(syntax.classify('في').pos, 'حرف');
  assert.equal(syntax.classify('هل').pos, 'حرف');
  assert.equal(syntax.classify('هو').pos, 'اسم', 'والضمير اسم مبنيّ');
});

test('يميّز المذكر من المؤنث والمفرد من الجمع', () => {
  assert.equal(syntax.classify('القطه').gender, 'مؤنث');
  assert.equal(syntax.classify('الكلب').gender, 'مذكر');
  assert.equal(syntax.classify('بنت').gender, 'مؤنث', 'ومؤنثٌ بلا تاء يُحصى إحصاءً');
  assert.equal(syntax.classify('شمس').gender, 'مؤنث');

  assert.equal(syntax.classify('معلمات').number, 'جمع');
  assert.equal(syntax.classify('معلمون').number, 'جمع');
  assert.equal(syntax.classify('الكتاب').number, 'مفرد');
  assert.equal(syntax.classify('هم').number, 'جمع');
});

test('يعرف المعرفة من النكرة', () => {
  assert.equal(syntax.classify('الكتاب').definite, true);
  assert.equal(syntax.classify('كتاب').definite, false);
  assert.equal(syntax.classify('الكتاب').stem, 'كتاب', 'والجذع بلا أداة');
  assert.equal(syntax.classify('الان').definite, false, '«الآن» ليست «آن»: الجذع القصير لا يُنزع');
});

/* ————— النحو: الجملة ————— */

test('يميّز نوع الجملة', () => {
  assert.equal(parse('القطه حيوان').kind, 'اسمية');
  assert.equal(parse('يكتب الولد').kind, 'فعلية');
  assert.equal(parse('شو هذا؟').kind, 'استفهام');
  assert.equal(parse('القطه ليست نبات').kind, 'نفي');
  assert.equal(parse('يا زبير').kind, 'نداء');
  assert.equal(parse('مرحبا').kind, 'مفردة');
});

test('يعرف ماذا يطلب كل سؤال — وهذا لبّ تمييز السؤال من الجواب', () => {
  assert.equal(parse('شو هذا؟').asks, 'جنس');
  assert.equal(parse('ما التفاحه؟').asks, 'جنس');
  assert.equal(parse('مين المعلم؟').asks, 'شخص');
  assert.equal(parse('وين دمشق؟').asks, 'مكان');
  assert.equal(parse('متي الصباح؟').asks, 'زمان');
  assert.equal(parse('كم قطه عندي؟').asks, 'عدد');
  assert.equal(parse('كيف الجو؟').asks, 'كيفية');
  assert.equal(parse('ليش هيك؟').asks, 'سبب');
  assert.equal(parse('هل القطه حيوان؟').asks, 'تصديق');
  assert.equal(parse('القطه حيوان').asks, null, 'والخبر ليس سؤالاً');
});

test('الأدوات الملتبسة لا تُقبل إلا أول الجملة', () => {
  assert.equal(parse('خرجت من البيت').asks, null, '«من» حرف جرّ هنا لا أداة سؤال');
  assert.equal(parse('مين معك؟').asks, 'شخص', 'و«مين» قاطعة في أي موضع');
});

test('يفرّق النفي من التصحيح — وبه يصير النفي معرفةً', () => {
  const negation = parse('القطه ليست نبات');
  assert.equal(negation.negated, true);
  assert.equal(negation.topic, 'قطه');
  assert.equal(negation.comment, 'نبات', 'وللنفي طرفان: هذا ما يجعله معرفة لا تصحيحاً');

  const correction = parse('لا');
  assert.equal(correction.topic, null, 'وتصحيح الأب نفيٌ بلا طرفين');
});

test('يفرّق الصفة من الجنس من الفعل — وبه تتعايش معرفته', () => {
  assert.equal(parse('القطه حيوان').relation, 'جنس');
  assert.equal(parse('القطه صغيره').relation, 'صفة');
  assert.equal(parse('القطه تاكل').relation, 'فعل');
});

test('يجد الضمير وجنسه', () => {
  const feminine = parse('هي صغيره');
  assert.equal(feminine.pronoun?.word, 'هي');
  assert.equal(feminine.pronoun?.gender, 'مؤنث');

  const masculine = parse('هو كبير');
  assert.equal(masculine.pronoun?.gender, 'مذكر');
  assert.equal(parse('القطه حيوان').pronoun, null);
});

test('يقرأ العدد رقماً وكلمة', () => {
  assert.equal(parse('عندي 3 قطط').count, 3);
  assert.equal(parse('عندي ثلاثه قطط').count, 3);
  assert.equal(parse('القطه حيوان').count, null);
});

/* ————— مطابقة الجواب للسؤال ————— */

test('لا يقبل جواباً لا يصلح للسؤال', () => {
  // «وين دمشق؟» يطلب مكاناً، و«مدينة» جنسها «مكان» فتصلح
  assert.equal(syntax.answerFits('مكان', 'مدينه', 'مكان'), true);
  // لكن «حيوان» لا تصلح جواباً عن مكان
  assert.equal(syntax.answerFits('مكان', 'حيوان', 'جنس'), false);
  assert.equal(syntax.answerFits('شخص', 'معلم', 'مهنه'), true);
  assert.equal(syntax.answerFits('عدد', 'ثلاثه', null), true);
  assert.equal(syntax.answerFits('عدد', 'حيوان', 'جنس'), false);
  // ما لا بنية له في دماغه يُردّ كي يُقرّ بجهله
  assert.equal(syntax.answerFits('سبب', 'حيوان', 'جنس'), false);
  assert.equal(syntax.answerFits('كيفية', 'حيوان', 'جنس'), false);
  // وجنسٌ مجهول لا يُمنع: المنع بلا علم ظلم
  assert.equal(syntax.answerFits('مكان', 'شيء', null), true);
  assert.equal(syntax.answerFits(null, 'أي شيء', null), true);
});

test('وصف السؤال بالعربية يظهر للأب', () => {
  assert.ok(syntax.describeAsk('مكان').includes('مكان'));
  assert.ok(/[؀-ۿ]/.test(syntax.describeAsk('عدد')));
  assert.equal(syntax.describeAsk(null), 'ليست سؤالاً');
});

test('لا ينهار على مدخلات فارغة أو شاذّة', () => {
  for (const text of ['', '   ', '؟', '!!!', '123', 'ـــ']) {
    const result = parse(text);
    assert.ok(Array.isArray(result.words));
    assert.ok(typeof result.negated === 'boolean');
  }
});

/* ————— أثر النحو في الدماغ كاملاً ————— */

async function child(seed = 0x77aa) {
  return Zubair.create({ storage: memoryStorage(), seed, fresh: true });
}

test('الصفة والجنس يتعايشان: معرفته تتراكم لا تتقاتل', async () => {
  const parietal = new Parietal();
  parietal.learnFact('قطه', 'حيوان', 1, 'أبوه', 'جنس');
  parietal.learnFact('قطه', 'صغيره', 2, 'أبوه', 'صفة');
  parietal.learnFact('قطه', 'تاكل', 3, 'أبوه', 'فعل');

  assert.equal(parietal.lookup('قطه', 'جنس')?.object, 'حيوان', 'جنسها باقٍ');
  assert.equal(parietal.lookup('قطه', 'صفة')?.object, 'صغيره', 'وصفتها معه');
  assert.equal(parietal.lookup('قطه', 'فعل')?.object, 'تاكل', 'وفعلها كذلك');
  assert.equal(parietal.lookupAll('قطه').length, 3, 'ثلاث معارف عن شيء واحد');

  // وقبل هذا الإصلاح كانت الثانية تهدم الأولى
  assert.equal(parietal.lookup('قطه')?.object, 'حيوان', 'والافتراضي هو الجنس');
});

test('التعليم بالصفة لا يمحو الجنس في الدماغ كاملاً', async () => {
  const zubair = await child();
  await zubair.hear('القطة حيوان');
  await zubair.hear('القطة صغيرة');

  const kinds = zubair.facts.filter((f) => f.subject === 'قطه');
  assert.ok(kinds.length >= 2, `يعرف عن القطة أكثر من شيء (${kinds.length})`);
  const objects = kinds.map((f) => f.object);
  assert.ok(objects.includes('حيوان'), 'جنسها باقٍ بعد أن علّمه صفتها');
});

test('يفهم النفي معرفةً لا تصحيحاً', async () => {
  const zubair = await child(0x31bb);
  await zubair.hear('القطة حيوان');
  const before = zubair.facts.find((f) => f.subject === 'قطه')?.confidence ?? 0;

  const out = await zubair.hear('القطة ليست حيوان');
  const after = zubair.facts.find((f) => f.subject === 'قطه')?.confidence ?? 0;

  assert.ok(after < before, `النفي يهدم ثقته لا يُقرأ تصحيحاً (${before.toFixed(2)} ← ${after.toFixed(2)})`);
  assert.ok(out.trace.some((step) => step.note.includes('نفى')), 'وأثر النبضة يذكره');
});

test('لا يجيب عن سؤال بغير ما يطلبه', async () => {
  const zubair = await child(0x9ac3);
  await zubair.hear('دمشق مدينة');
  await zubair.hear('المدينة مكان');

  // «شو دمشق؟» يطلب جنساً: يُجاب
  const genus = await zubair.hear('شو دمشق؟');
  assert.ok(genus.text.includes('مدينة') || genus.text.includes('مدينه'),
    `يجيب عن الجنس: «${genus.text}»`);

  // «ليش دمشق؟» يطلب سبباً ولا سببية في دماغه: يُقرّ بجهله ولا يُجيب بجنسها
  const cause = await zubair.hear('ليش دمشق؟');
  assert.ok(!cause.text.includes('مدينة'),
    `لا يُجيب عن السبب بالجنس: «${cause.text}»`);
});

test('الضمير يعود على آخر موضوع — فيصحّ التعليم على أكثر من دور', async () => {
  const zubair = await child(0x4d4d);
  await zubair.hear('القطة حيوان');
  const out = await zubair.hear('هي صغيرة');

  assert.ok(out.trace.some((step) => step.note.includes('تعود على')),
    'أثر النبضة يذكر على مَن عاد الضمير');
  const facts = zubair.facts.filter((f) => f.subject === 'قطه');
  assert.ok(facts.length >= 1, 'والكلام صار عن القطة لا عن ضمير معلّق');
});
