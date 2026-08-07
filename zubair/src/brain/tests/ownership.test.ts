/* ————— اختبار جدول الملكية وقوانينه الثلاثة —————
 *
 * أربعةٌ من أعطاب الامتحان كانت عطباً واحداً: جوابٌ صحيح عن سؤالٍ لم يُطرح.
 * فهذه الاختبارات تمتحن العلاج في موضعه — الجدول نفسه — ثم تمتحنه في زبير
 * كاملاً، لأن جدولاً صحيحاً غير موصولٍ لا ينفع.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  OWNERSHIP, typeFits, voidIsFinal, voidAnswer,
  instinctMaySpeak, ALWAYS_ALLOWED, type Request,
} from '../core/ownership.js';
import { Syntax } from '../lobes/syntax.js';
import { Zubair } from '../brain.js';
import { memoryStorage } from '../core/persist.js';
import { Lexicon } from '../core/text.js';
import { Rng } from '../core/tensor.js';

async function grown(seed: number) {
  return Zubair.create({ storage: memoryStorage(), seed, fresh: true, heritage: true });
}

const CLOCK = 1_700_000_000_000;

async function afterTeaching(seed: number, lessons: readonly string[], ask: string) {
  const zubair = await grown(seed);
  let clock = CLOCK;
  for (const line of lessons) { await zubair.hear(line, clock); clock += 45_000; }
  return zubair.hear(ask, clock);
}

/* ————— الجدول نفسه ————— */

test('لكل طلبٍ مالكٌ واحد لا اثنان', () => {
  const seen = new Set<Request>();
  for (const row of OWNERSHIP) {
    assert.ok(!seen.has(row.request), `طلبٌ مكرّر في الجدول: ${row.request}`);
    seen.add(row.request);
  }
});

test('ولا فصَّ يملك ويُدلي بالدليل في الصفّ نفسه', () => {
  /* من يملك الحكم لا يُعدّ شاهداً على نفسه: خلطُهما هو عين الصلاحيات
   * المتداخلة التي جاء الجدول ليفكّها. */
  for (const row of OWNERSHIP) {
    if (row.owner === null) continue;
    assert.ok(
      !row.evidence.includes(row.owner),
      `«${row.request}»: ${row.owner} مالكٌ وشاهدٌ معاً`,
    );
  }
});

test('وكل طلبٍ يقول ماذا يقول حين لا يملك', () => {
  for (const row of OWNERSHIP) {
    assert.ok(row.voidAr.trim().length > 0, `«${row.request}» بلا عبارةِ فراغ`);
  }
});

/* ————— القانون الثاني: النوع ————— */

test('قانون النوع يردّ الجنس في وجه سؤالٍ عن المكان', () => {
  assert.equal(typeFits('مكان', 'جنس'), false);
  assert.equal(typeFits('فعل', 'جنس'), false);
  assert.equal(typeFits('صفة', 'جنس'), false);
  assert.equal(typeFits('جنس', 'جنس'), true);
});

test('ولا يردّ إقراراً بجهلٍ في وجه أي طلب', () => {
  for (const row of OWNERSHIP) {
    for (const kind of ALWAYS_ALLOWED) {
      assert.ok(typeFits(row.request, kind),
        `«${row.request}» ردّ «${kind}» — ومنعُه من الإقرار يدفعه إلى الاختلاق`);
    }
  }
});

test('ووسمُ الجواب خزانتُه لا حروفُه', () => {
  const syntax = new Syntax();
  /* «مدينة» جوابُ جنسٍ حين تخرج من خزانة الأجناس، وإن كان لفظها لفظَ مكان.
   * وقد جُرّب قياسُها بلفظها فسقط «شو دمشق؟ ← مدينة» — وهو صواب. */
  assert.equal(syntax.answerKind('مدينه', 'جنس'), 'جنس');
  assert.equal(syntax.answerKind('سريع', 'صفة'), 'صفة');
  assert.equal(syntax.answerKind('يطير', 'فعل'), 'فعل');
});

/* ————— القانون الأول: الفراغ ————— */

