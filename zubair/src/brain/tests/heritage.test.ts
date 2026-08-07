/* ————— اختبار الميراث —————
 *
 * الميراث خطرٌ على أصل المشروع إن لم يُضبَط: لو اختلط بتعليم الأب لصار زبير
 * يُنسَب إليه ما لم يُعلّمه، ولضاع المقياس الوحيد الذي يُعرَف به أن تعليمه
 * ينفع. فأكثر ما يُختبر هنا هو **الفصل** لا المعرفة.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Zubair } from '../brain.js';
import { memoryStorage } from '../core/persist.js';
import { HERITAGE_FACTS, HERITAGE_SOURCE, HERITAGE_VERSION } from '../core/heritage.js';
import type { Intent } from '../core/types.js';

async function born(heritage: boolean, seed = 0x8e1a) {
  return Zubair.create({ storage: memoryStorage(), seed, fresh: true, heritage });
}

test('بلا ميراث يبقى وليداً لا يعرف شيئاً', async () => {
  const zubair = await born(false);
  assert.equal(zubair.metrics.vocab, 0);
  assert.equal(zubair.metrics.facts, 0);
  assert.equal(zubair.inheritedVersion, 0, 'ولا يُوسَم بميراث لم يرثه');
});

test('الميراث يعطيه عربية يفهمها', async () => {
  const zubair = await born(true);
  const m = zubair.metrics;

  assert.ok(m.vocab >= 300, `يعرف مئات الكلمات (${m.vocab})`);
  assert.ok(m.facts >= 150, `ومئات الحقائق (${m.facts})`);
  assert.equal(zubair.inheritedVersion, HERITAGE_VERSION);
  assert.ok(m.stage.id >= 2, `ويبدأ في مرحلة أعلى من الوليد (${m.stage.name})`);
});

test('الفصل صريح: ما وُرِث لا يُنسَب إلى الأب', async () => {
  const zubair = await born(true);
  const before = zubair.metrics;

  assert.ok(before.factsInherited > 0, 'الموروث محسوب');
  assert.equal(before.factsFromFather, 0, 'ولم يُعلّمه أبوه شيئاً بعد');
  assert.equal(before.lessons, 0, 'والميراث لا يُعَدّ درساً أعطاه الأب');

  // ثم يعلّمه أبوه حقيقة ليست في الميراث
  /* والدرس على شيء ليس في الميراث أصلاً: لو عُلّم موروثاً لانتقلت نسبتُه إلى
   * أبيه — وذاك صواب، لكنه يقيس شيئاً آخر. */
  await zubair.hear('الزنبق نبات');
  const after = zubair.metrics;
  assert.equal(after.factsFromFather, 1, 'درسُ الأب وحده يُنسَب إليه');
  assert.equal(after.factsInherited, before.factsInherited, 'والموروث لا يتغيّر');
  assert.equal(after.lessons, 1, 'وعدّاد دروسه ارتفع بواحد لا بمئتين');
});

test('كل حقيقة موروثة موسومة بمصدرها', async () => {
  const zubair = await born(true);
  await zubair.hear('الزنبق نبات');

  let inherited = 0;
  let fromFather = 0;
  for (const fact of zubair.facts) {
    if (fact.taughtBy === HERITAGE_SOURCE) inherited++;
    else fromFather++;
  }
  assert.ok(inherited > 100, `الموروث موسوم (${inherited})`);
  assert.equal(fromFather, 1, 'وما علّمه أبوه موسوم باسمه');
});

test('يجيب عن العربي بلا أن يُعلّمه أبوه شيئاً', async () => {
  const zubair = await born(true, 0x2f2f);
  const questions: Array<[string, string]> = [
    ['التفاحة', 'فاكهة'], ['الأسد', 'حيوان'], ['دمشق', 'مدينة'], ['القلم', 'أداة'],
    ['الشتاء', 'فصل'], ['الأحمر', 'لون'], ['المعلم', 'مهنة'], ['البحر', 'طبيعة'],
    ['العصفور', 'طائر'], ['النحلة', 'حشرة'], ['الخبز', 'طعام'], ['الكرسي', 'أثاث'],
  ];

  let right = 0;
  for (const [subject, object] of questions) {
    const out = await zubair.hear(`شو ${subject}؟`);
    if (out.text.includes(object)) right++;
  }
  const ratio = right / questions.length;
  assert.ok(ratio >= 0.75,
    `يجيب عن ثلاثة أرباع ما وُرِث (${right}/${questions.length} = ${Math.round(ratio * 100)}٪)`);
});

