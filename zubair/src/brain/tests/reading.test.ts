/* ————— اختبار القراءة: مصدرٌ ثالث لا مصدرٌ مساوٍ —————
 *
 * وأخطر ما في هذه الميزة ليس تقنياً. كلُّ ما بُني في المراجعة يقوم على أن
 * مصدر المعرفة **محكوم**: الرتبة تسأل «هل نُوزعت؟»، والسجلّ يجمع حكم الحَكَم
 * بحكم الأب. والكتاب لا يُصحَّح — صفحةٌ واحدة تُدخل مئة حقيقةٍ بلا معلّم.
 *
 * فهذه الاختبارات تحرس القيود الخمسة التي تجعل القراءة نافعةً لا مُفسِدة.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Zubair } from '../brain.js';
import { memoryStorage } from '../core/persist.js';
import { splitSentences, READ_SOURCE } from '../core/reading.js';
import { rankOf } from '../core/review.js';
import type { Fact } from '../core/types.js';

const CLOCK = 1_700_000_000_000;
const fresh = (seed = 0x5eed) =>
  Zubair.create({ storage: memoryStorage(), seed, fresh: true, heritage: true });

/** صفحةٌ فيها ما يُفهَم وما لا يُفهَم — كما تجيء الصفحات فعلاً. */
const PAGE = `
النمر حيوان مفترس. يعيش النمر في الغابات.
الزرافة حيوان طويل الرقبة، وتأكل أوراق الشجر.
الحوت أكبر كائن في البحر. وهو يتنفّس الهواء.
كان يا ما كان، في قديم الزمان، أرنبٌ صغير يسكن قرب النهر.
الحديد معدن صلب. النحاس معدن كذلك.
`;

/* ————— فصل الجمل ————— */

test('يفصل الجمل بعلامات الوقف العربية وبالسطر الجديد', () => {
  const parts = splitSentences('القطة حيوان. الكلب حيوان؟ الفيل ضخم!\nالنمر مفترس');
  assert.equal(parts.length, 4);
  assert.equal(parts[0], 'القطة حيوان');
});

test('ويُهمل ما هو أطول من أن يكون جملة', () => {
  const long = Array.from({ length: 30 }, (_, i) => `كلمة${i}`).join(' ');
  assert.deepEqual(splitSentences(long), []);
});

/* ————— القيد الأول: لا يتعلّم إلا ما يفهمه نحوُه ————— */

test('لا يستخرج من السرد إلا الجملة التعريفية', async () => {
  const zubair = await fresh();
  const report = zubair.study(PAGE);
  const pairs = report.understood.map((f) => `${f.subject}←${f.object}`);

  /* ما يجب أن يخرج */
  assert.ok(pairs.includes('نمر←حيوان'), `لم يستخرج «النمر حيوان»: ${pairs.join('، ')}`);
  assert.ok(pairs.includes('حديد←معدن'));

  /* وما لا يجوز أن يخرج — وكلُّه خرج قبل تشديد الشرط، فسقطت الميزة بأربعةٍ
   * من ستّة «مفهومة» ركاماً */
  for (const junk of ['يعيش←نمر', 'وهو←يتنفس', 'قديم←زمان', 'حوت←اكبر']) {
    assert.ok(!pairs.includes(junk), `ركامٌ خرج معرفةً: ${junk}`);
  }
});

test('والرقمُ يُقال بصدق ولو كان قليلاً', async () => {
  const zubair = await fresh();
  const report = zubair.study(PAGE);
  /* أُهملَ أكثرُ ممّا فُهم، وهذه هي الحقيقة: نحوُه يفكّ التعريف لا السرد.
   * ورقمٌ يُجمّل هنا يجعل الأب يظنّ أن صفحةً تعطي مئة حقيقة. */
  assert.ok(report.skipped > report.understood.length,
    `فهم ${report.understood.length} وأهمل ${report.skipped} — الرقم يبدو مُجمَّلاً`);
  assert.equal(report.sentences, report.understood.length + report.skipped);
});

test('ولا يحفظ حرفاً قبل الإذن', async () => {
  const zubair = await fresh();
  const before = zubair.metrics.facts;
  zubair.study(PAGE);
  assert.equal(zubair.metrics.facts, before, 'حفظ من القراءة بلا إذن');
});

/* ————— القيد الثاني: ما يخالف الأب يُعرَض محذَّراً ————— */

test('ما يخالف ما علّمه أبوه يجيء مطفأً لا مدموجاً', async () => {
  const zubair = await fresh();
  await zubair.hear('النمر أليف', CLOCK);
  const report = zubair.study('النمر مفترس. الحديد معدن.');

  const clash = report.understood.find((f) => f.subject === 'نمر');
  assert.ok(clash, 'لم يلتقط المخالفة أصلاً');
  assert.equal(clash.state, 'مخالف');
  assert.equal(clash.accepted, false, 'المخالف قُبل تلقائياً — والكتاب لا يُرجَّح على الأب');
  assert.equal(clash.knownFrom, 'أبوه');

  const fresh_ = report.understood.find((f) => f.subject === 'حديد');
  assert.equal(fresh_?.state, 'جديد');
  assert.equal(fresh_?.accepted, true);
});

