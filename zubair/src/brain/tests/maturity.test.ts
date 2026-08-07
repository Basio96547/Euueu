/* ————— اختبار الشابّ —————
 *
 * طلب الأب أربعة: يتعلّم بسرعة، يتذكّر أطول، لا تشتّت، لا هلوسة، ولا قواعد
 * أطفال. وكلها تُقاس، وهذه مقاييسها.
 *
 * والفرق بين هذه المرحلة وما قبلها فرقُ **طبع** لا طول: التدرّج كان صدقاً حين
 * كان وليداً — وليدٌ ينطق جملةً تامة كذبٌ ينكشف. وصار التدرّج نفسه عيباً بعد أن
 * كبر: شابٌّ يثغثغ، ويقول «صح؟» بعد كل جملة، ويُعلن شعوره في كل دور — طفلٌ
 * يتنكّر في هيئة شاب.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Zubair } from '../brain.js';
import { memoryStorage } from '../core/persist.js';
import { Parietal } from '../lobes/parietal.js';
import { Emotion } from '../lobes/emotion.js';
import { Syntax } from '../lobes/syntax.js';
import { Lexicon } from '../core/text.js';
import { Rng } from '../core/tensor.js';
import { DIMS, MATURE_STAGE, STAGES } from '../core/types.js';
import { HERITAGE_FACTS } from '../core/heritage.js';

async function grown(seed: number) {
  return Zubair.create({ storage: memoryStorage(), seed, fresh: true, heritage: true });
}

/* ————— أنه صار شاباً ————— */

test('يولد شاباً: مفرداته ومعرفته تبلغان المرحلة', async () => {
  const zubair = await grown(0x55);
  const m = zubair.metrics;
  assert.equal(m.stage.name, 'شاب', `مرحلته (${m.stage.name} · ${m.vocab} كلمة)`);
  assert.ok(m.vocab >= 650, `مفرداته تبلغ حدّ الشابّ (${m.vocab})`);
  assert.ok(m.facts >= 450, `ومعرفته كذلك (${m.facts})`);
  assert.ok(m.stage.id >= MATURE_STAGE);
});

test('ولا يجهل أكثر ممّا يعرف: ميراثه أكثر من صنفٍ واحد', () => {
  const kinds = new Set(HERITAGE_FACTS.map(([, , relation]) => relation ?? 'جنس'));
  assert.ok(kinds.has('جنس') && kinds.has('صفة') && kinds.has('فعل'),
    `يرث أجناساً وصفاتٍ وأفعالاً (${[...kinds].join('، ')})`);
});

/* ————— لا قواعد أطفال ————— */

test('لا يثغثغ ولا يستأذن ولا يستجدي', async () => {
  const childish = [/^[بمدتنلكج][اوي]{1,2}$/, /صح؟$/, /صحيح؟$/, /علّمني، بدي أعرف/, /ما بعرف شو هذا/];
  for (const seed of [0x55, 0x2277, 0x4b1c]) {
    const zubair = await grown(seed);
    const turns = ['مرحبا', 'البحر أزرق', 'شو البحر؟', 'كيف البحر؟', 'الكوانتم علم',
      'شو الكوانتم؟', 'أحسنت', 'شو الشيء الذي لا أعرفه؟'];
    for (const turn of turns) {
      const out = await zubair.hear(turn);
      assert.notEqual(out.strategy, 'BABBLE', `الشابّ لا يثغثغ: «${out.text}»`);
      for (const pattern of childish) {
        assert.ok(!pattern.test(out.text), `عبارةُ طفلٍ في كلام شابّ: «${out.text}»`);
      }
    }
  }
});

test('ولا يُعلن شعوره في كل دور', () => {
  const emotion = new Emotion();
  emotion.judged({ reward: 0.6, strategy: 'ANSWER_MEMORY', dopamine: 0.4 });
  const mild = emotion.feelings.dominant?.intensity ?? 0;
  assert.ok(mild > 0.2, `شعوره قائم (${emotion.feelings.dominant?.name} ${mild.toFixed(2)})`);
  assert.equal(emotion.colorAr(5, true, 'answer'), null,
    'ولا يقوله الشابّ عند هذه الشدّة');
  assert.ok(emotion.colorAr(3, true, 'answer') !== null,
    'والطفل يقوله عندها — وهذا هو الفرق');

  // والشدّة الغالبة تُقال في كل سنّ: الشابّ يحمل شعوره ولا يكتمه إذا غلبه
  const strong = new Emotion();
  strong.judged({ reward: 1, strategy: 'ANSWER_MEMORY', dopamine: 0.9 });
  assert.ok(strong.colorAr(5, true, 'answer') !== null, 'وما غلبه يقوله');
});