test('يفهم ماذا تريد منه من أول رسالة', async () => {
  const zubair = await born(true, 0x6c6c);
  const cases: Array<[string, Intent]> = [
    ['شو التفاحة؟', 'ASK'],
    ['أحسنت', 'PRAISE'],
    ['لا خطأ', 'CORRECT'],
    ['مرحبا', 'GREET'],
    ['القطة حيوان', 'TEACH_FACT'],
    ['هذه ملعقة', 'TEACH_WORD'],
    ['الجو حلو اليوم', 'CHITCHAT'],
  ];

  let right = 0;
  const wrong: string[] = [];
  for (const [text, expected] of cases) {
    const out = await zubair.hear(text);
    if (out.intent === expected) right++;
    else wrong.push(`«${text}» → ${out.intent} لا ${expected}`);
  }
  assert.ok(right >= cases.length - 1,
    `يفهم قصدك في كل الحالات تقريباً (${right}/${cases.length})${wrong.length ? ' — ' + wrong.join('، ') : ''}`);
});

test('علامة الاستفهام تصل المصنِّف لا الغريزة وحدها', async () => {
  /* العطل الذي كُشف بالقياس: التدريب يُحيّد الغريزة، فكانت العلامة لا تصل
   * المصنِّف أبداً، فصار «شو التفاحة؟» يُصنَّف تعليمَ حقيقة بعد أن يتضاءل وزن
   * الغريزة بالخبرة. */
  const zubair = await born(true, 0x9d9d);
  for (const question of ['شو التفاحة؟', 'شو الكلب؟', 'شو دمشق؟', 'شو الخبز؟']) {
    const out = await zubair.hear(question);
    assert.equal(out.intent, 'ASK', `«${question}» سؤالٌ لا تعليم`);
  }
});

test('لا ينسب إلى أبيه ما لم يُعلّمه', async () => {
  const zubair = await born(true, 0x4e4e);
  /* حقيقة موروثة: يجيب عنها ولا يقول «علّمتني» — وهذا صدقٌ لا تدقيق لغوي.
   * لو نسب الموروث إلى أبيه لأوهمه أنه علّمه ما لم يعلّمه. */
  for (let i = 0; i < 12; i++) {
    const out = await zubair.hear('شو التفاحة؟');
    assert.ok(!out.text.includes('علّمتني'),
      `لا يزعم أن أباه علّمه الموروث: «${out.text}»`);
  }

  // وما علّمه أبوه فعلاً يجوز أن ينسبه إليه
  await zubair.hear('الزنبق نبات');
  let claimed = false;
  for (let i = 0; i < 12; i++) {
    const out = await zubair.hear('شو الزنبق؟');
    if (out.text.includes('علّمتني')) claimed = true;
  }
  assert.ok(claimed, 'وينسب إليه ما علّمه إياه بنفسه');
});

test('لا لهجة موروثة: لهجته تبقى من أبيه', async () => {
  const zubair = await born(true, 0x3a3a);
  const before = zubair.dialectAr;

  for (const sentence of ['شو هذا', 'ليش هيك', 'كيفك', 'بدي أعرف كتير', 'هاد منيح']) {
    await zubair.hear(sentence);
  }
  assert.equal(zubair.dialectAr, 'شامية', `صار شامياً بكلام أبيه (كان: ${before})`);
});

test('الميراث لا يُعاد في كل فتح للتطبيق', async () => {
  const storage = memoryStorage();
  const first = await Zubair.create({ storage, seed: 0x7070, fresh: true, heritage: true });
  const facts = first.metrics.facts;
  const vocab = first.metrics.vocab;
  await first.save();

  const second = await Zubair.create({ storage, seed: 0x7070, heritage: true });
  assert.equal(second.metrics.facts, facts, 'الحقائق كما هي لا ضِعفها');
  assert.equal(second.metrics.vocab, vocab, 'والمفردات كذلك');
  assert.equal(second.inheritedVersion, HERITAGE_VERSION);
});

test('تصحيح الأب يعلو الميراث', async () => {
  const zubair = await born(true, 0x5b5b);
  // «الطماطم» ليست في الميراث، لكن «البندورة خضار» فيه — نصحّح موروثاً صريحاً
  for (let round = 0; round < 8; round++) await zubair.hear('البندورة فاكهة');
  const fact = zubair.facts.find((f) => f.subject === 'بندوره');
  assert.ok(fact !== undefined, 'الحقيقة موجودة');
  assert.equal(fact?.object, 'فاكهه', 'وإصرار الأب قلب الموروث');
  assert.notEqual(fact?.taughtBy, HERITAGE_SOURCE, 'وصارت منسوبة إليه لا إلى الميراث');
});

test('الميراث سريع ولا يُثقل جواله', async () => {
  const started = Date.now();
  const zubair = await born(true, 0x1d1d);
  const ms = Date.now() - started;
  assert.ok(ms < 3000, `يورَّث في أقل من ثلاث ثوانٍ (${ms}مث)`);

  const size = zubair.serialize().length / (1024 * 1024);
  assert.ok(size < 3, `وحجم دماغه معقول على جوال (${size.toFixed(2)} ميغابايت)`);
  assert.equal(HERITAGE_FACTS.length > 150, true, 'والميراث نفسه معتبر');
});