test('وما لم يُجَز لا يُحفَظ ولو مرّ في القراءة', async () => {
  const zubair = await fresh();
  await zubair.hear('النمر أليف', CLOCK);
  const report = zubair.study('النمر مفترس.');
  await zubair.absorb(report.understood);
  const out = await zubair.hear('كيف النمر؟', CLOCK + 90_000);
  assert.match(out.text, /أليف/, `الكتابُ غلب الأب: «${out.text}»`);
});

/* ————— القيد الثالث: سقفُ الرتبة ————— */

test('المقروء لا يبلغ اليقين مهما لم يُنازَع', () => {
  const fact: Fact = { subject: 'حديد', object: 'معدن', confidence: 1, taughtBy: READ_SOURCE, lastSeenTick: 1 };
  const base = { fact, generalized: false, dispute: 'لا نزاع' as const, seen: false };
  assert.equal(rankOf({ ...base, read: false }), 'يقين');
  assert.equal(rankOf({ ...base, read: true }), 'راجح', 'المقروء بلغ اليقين — والكتاب لا يسمع الجواب فيصحّحه');
});

test('ويقولها «بظنّي» حتى يؤكّدها أبوه بلسانه', async () => {
  const zubair = await fresh();
  const report = zubair.study('الحديد معدن.');
  await zubair.absorb(report.understood);

  const read = await zubair.hear('شو الحديد؟', CLOCK);
  assert.match(read.text, /معدن/);
  assert.equal(read.rank, 'راجح');
  assert.match(read.text, /بظنّي|أظنّ/, `جزم بما قرأه: «${read.text}»`);

  /* فإذا قالها أبوه صارت كلامَ أبيه وبلغت اليقين */
  await zubair.hear('الحديد معدن', CLOCK + 90_000);
  const told = await zubair.hear('شو الحديد؟', CLOCK + 135_000);
  assert.equal(told.rank, 'يقين');
  assert.ok(!/بظنّي|أظنّ/.test(told.text), `بقي متحفّظاً بعد تأكيدك: «${told.text}»`);
});

/* ————— القيد الرابع: الأرقام تفصل المصادر الثلاثة ————— */

test('ما قرأه لا يُحسب فيما علّمتَه', async () => {
  const zubair = await fresh();
  await zubair.hear('الزقفوط نبات', CLOCK);
  const taughtBefore = zubair.metrics.factsFromFather;

  const report = zubair.study(PAGE);
  const saved = await zubair.absorb(report.understood);
  const m = zubair.metrics;

  assert.ok(saved.learned > 0, 'لم يحفظ شيئاً من الصفحة');
  assert.equal(m.factsRead, saved.learned);
  assert.equal(m.factsFromFather, taughtBefore, 'حُسب المقروء على أنه من تعليمك');
  assert.equal(m.facts, m.factsInherited + m.factsFromFather + m.factsRead);
});

test('وكلمةُ الأب تعلو المقروء من أول مرّة', async () => {
  const zubair = await fresh();
  const report = zubair.study('الحديد معدن.');
  await zubair.absorb(report.understood);
  /* والمخالفة تكون في الخزانة نفسها. وقد جُرّب «الحديد سائل» أوّلاً فبدا
   * معانَدةً وليس كذلك — صفةٌ لا تنازع جنساً، والخزانتان مختلفتان. ثم جُرّب
   * «الحديد خشب» فوقع في الصفات أيضاً، لأن «خشب» ليست جنساً لشيءٍ عنده بعد
   * فيقرؤها الجُداري صفة. وهذا حدُّ `refineRelation` المعروف لا عطبُ قراءة. */
  await zubair.hear('الحديد نبات', CLOCK);
  const out = await zubair.hear('شو الحديد؟', CLOCK + 90_000);
  /* لا ينازعه ثماني مرات قبل أن يصدّقه: قولُ الأب فصلٌ في الأولى */
  assert.match(out.text, /نبات/, `عاند ما قرأه في وجه أبيه: «${out.text}»`);
  assert.ok(!/بظنّي|أظنّ/.test(out.text), `بقي متحفّظاً وقد قالها أبوه: «${out.text}»`);
});

/* ————— القيد الخامس: القراءة لا تُنمّي مفرداته بما لم يفهمه ————— */

test('لا تقفز مفرداته بما مرّ عليه بصرُه', async () => {
  const zubair = await fresh();
  const before = zubair.metrics.vocab;
  zubair.study(PAGE);
  assert.equal(zubair.metrics.vocab, before, 'نمت مفرداته بالقراءة وحدها');

  const report = zubair.study(PAGE);
  const saved = await zubair.absorb(report.understood);
  /* وتنمو بما فُهم وأُجيز وحده — بعددٍ لا يتجاوز طرفَي كل حقيقة */
  assert.ok(saved.words > 0 && saved.words <= saved.learned * 2, `زادت ${saved.words} كلمة بـ${saved.learned} حقيقة`);
});
