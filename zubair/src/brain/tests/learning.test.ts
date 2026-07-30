/* ————— هل يتعلّم زبير فعلاً؟ —————
 *
 * كل ما سبق من فصوص لا قيمة له إن لم يرتفع رقم. هذا الملف يحاكي أباً يعلّم
 * ابنه ويصحّح له، ثم يقيس: أصاب أكثر؟ نمت مفرداته؟ ثبّت النوم ما تعلّمه؟ ولم
 * ينسَ بعد إغلاق التطبيق؟
 *
 * الأب المحاكى هنا صارم: يمدح فقط إذا كان الجواب يحتوي الصواب فعلاً، ويصحّح
 * بالجواب الصحيح كاملاً وإلا لم يكن اختباراً بل تصفيقاً.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Zubair } from '../brain.js';
import { memoryStorage } from '../core/persist.js';
import { STAGES } from '../core/types.js';

/** دروس أب حقيقي: أسماء وحقائق بلهجة مختلطة كما يتكلّم الناس. */
const LESSONS: Array<[string, string]> = [
  ['القطة حيوان', 'قطة'],
  ['الكلب حيوان', 'كلب'],
  ['التفاحة فاكهة', 'تفاحة'],
  ['الموز فاكهة', 'موز'],
  ['الخيار خضار', 'خيار'],
  ['دمشق مدينة', 'دمشق'],
  ['حلب مدينة', 'حلب'],
  ['الشام بلد', 'شام'],
  ['الجوال جهاز', 'جوال'],
  ['الحاسوب جهاز', 'حاسوب'],
];

/** الجواب الصحيح لكل موضوع، كما يعرفه الأب. */
const TRUTH = new Map<string, string>([
  ['قطة', 'حيوان'], ['كلب', 'حيوان'], ['تفاحة', 'فاكهة'], ['موز', 'فاكهة'],
  ['خيار', 'خضار'], ['دمشق', 'مدينة'], ['حلب', 'مدينة'], ['شام', 'بلد'],
  ['جوال', 'جهاز'], ['حاسوب', 'جهاز'],
]);

async function newborn(seed = 0xabc123) {
  return Zubair.create({ storage: memoryStorage(), seed, fresh: true });
}

test('الميلاد: لا يعرف شيئاً ولا يزعم أنه يعرف', async () => {
  const zubair = await newborn();
  const metrics = zubair.metrics;

  assert.equal(metrics.vocab, 0, 'الوليد لا يعرف كلمة');
  assert.equal(metrics.facts, 0, 'الوليد لا يعرف حقيقة');
  assert.equal(metrics.stage.id, 0, 'يبدأ في مرحلة الوليد');
  assert.equal(metrics.lessons, 0);

  const first = await zubair.hear('مرحبا يا زبير');
  assert.ok(first.text.trim().length > 0, 'لا يخرج نصاً فارغاً أبداً');
  // الوليد لا ينطق جملة تامة: هذا ليس عيباً بل هو الصدق
  const words = first.text.split(/\s+/).filter(Boolean);
  assert.ok(words.length <= STAGES[0]!.maxWords + 1,
    `الوليد لا يتكلّم بجملة (قال ${words.length} كلمة: «${first.text}»)`);
});

test('المفردات تنمو بما يسمع، ولا تنمو بالتكرار', async () => {
  const zubair = await newborn();
  await zubair.hear('القطة حيوان');
  const afterFirst = zubair.metrics.vocab;
  assert.ok(afterFirst >= 2, `تعلّم كلمتين على الأقل (تعلّم ${afterFirst})`);

  await zubair.hear('القطة حيوان');
  assert.equal(zubair.metrics.vocab, afterFirst, 'تكرار الجملة لا ينمّي مفرداته');

  await zubair.hear('الكلب حيوان لطيف');
  assert.ok(zubair.metrics.vocab > afterFirst, 'كلمات جديدة تنمّي مفرداته');
});

