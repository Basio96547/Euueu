/* ————— اختبار الفهم السريع —————
 *
 * كل ما هنا وُلد من صورةٍ أرسلها الأب من جواله. فيها الحوار التالي حرفياً:
 *
 *   الأب: القطة حيوان
 *   زبير: علّمني، أريد أن أعرف            ← وقد عُلّم للتوّ
 *   الأب: (أحسنت)                          ← فتعزّز «الإقرار بالجهل» في موضع التعليم
 *   الأب: صغيره
 *   زبير: لا أعرف هذا، علّمني، عرفتُها وحدي  ← جهلٌ وفخرٌ في نفَسٍ واحد
 *   الأب: كيف عرفتها
 *   زبير: لا أعرف هذا، علّمني، عرفتُها وحدي برضو
 *
 * ثلاثة أعطال في ثلاثة أدوار: لا يعرف أنه عُلّم، ولا يعرف أن «صغيرة» وصفٌ لما
 * سبق، ويُلحق بكلامه شعوراً يناقضه. وهذه اختباراتها.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Zubair } from '../brain.js';
import { memoryStorage } from '../core/persist.js';
import { Lexicon } from '../core/text.js';
import { Rng } from '../core/tensor.js';
import { Syntax } from '../lobes/syntax.js';
import { Prefrontal } from '../lobes/prefrontal.js';
import { Emotion } from '../lobes/emotion.js';
import { STRATEGIES, STAGES } from '../core/types.js';

async function child(seed: number) {
  return Zubair.create({ storage: memoryStorage(), seed, fresh: true, heritage: true });
}

/* ————— الحذف: «صغيرة» وحدها كلامٌ عن القطة ————— */

test('يعرف المحمول المحذوف موضوعُه من غيره', () => {
  const syntax = new Syntax();
  const lexicon = new Lexicon(new Rng(0x3c1f));
  const bare = (text: string) => syntax.ellipsis(lexicon.perceive(text, true));

  assert.equal(bare('صغيرة')?.relation, 'صفة', 'الصفة المفردة محمولٌ محذوف');
  assert.equal(bare('صغيرة')?.comment, 'صغيره');
  assert.equal(bare('حيوان')?.relation, 'جنس');
  assert.equal(bare('تأكل')?.relation, 'فعل');

  assert.equal(bare('شو هذا؟'), null, 'والسؤال ليس محمولاً');
  assert.equal(bare('مرحبا'), null, 'ولا التحيّة');
  assert.equal(bare('أحسنت'), null, 'ولا المدح');
  assert.equal(bare('لا'), null, 'ولا التصحيح');
  assert.equal(bare('هي'), null, 'ولا الضمير: له بابه');
  assert.equal(bare('القطة حيوان'), null, 'ولا الجملة التامّة: لا حذف فيها');
});

test('«صغيرة» بعد «القطة حيوان» تُحفَظ عن القطة لا عن نفسها', async () => {
  const zubair = await child(0x9911);
  await zubair.hear('القطة حيوان');
  const out = await zubair.hear('صغيرة');

  const known = zubair.facts.filter((f) => f.subject === 'قطه');
  const objects = known.map((f) => f.object);
  assert.ok(objects.includes('حيوان'), 'جنسها باقٍ');
  assert.ok(objects.includes('صغيره'), `وصفتها حُفظت عنها (${objects.join('، ')})`);
  assert.ok(out.trace.some((step) => step.note.includes('محمولٌ محذوف')),
    'وأثر النبضة يُري الأب على مَن حُمِلت');
});

test('ولا يُحمَل ما لا يصحّ حمله: أول كلمة في العمر لا تجد ما تُحمَل عليه', async () => {
  const zubair = await child(0x77b1);
  const out = await zubair.hear('صغيرة');
  assert.equal(zubair.facts.filter((f) => f.object === 'صغيره').length, 0,
    'لا موضوع سابق فلا حمل — والحمل على غير موضعه أسوأ من تركه');
  assert.ok(out.text.length > 0);
});

/* ————— «علّمني» بعد أن عُلّم ————— */

test('مَن نزل فيه الدرس لا يقول «علّمني» ولا يُجيب عن سؤال لم يُسأل', () => {
  const prefrontal = new Prefrontal();
  const base = {
    stage: STAGES[3]!,
    intent: 'UNKNOWN' as const,
    askedRecently: [] as readonly string[],
    lastStrategies: [] as readonly string[] as never,
    hasFact: true,
    hasGeneralization: false,
    recallScore: 0.5,
    vocab: 400,
    unknownCount: 0,
    factConfidence: 0.7,
    lessonLanded: true,
  };

  const allowed = prefrontal.inhibit(STRATEGIES, base);
  assert.ok(!allowed.includes('ADMIT'), '«علّمني» ممنوعة على مَن عُلّم الآن');
  assert.ok(!allowed.includes('ANSWER_MEMORY'), 'والجواب ممنوع: أبوه يُعلّم لا يسأل');
  assert.ok(allowed.includes('ACKNOWLEDGE'), 'و«حفظت» هي الصواب');

  // وبلا درسٍ نازل يعود الإقرار بالجهل مباحاً — الصدق لا يُمنع
  const idle = prefrontal.inhibit(STRATEGIES, {
    ...base, lessonLanded: false, hasFact: false, intent: 'ASK', factConfidence: 0,
  });
  assert.ok(idle.includes('ADMIT'), 'ومَن سُئل عمّا لا يعرف يُقرّ بجهله');
});

