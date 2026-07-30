/* ————— اختبار أسئلته: أن تكون أسئلة طفلٍ لا حشوَ قالب —————
 *
 * قال الأب: «أسئلته غبية». وكانت كذلك، وسببها واحد: قالبٌ واحد يُحشى فيه أيُّ
 * لفظٍ كان بلا نظرٍ إلى قسمه ولا إلى موضوع الحوار. فخرجت جملٌ ملحونة:
 *
 *   «علّمني أكثر عن بيطير»   ← و«عن» لا تدخل على فعل
 *   «علّمني أكثر عن ضخم»     ← ولا على صفة مفردة
 *   «كلب دايماً صغيرة؟»       ← ولا يُوصَف مذكّرٌ بمؤنّث
 *   «الجمل متل جمل؟»          ← ولا يُسأل عن تشابه الشيء بنفسه
 *
 * وأكثر ما يُختبر هنا **زوالُ اللحن**، ثم أن يسأل سؤال الطفل الحقيقي: امتحانَ
 * قاعدةٍ بناها لا استفهاماً عن لفظ معلّق.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Zubair } from '../brain.js';
import { memoryStorage } from '../core/persist.js';
import { Parietal } from '../lobes/parietal.js';

async function child(seed: number) {
  return Zubair.create({ storage: memoryStorage(), seed, fresh: true, heritage: true });
}

/** كل ما يسأله في حوارٍ كامل، من عدّة بذور — عيّنةٌ تكفي للحكم. */
async function harvest(turns: readonly string[], seeds: readonly number[] = [0x77, 0x1234, 0x99aa, 0x4b2c]) {
  const asked: string[] = [];
  for (const seed of seeds) {
    const zubair = await child(seed);
    for (const turn of turns) {
      for (let repeat = 0; repeat < 3; repeat++) {
        const out = await zubair.hear(turn);
        if (out.kind === 'question') asked.push(out.text);
      }
    }
  }
  return asked;
}

const CONVERSATION = [
  'القطة حيوان', 'الكلب حيوان', 'صغيرة', 'الفيل حيوان', 'ضخم',
  'الوردة حلوة', 'بتفوح', 'العصفور بيطير', 'الجمل حيوان', 'بتاكل',
];

/* ————— زوال اللحن ————— */

test('لا يُدخِل «عن» ولا «كل» على فعلٍ ولا صفة', async () => {
  const asked = await harvest(CONVERSATION);
  assert.ok(asked.length > 10, `سأل أسئلة كثيرة (${asked.length})`);

  const verbsAndAdjectives = ['بيطير', 'بتفوح', 'بتاكل', 'ضخم', 'صغيرة', 'حلوة'];
  for (const question of asked) {
    for (const word of verbsAndAdjectives) {
      assert.ok(!question.includes(`عن ${word}`),
        `«عن» لا تدخل على «${word}»: «${question}»`);
      assert.ok(!question.includes(`كل ${word}`),
        `«كل» لا تدخل على «${word}»: «${question}»`);
      assert.ok(!question.includes(`شو ${word}؟`),
        `و«شو» لا تُسأل بها صفةٌ ولا فعل: «${question}»`);
    }
  }
});

test('لا يصف مذكّراً بمؤنّث ولا العكس', async () => {
  const asked = await harvest(CONVERSATION);
  const mismatched = [
    ['كلب', 'صغيرة'], ['كلب', 'حلوة'], ['فيل', 'صغيرة'], ['جمل', 'حلوة'],
    ['هاد', 'صغيرة'], ['هاد', 'حلوة'], ['وردة', 'ضخم'], ['قطة', 'ضخم'],
  ];
  for (const question of asked) {
    for (const [masculine, feminine] of mismatched) {
      assert.ok(!new RegExp(`${masculine}[^؟]*${feminine}`).test(question),
        `مطابقةٌ مكسورة: «${question}»`);
    }
  }
});