test('المراحل تتقدّم بما تعلّمه لا بعمره', async () => {
  const zubair = await newborn();
  // جملة واحدة طويلة تحمل كلمات كثيرة: النمو بالتعليم لا بالزمن
  for (let i = 0; i < 8; i++) {
    await zubair.hear(`الدرس رقم ${i} فيه كلمات جديدة مثل كلمة${i} وكلمة أخرى${i} وثالثة${i}`);
  }
  const metrics = zubair.metrics;
  assert.ok(metrics.vocab >= 12, `تجاوز حدّ المرحلة الأولى (${metrics.vocab} كلمة)`);
  assert.ok(metrics.stage.id >= 1, `دخل مرحلة أعلى (${metrics.stage.name})`);
});

test('يتعلّم الحقيقة من درس واحد ويحفظها', async () => {
  const zubair = await newborn();
  await zubair.hear('القطة حيوان');
  assert.ok(zubair.metrics.facts >= 1, 'حفظ الحقيقة من أول درس — الحفظ الفوري');
});

test('يسأل عمّا يجهل: سؤال طفل لا ضجيج', async () => {
  const zubair = await newborn();
  let asked = 0;
  const aboutWords: string[] = [];
  for (let i = 0; i < 12; i++) {
    const out = await zubair.hear(`عندي شيء اسمه غريب${i} ما رأيك فيه`);
    if (out.kind === 'question') {
      asked++;
      aboutWords.push(out.text);
    }
  }
  assert.ok(asked > 0, `سأل على الأقل مرة في اثنتي عشرة نبضة (سأل ${asked})`);
  assert.equal(zubair.metrics.questionsAsked, asked, 'العدّاد يطابق ما جرى فعلاً');
});

test('حكم الأب يُغيّر دماغه: الدوبامين خطأ تنبّؤ لا مكافأة', async () => {
  const zubair = await newborn();
  await zubair.hear('القطة حيوان');
  const first = await zubair.judge({ verdict: 'praise' });
  assert.ok(Number.isFinite(first.dopamine), 'الدوبامين رقم صحيح');
  assert.ok(first.learned.length > 0, 'يخبر أباه بما تعلّمه');

  /* المدح المتوقَّع لا يُعلّم: المفاجأة تتضاءل بالتكرار. تُقاس على استراتيجية
   * واحدة تكرّرت لا على آخر حكم مطلقاً — لأن أول مدح على استراتيجية لم تُجرَّب
   * قط مفاجأةٌ كاملة بحقّ، ولو قِسنا آخر حكم مهما كانت استراتيجيته لقِسنا
   * ضجيج الاستكشاف لا تعلّم القيمة. */
  const perStrategy = new Map<string, number[]>();
  perStrategy.set(String(await currentStrategy(zubair)), [Math.abs(first.dopamine)]);
  for (let i = 0; i < 14; i++) {
    const out = await zubair.hear('القطة حيوان');
    const judged = await zubair.judge({ verdict: 'praise' });
    const list = perStrategy.get(out.strategy) ?? [];
    list.push(Math.abs(judged.dopamine));
    perStrategy.set(out.strategy, list);
  }

  let tested = 0;
  for (const [strategy, values] of perStrategy) {
    if (values.length < 3) continue;
    tested++;
    const head = values[0]!;
    const tail = values[values.length - 1]!;
    assert.ok(tail <= head + 1e-6,
      `المفاجأة تتضاءل في «${strategy}»: ${head.toFixed(3)} ← ${tail.toFixed(3)}`);
  }
  assert.ok(tested > 0, 'تكرّرت استراتيجية واحدة على الأقل ليُقاس تضاؤل مفاجأتها');
});

/** آخر استراتيجية اختارها — للاختبار وحده. */
async function currentStrategy(zubair: Zubair): Promise<string> {
  const out = await zubair.hear('القطة حيوان');
  await zubair.judge({ verdict: 'praise' });
  return out.strategy;
}