test('لا خزانةَ عنده للمكان ولا للزمان ولا للأشخاص', () => {
  const syntax = new Syntax();
  for (const request of ['مكان', 'زمان', 'شخص', 'سبب', 'رأي', 'حال'] as const) {
    assert.equal(syntax.storeFor(request), null, `«${request}» وُجدت له خزانة`);
    assert.ok(voidIsFinal(request), `«${request}» فراغُه غير نهائي`);
  }
});

test('وجوابُ الفراغ بلسان الطلب لا بلسانٍ عام', () => {
  assert.match(voidAnswer('مكان'), /وين/);
  assert.match(voidAnswer('زمان'), /إيمتى/);
  assert.match(voidAnswer('سبب'), /ليش/);
  assert.notEqual(voidAnswer('مكان'), voidAnswer('فعل'));
});

/* ————— القانون الثالث: الغريزة ————— */

test('الغريزة لا تتكلّم ما دام ثمّة طلب', () => {
  for (const request of ['جنس', 'صفة', 'فعل', 'مكان', 'عدد', 'تصديق'] as const) {
    assert.equal(instinctMaySpeak(request), false, `«${request}» سُمح فيه للغريزة`);
  }
  assert.equal(instinctMaySpeak('تحية'), true);
  assert.equal(instinctMaySpeak('حديث'), true);
});

/* ————— استخراج الطلب: مالكٌ واحد ————— */

test('النحو يفرّق «شو» من «شو يعمل»', () => {
  const syntax = new Syntax();
  const lexicon = new Lexicon(new Rng(0x11));
  const of = (text: string): Request => {
    const percept = lexicon.perceive(text, false);
    return syntax.request(percept, syntax.parse(percept));
  };
  assert.equal(of('شو الفسطاق؟'), 'جنس');
  assert.equal(of('شو يعمل الفسطاق؟'), 'فعل');
  assert.equal(of('وين الفسطاق؟'), 'مكان');
  assert.equal(of('كيف الفسطاق؟'), 'صفة');
  assert.equal(of('كيفك؟'), 'حال');
  assert.equal(of('ليش الفسطاق كبير؟'), 'سبب');
  assert.equal(of('مرحبا'), 'تحية');
});

/* ————— وأخيراً: في زبير كاملاً —————
 * جدولٌ صحيح غير موصولٍ لا ينفع، وهذه الأربعة هي أعطاب الامتحان بعينها. */

test('«وين» لا يُجاب بجنسٍ — قانون الفراغ في زبير', async () => {
  for (const seed of [0x5eed, 0x1379, 0x2b17]) {
    const out = await afterTeaching(seed, ['الكنكارو حيوان'], 'وين الكنكارو؟');
    assert.ok(!out.text.includes('حيوان'), `قال «${out.text}»`);
    assert.match(out.text, /وين/, `لم يُقرّ بلسان الطلب: «${out.text}»`);
  }
});

test('«شو يعمل» لا يُجاب بجنسٍ — قانون النوع في زبير', async () => {
  for (const seed of [0x5eed, 0x1379, 0x2b17]) {
    const out = await afterTeaching(seed, ['الفسطاق مرنجل'], 'شو يعمل الفسطاق؟');
    assert.ok(!out.text.includes('مرنجل'), `قال «${out.text}»`);
  }
});

test('«كيفك» تُجيبها الجزيرة لا خزانةُ الحقائق', async () => {
  for (const seed of [0x5eed, 0x1379, 0x2b17]) {
    const out = await afterTeaching(seed, [], 'كيفك؟');
    assert.equal(out.kind, 'answer', `أجاب «${out.text}» بنوع ${out.kind}`);
    assert.ok(!/ما وصلني|ما عندي معلومة|ما بعرف شو/.test(out.text), `قال «${out.text}»`);
  }
});

test('ولا تحيةَ في وجه سؤال — قانون الغريزة في زبير', async () => {
  for (const seed of [0x5eed, 0x1379, 0x2b17]) {
    const out = await afterTeaching(seed, ['المرنجل أداة'], 'شو المرنجل؟');
    assert.ok(!/هلا|أهلا|مرحبا|اشتقتلك/.test(out.text), `قال «${out.text}»`);
  }
});