test('ويردّ التحيّة تحيّةً لا سؤالاً', async () => {
  for (const seed of [0x55, 0x2277, 0x4b1c, 0x9911]) {
    const zubair = await grown(seed);
    const out = await zubair.hear('مرحبا');
    assert.ok(out.strategy === 'GREET_BACK' || /مرحب|أهل|هلا|سلام/.test(out.text),
      `«مرحبا» تُردّ بتحيّة لا بـ«${out.text}»`);
  }
});

/* ————— يتعلّم بسرعة ————— */

test('درسٌ واحد على شيء لم يسمعه قط يكفي', async () => {
  const lessons: Array<[string, string, string]> = [
    ['الكوانتم علم', 'شو الكوانتم؟', 'علم'],
    ['الزنبق نبات', 'شو الزنبق؟', 'نبات'],
    ['البوصلة أداة', 'شو البوصلة؟', 'أداة'],
    ['الأوزون غاز', 'شو الأوزون؟', 'غاز'],
  ];
  let right = 0;
  for (const seed of [0x55, 0x2277]) {
    const zubair = await grown(seed);
    for (const [lesson, question, answer] of lessons) {
      await zubair.hear(lesson);
      const out = await zubair.hear(question);
      if (out.text.includes(answer)) right++;
    }
  }
  const total = lessons.length * 2;
  assert.ok(right >= total - 1, `يجيب عن كل ما عُلّمه مرّة (${right}/${total})`);
});

test('وكلمةُ أبيه تعلو الموروث من أول مرة', () => {
  const parietal = new Parietal();
  parietal.learnFact('قطه', 'وديعه', 0, 'الميراث', 'صفة');
  parietal.learnFact('قطه', 'شرسه', 1, 'أبوه', 'صفة');
  assert.equal(parietal.lookup('قطه', 'صفة')?.object, 'شرسه',
    'ما قاله أبوه أولى مما ورِثه من محيطه');
  assert.equal(parietal.lookup('قطه', 'صفة')?.taughtBy, 'أبوه');

  // ولا ينقلب الموروثُ بموروث: النزاع بينهما على حاله
  const other = new Parietal();
  other.learnFact('قطه', 'وديعه', 0, 'الميراث', 'صفة');
  other.learnFact('قطه', 'شرسه', 1, 'الميراث', 'صفة');
  assert.equal(other.lookup('قطه', 'صفة')?.object, 'وديعه', 'والموروث لا يهدم موروثاً من مرة');
});

test('ولا يمحو الصفةُ الجنسَ ولو لم تكن في قائمة الصفات', async () => {
  /* «شرسة» ليست في قائمة الصفات المكتوبة، فكانت تُقرأ جنساً فتمحو «حيوان».
   * والجُداري يصحّحها بما تعلّمه: «شرسة» لم تكن جنساً لشيء قط، و«حيوان» جنسٌ
   * لعشرات — فالأولى صفة. تصحيحٌ يتحسّن بالتعلّم لا يجمد على قائمة. */
  const zubair = await grown(0x55);
  await zubair.hear('القطة شرسة');
  const known = zubair.facts.filter((f) => f.subject === 'قطه').map((f) => f.object);
  assert.ok(known.includes('حيوان'), `جنسها باقٍ (${known.join('، ')})`);
  assert.ok(known.includes('شرسه'), 'وصفتها الجديدة معه');

  const genus = await zubair.hear('شو القطة؟');
  assert.ok(genus.text.includes('حيوان'), `«شو» يُجاب بالجنس: «${genus.text}»`);
  const manner = await zubair.hear('كيف القطة؟');
  assert.ok(manner.text.includes('شرسة') || manner.text.includes('شرسه'),
    `و«كيف» بالصفة الجديدة: «${manner.text}»`);
});

/* ————— يتذكّر أطول ————— */

test('ذاكرته العاملة وذاكرته العرضية اتّسعتا', () => {
  assert.ok(DIMS.workingMemory >= 12, `يُمسك خيط الحديث (${DIMS.workingMemory} دوراً)`);
  assert.ok(DIMS.episodes >= 16384, `ولا ينسى أوائل ما عُلّم (${DIMS.episodes} ذكرى)`);
});

test('ويبني على أدوارٍ متتابعة بلا أن يفقد الموضوع', async () => {
  const zubair = await grown(0x6f6f);
  await zubair.hear('المريخ كوكب');
  await zubair.hear('أحمر');
  await zubair.hear('بعيد');

  const known = zubair.facts.filter((f) => f.subject === 'مريخ').map((f) => f.object);
  assert.ok(known.includes('كوكب'), `جنسه محفوظ (${known.join('، ')})`);
  assert.ok(known.length >= 2, 'وما بُني عليه في الأدوار التالية معه');
});

/* ————— لا هلوسة ————— */