test('التصحيح درس كامل: يهدم الخطأ ويبني الصواب', async () => {
  const zubair = await newborn();
  await zubair.hear('القطة حيوان');
  await zubair.judge({ verdict: 'praise' });

  await zubair.hear('البندورة حيوان');
  const judged = await zubair.judge({ verdict: 'correct', correction: 'البندورة خضار' });

  const learnedText = judged.learned.join(' | ');
  assert.ok(judged.learned.length > 0, `يذكر ما تعلّمه من التصحيح: ${learnedText}`);
  assert.ok(zubair.metrics.facts >= 2, 'حقيقة التصحيح صارت من معرفته');
});

test('النوم يثبّت: يُعيد دروسه على نفسه فيتحوّل الحفظ إلى فهم', async () => {
  const zubair = await newborn();
  for (const [sentence] of LESSONS) await zubair.hear(sentence);

  const before = zubair.metrics;
  const slept = await zubair.sleep(3);

  assert.ok(slept.replayed > 0, `أعاد ذكرياته فعلاً (${slept.replayed} إعادة)`);
  assert.equal(zubair.metrics.sleeps, before.sleeps + 1, 'عدّاد النوم ارتفع');
  assert.ok(zubair.metrics.facts >= before.facts, 'النوم لا يُفقده معرفة');
});

test('التعلّم من الأب يرفع إصابته: قبل ← بعد', async () => {
  const zubair = await newborn(0x5eed99);

  /* الأب المحاكى: يعلّم الحقيقة، ثم يسأل عنها، ثم يمدح إن كان الجواب صحيحاً
   * ويصحّح بالجواب الكامل إن كان خاطئاً. هذا هو نمط التعليم الذي بُني له. */
  const askRound = async (): Promise<number> => {
    let correct = 0;
    for (const [subject, object] of TRUTH) {
      const out = await zubair.hear(`شو ${subject}؟`);
      const right = out.text.includes(object);
      if (right) {
        correct++;
        await zubair.judge({ verdict: 'praise' });
      } else {
        await zubair.judge({ verdict: 'correct', correction: `${subject} ${object}` });
      }
    }
    return correct / TRUTH.size;
  };

  // الجولة الأولى: لم يُعلَّم شيئاً بعد
  const beforeTeaching = await askRound();

  // التعليم: كل حقيقة مرتين، كما يعلّم أب حقيقي
  for (let pass = 0; pass < 2; pass++) {
    for (const [sentence] of LESSONS) {
      await zubair.hear(sentence);
      await zubair.judge({ verdict: 'praise' });
    }
  }
  await zubair.sleep(4);

  // ثلاث جولات سؤال وتصحيح — هذا هو التعليم الفعلي
  await askRound();
  await askRound();
  const afterTeaching = await askRound();

  assert.ok(afterTeaching > beforeTeaching,
    `إصابته ارتفعت بالتعليم: ${(beforeTeaching * 100).toFixed(0)}٪ ← ${(afterTeaching * 100).toFixed(0)}٪`);
  assert.ok(afterTeaching >= 0.5,
    `يجيب أكثر من نصف ما عُلّمه: ${(afterTeaching * 100).toFixed(0)}٪`);

  const metrics = zubair.metrics;
  assert.ok(metrics.recentAccuracy > 0, 'سجل النمو يعرف نسبة إصابته');
});

test('لا ينسى بعد إغلاق التطبيق', async () => {
  const storage = memoryStorage();
  const first = await Zubair.create({ storage, seed: 0x1111, fresh: true });
  for (const [sentence] of LESSONS) await first.hear(sentence);
  await first.save();
  const remembered = first.metrics;

  // جلسة جديدة تماماً على نفس التخزين: كأن الأب أغلق التطبيق وعاد غداً
  const second = await Zubair.create({ storage, seed: 0x1111 });
  const after = second.metrics;

  assert.equal(after.vocab, remembered.vocab, 'مفرداته كما هي');
  assert.equal(after.facts, remembered.facts, 'حقائقه كما هي');
  assert.equal(after.ticks, remembered.ticks, 'عمره كما هو');
});