test('لا يسأل عن تشابه الشيء بنفسه', async () => {
  const asked = await harvest(CONVERSATION);
  for (const question of asked) {
    const like = question.match(/(\S+) (?:متل|مثل) (\S+)[؟]?/);
    if (!like) continue;
    const bare = (word: string): string =>
      (word.length >= 5 && word.startsWith('ال') ? word.slice(2) : word).replace(/[؟،]/g, '');
    assert.notEqual(bare(like[1]!), bare(like[2]!),
      `لا يُسأل عن تشابه الشيء بنفسه: «${question}»`);
  }
});

test('لا يسأل عن أدوات سؤالك', async () => {
  const asked = await harvest(['كيف عرفتها', 'ليش هيك', 'وين القطة', 'شو هذا', 'متى نروح']);
  const tools = ['كيف', 'ليش', 'وين', 'شو', 'متى', 'هيك'];
  for (const question of asked) {
    for (const tool of tools) {
      assert.ok(!question.includes(`عن ${tool}`) && !question.includes(`يعني ${tool}؟`),
        `أداة سؤالك ليست شيئاً يُسأل عنه: «${question}»`);
    }
  }
});

/* ————— أنها أسئلة طفل ————— */

test('يمتحن قاعدته: «القطة حيوان… وكمان الكلب حيوان؟»', async () => {
  /* أنفع سؤال يسأله طفل، وكان مكبوحاً: مُنع السؤالُ عند العلم لأنه كان يردّ
   * سؤال أبيه بسؤاله. وامتحانُ القاعدة ليس ردّ سؤال بسؤال. */
  const asked = await harvest(['القطة حيوان', 'الكلب حيوان', 'الفيل حيوان', 'الجمل حيوان']);
  const testsRule = asked.some((q) => /كمان|أيضاً|متل بعض|كل شي/.test(q));
  assert.ok(testsRule,
    `يمتحن ما بناه على شيء آخر:\n${asked.slice(0, 12).join('\n')}`);
});

test('يسأل عن الصفة سؤال الصفة، وعن الفعل سؤال الفعل', async () => {
  const onAdjective = await harvest(['الفيل حيوان', 'ضخم']);
  assert.ok(onAdjective.some((q) => /مين كمان|يعني|دايماً|ليش/.test(q)),
    `الصفة تُسأل بـ«شو يعني» أو «مين كمان» أو «دايماً» أو «ليش»:\n${onAdjective.join('\n')}`);

  const onVerb = await harvest(['العصفور حيوان', 'بيطير']);
  assert.ok(onVerb.some((q) => /ليش|كيف|مين كمان|دايماً/.test(q)),
    `والفعل يُسأل عن سببه وفاعله وكيفيته:\n${onVerb.join('\n')}`);
});

test('كل سؤال ينتهي بعلامة استفهام ولا يخرج فارغاً', async () => {
  const asked = await harvest(CONVERSATION);
  for (const question of asked) {
    assert.ok(question.trim().length >= 3, `سؤالٌ ذو معنى: «${question}»`);
    assert.ok(/[؟?]/.test(question) || question.length < 12,
      `سؤالٌ بعلامته: «${question}»`);
  }
});

test('ولا يُعيد السؤال نفسه في كل دور', async () => {
  const asked = await harvest(CONVERSATION, [0x77, 0x1234]);
  const unique = new Set(asked.map((q) => q.replace(/[،] .*$/, '')));
  assert.ok(unique.size >= 5,
    `يُنوّع أسئلته (${unique.size} صيغة مختلفة من ${asked.length} سؤالاً)`);
});

/* ————— الأخ في الجنس: أصل سؤال القاعدة ————— */

test('يجد أخاً في الجنس، ولا يجد ما ليس له أخ', () => {
  const parietal = new Parietal();
  parietal.learnFact('قطه', 'حيوان', 1, 'أبوه');
  parietal.learnFact('كلب', 'حيوان', 2, 'أبوه');
  parietal.learnFact('تفاحه', 'فاكهه', 3, 'أبوه');

  assert.equal(parietal.sibling('قطه')?.subject, 'كلب', 'أخوها في الجنس');
  assert.equal(parietal.sibling('كلب')?.subject, 'قطه');
  assert.equal(parietal.sibling('تفاحه'), null, 'ولا أخ لمن لا شريك له في جنسه');
  assert.equal(parietal.sibling('زرافه'), null, 'ولا لمن لا يعرفه أصلاً');
});