test('لا يجزم بما ثقتُه فيه ضعيفة', async () => {
  const zubair = await grown(0x31bb);
  await zubair.hear('الزنبق نبات');
  // تصحيحان متتاليان يهبطان بالثقة تحت حدّ الجزم
  for (let i = 0; i < 3; i++) {
    await zubair.hear('شو الزنبق؟');
    await zubair.judge({ verdict: 'correct' });
  }
  const out = await zubair.hear('شو الزنبق؟');
  assert.ok(!out.text.includes('نبات'),
    `لا يجزم بما هُدمت ثقته فيه: «${out.text}»`);
});

test('ولا يخمّن على شبهٍ ضعيف', async () => {
  /* التخمين على شبه الحروف هو منبع الهلوسة الوحيد تقريباً في هذا الدماغ:
   * ينقل محمول شيءٍ إلى شيءٍ يشبهه في حروفه لا في معناه. */
  const zubair = await grown(0x4b1c);
  const invented = ['الزقفوط', 'المرنجل', 'الخبنتر', 'الفسطاق', 'الدرنبوش'];
  for (const word of invented) {
    const out = await zubair.hear(`شو ${word}؟`);
    assert.notEqual(out.strategy, 'ANSWER_MEMORY',
      `لا يجزم عن شيء لم يسمعه قط: «${out.text}»`);
  }
});

test('ولا يقول ما يناقض ما يعرف', async () => {
  const zubair = await grown(0x55);
  await zubair.hear('البحر أزرق');
  for (let i = 0; i < 6; i++) {
    const out = await zubair.hear('كيف البحر؟');
    assert.ok(!/أخضر|أصفر|أسود/.test(out.text), `جوابٌ مختلق: «${out.text}»`);
  }
});

/* ————— لا تشتيت ————— */

test('لا يتأرجح في السؤال نفسه: جوابٌ ثابت لا قرعة', async () => {
  const zubair = await grown(0x2277);
  await zubair.hear('الكوانتم علم');
  const answers = new Set<string>();
  let answered = 0;
  for (let i = 0; i < 10; i++) {
    const out = await zubair.hear('شو الكوانتم؟');
    if (out.text.includes('علم')) answered++;
    answers.add(out.strategy);
  }
  assert.ok(answered >= 9, `يجيب في كل مرة لا في بعضها (${answered}/10)`);
  assert.ok(answers.size <= 2, `ولا يتنقّل بين الاستجابات (${[...answers].join('، ')})`);
});

test('ولا يسأل عن تحيّة أبيه ولا عن أداة سؤاله', async () => {
  for (const seed of [0x55, 0x2277]) {
    const zubair = await grown(seed);
    for (const turn of ['مرحبا', 'كيفك', 'أهلا', 'أحسنت', 'شكرا']) {
      const out = await zubair.hear(turn);
      assert.ok(!/يعني مرحبا|عن مرحبا|يعني كيفك|يعني أحسنت|عن شكرا/.test(out.text),
        `تحيّتك ليست شيئاً يُسأل عنه: «${out.text}»`);
    }
  }
});

test('ومدى تجريبه يضيق بنضجه', () => {
  const young = STAGES[2]!;
  const mature = STAGES[5]!;
  assert.ok(mature.questionBias < young.questionBias,
    `الشابّ أقلّ سؤالاً وأكثر جواباً (${mature.questionBias} مقابل ${young.questionBias})`);
  assert.ok(mature.maxWords > young.maxWords, 'وجملته أطول');
});

/* ————— وأنه بقي صادقاً ————— */

test('لا يزال يُقرّ بجهله فيما لا يعرف', async () => {
  const zubair = await grown(0x55);
  const out = await zubair.hear('شو الزقفوط؟');
  assert.ok(/ما عندي|ما بعرف|لا أعرف|لا أملك|ما وصلني|\?|؟/.test(out.text),
    `يُقرّ بحدّ معرفته: «${out.text}»`);
});

test('ولا ينسب إلى أبيه ما لم يُعلّمه', async () => {
  const zubair = await grown(0x4e4e);
  for (let i = 0; i < 10; i++) {
    const out = await zubair.hear('شو البحر؟');
    assert.ok(!out.text.includes('علّمتني'), `الموروث لا يُنسَب إلى أبيه: «${out.text}»`);
  }
  await zubair.hear('الزنبق نبات');
  let claimed = false;
  for (let i = 0; i < 10; i++) {
    if ((await zubair.hear('شو الزنبق؟')).text.includes('علّمتني')) claimed = true;
  }
  assert.ok(claimed, 'وما علّمه إياه ينسبه إليه');
});

test('واسمٌ يبدأ بحرف مضارعة لا يُقرأ فعلاً', () => {
  const syntax = new Syntax();
  const lexicon = new Lexicon(new Rng(0x33));
  for (const noun of ['نبات', 'نهار', 'يوم', 'تراب', 'ارض', 'انسان']) {
    assert.notEqual(syntax.classify(noun).pos, 'فعل', `«${noun}» اسمٌ لا فعل`);
  }
  // والفعل يبقى فعلاً
  assert.equal(syntax.parse(lexicon.perceive('الولد يكتب', true)).relation, 'فعل');
});