test('النسخة الاحتياطية تنقل دماغه كاملاً', async () => {
  const source = await newborn(0x2222);
  for (const [sentence] of LESSONS) await source.hear(sentence);
  const backup = source.serialize();

  const adopted = await Zubair.create({ storage: memoryStorage(), seed: 0x3333, fresh: true });
  await adopted.adopt(backup);

  assert.equal(adopted.metrics.vocab, source.metrics.vocab, 'المفردات انتقلت');
  assert.equal(adopted.metrics.facts, source.metrics.facts, 'الحقائق انتقلت');
  assert.equal(adopted.metrics.ticks, source.metrics.ticks, 'العمر انتقل');
});

test('لا ينهار على كلام غريب ولا يُخرج NaN', async () => {
  const zubair = await newborn(0x4444);
  const weird = [
    '', '   ', '؟', '!!!؟؟؟', '123456', 'aaa bbb ccc',
    'ـــــــ', '٠١٢٣٤٥', 'ك', 'كلمة'.repeat(80),
    'شو شو شو شو شو', 'لا', 'أحسنت', 'مرحبا', 'ما اسمك؟',
  ];
  for (const input of weird) {
    const out = await zubair.hear(input);
    assert.ok(typeof out.text === 'string', `يجيب على «${input}»`);
    assert.ok(out.text.trim().length > 0, `لا يسكت على «${input}»`);
    assert.ok(Number.isFinite(out.confidence), `ثقته رقم على «${input}»`);
    assert.ok(out.confidence >= 0 && out.confidence <= 1, 'الثقة في مجالها');
    assert.ok(out.trace.length > 0, 'أثر النبضة موجود دائماً');
    for (const step of out.trace) {
      assert.ok(Number.isFinite(step.ms) && step.ms >= 0, `زمن الفص ${step.lobe} رقم صحيح`);
    }
  }
  const metrics = zubair.metrics;
  assert.ok(Number.isFinite(metrics.recentAccuracy) && Number.isFinite(metrics.previousAccuracy));
});

test('حكم بلا نبضة سابقة لا يُسقط الدماغ', async () => {
  const zubair = await newborn(0x5555);
  const judged = await zubair.judge({ verdict: 'praise' });
  assert.equal(judged.dopamine, 0, 'لا حكم على ما لم يُقل');
  assert.deepEqual(judged.learned, []);
});

test('خريطة الدماغ كاملة ومعرَّفة بالعربية', async () => {
  const zubair = await newborn();
  const lobes = zubair.lobes;
  assert.ok(lobes.length >= 13, `الفصوص كلها حاضرة (${lobes.length})`);
  for (const lobe of lobes) {
    assert.ok(lobe.name.length > 0, 'لكل فص اسم برمجي');
    assert.ok(/[؀-ۿ]/.test(lobe.ar), `اسم ${lobe.name} بالعربية`);
    assert.ok(/[؀-ۿ]/.test(lobe.role), `وظيفة ${lobe.name} بالعربية`);
  }
  const names = new Set(lobes.map((l) => l.name));
  assert.equal(names.size, lobes.length, 'لا فص مكرّر');
});

test('يفصح عن عتاده بصدق ولا يزعم معالجاً عصبياً', async () => {
  const zubair = await newborn();
  const compute = zubair.compute;
  assert.ok(['npu', 'gpu', 'cpu', 'none'].includes(compute.unit));
  assert.ok(compute.describeAr.length > 0, 'يشرح للأب على أي عتاد يفكّر');
  // في Node لا معالج عصبي: يجب ألا يزعم خلاف ذلك
  assert.equal(compute.unit, 'cpu', 'في بيئة بلا معالج عصبي يقول المعالج العادي');
});