test('في الدماغ كاملاً: لا يردّ على درسٍ بـ«علّمني»', async () => {
  const lessons = ['القطة حيوان', 'التفاحة فاكهة', 'دمشق مدينة', 'القلم أداة', 'البحر ماء'];
  for (const seed of [0x9911, 0x2277, 0x5533, 0x4e4e]) {
    const zubair = await child(seed);
    for (const lesson of lessons) {
      const out = await zubair.hear(lesson);
      assert.notEqual(out.strategy, 'ADMIT',
        `«${lesson}» درسٌ لا سؤال، فلا يُردّ عليه بـ«${out.text}»`);
    }
  }
});

/* ————— الشعور لا يناقض المقال ————— */

test('الفخر لا يُلحَق بإقرار بجهل — «لا أعرف، علّمني، عرفتُها وحدي»', () => {
  const emotion = new Emotion();
  // مدحٌ على جوابٍ من عنده: سعادة عالية وفخرٌ معها
  emotion.judged({ reward: 1, strategy: 'ANSWER_MEMORY', dopamine: 0.8 });
  assert.ok(emotion.feelings.complex['فخر'] > 0.5, 'فخره قائم');

  assert.ok(emotion.colorAr(3, true, 'answer') !== null, 'ويُقال مع الجواب');
  assert.equal(emotion.colorAr(3, true, 'admission'), null, 'ولا يُقال مع إقرار بجهل');
  assert.equal(emotion.colorAr(3, true, 'babble'), null, 'ولا مع ثغثغة: من لا يُركّب لا يصف');
});

test('شعورٌ ضئيل لا يُسمّى غالباً على شعورٍ يفوقه أضعافاً', () => {
  /* رآه الأب: مدحه على «إقرار بالتلقّي» فقيل له إن شعوره الغالب «فخر» ١٣٪
   * وسعادته ٨٥٪. والمعقّد يُقدَّم لأنه أخصّ، لا لأنه أولى مهما ضؤل. */
  const emotion = new Emotion();
  emotion.judged({ reward: 1, strategy: 'ACKNOWLEDGE', dopamine: 0.8 });
  const feelings = emotion.feelings;

  assert.ok(feelings.basic['سعادة'] > 0.6, 'سعادته عالية');
  assert.ok(feelings.complex['فخر'] < 0.3, 'وفخره ضئيل: لم يُنجز شيئاً من عنده');
  assert.equal(feelings.dominant?.name, 'سعادة',
    `فالغالب سعادته (قيل: ${feelings.dominant?.name} ${feelings.dominant?.intensity})`);
});

test('في الدماغ كاملاً: لا جملةَ تناقض نفسها', async () => {
  const contradictions = [/علّمني.*عرفتُها وحدي/, /ما بعرف.*شفت؟ عرفت/, /لا أعرف.*أنا مبسوط/, /ما بعرف.*أنا مبسوط/];
  for (const seed of [0x9911, 0x2277, 0x5533, 0x31bb, 0x4b1c]) {
    const zubair = await child(seed);
    const turns = ['القطة حيوان', 'صغيرة', 'كيف عرفتها', 'كيف لا تعرف', 'شو القطة؟', 'ليش القطة؟'];
    for (const turn of turns) {
      const out = await zubair.hear(turn);
      await zubair.judge({ verdict: 'praise' });
      for (const pattern of contradictions) {
        assert.ok(!pattern.test(out.text), `جملة تناقض نفسها: «${out.text}»`);
      }
    }
  }
});

/* ————— السرعة نفسها: درسٌ واحد يكفي ————— */

test('درسٌ واحد يكفي ليجيب — وهذا هو الفهم السريع مقيساً', async () => {
  const pairs: Array<[string, string, string]> = [
    ['الطائرة مركبة', 'شو الطائرة؟', 'مركبة'],
    ['الصقر طائر', 'شو الصقر؟', 'طائر'],
    ['الفستق مكسرات', 'شو الفستق؟', 'مكسرات'],
    ['حلب مدينة', 'شو حلب؟', 'مدينة'],
  ];

  let right = 0;
  for (const seed of [0x1111, 0x2222]) {
    const zubair = await child(seed);
    for (const [lesson, question, answer] of pairs) {
      await zubair.hear(lesson);
      const out = await zubair.hear(question);
      if (out.text.includes(answer)) right++;
    }
  }
  const total = pairs.length * 2;
  assert.ok(right >= total - 1,
    `يجيب عمّا عُلّمه مرّةً واحدة (${right}/${total})`);
});

test('ويبني على الدور السابق: ثلاثة أدوار عن شيء واحد تتراكم', async () => {
  const zubair = await child(0x6f6f);
  await zubair.hear('الفيل حيوان');
  await zubair.hear('كبير');
  await zubair.hear('يأكل');

  const known = zubair.facts.filter((f) => f.subject === 'فيل');
  assert.ok(known.length >= 2,
    `يعرف عن الفيل أكثر من شيء بعد ثلاثة أدوار (${known.map((f) => f.object).join('، ')})`);
});
