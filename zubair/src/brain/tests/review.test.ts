/* ————— اختبار المراجعة والحَكَم —————
 *
 * وثلاثة شروطٍ وُضعت على هذا البناء قبل أن يُبنى، فتُختبَر واحداً واحداً:
 *
 *  ١) ثقةٌ **قابلةٌ للمقارنة**، أو رتبةٌ لا رقم. وقد قِيس الرقم فلم يفصل صوابه
 *     عن خطئه، فخرجت رتبة — ودعوى الرتبة أن أعلاها أصوبُ من أدناها، وهي دعوى
 *     تُكذَّب إن كذبت.
 *  ٢) مراجعةٌ **ذاتُ سلطة**: ثلاثة أفعالٍ لا رابع، ومرورٌ واحد وإعادةٌ واحدة
 *     بلا تعاود.
 *  ٣) **سجلٌّ** لكل مراجعة: من قال ماذا، وبأي رتبة، وماذا فعل الأب بعدها.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { rankOf, review, RANK_ORDER, type Claim } from '../core/review.js';
import { Arbiter } from '../lobes/arbiter.js';
import { Syntax } from '../lobes/syntax.js';
import { Zubair } from '../brain.js';
import { memoryStorage } from '../core/persist.js';
import { Lexicon } from '../core/text.js';
import { Rng } from '../core/tensor.js';
import type { Fact } from '../core/types.js';

const CLOCK = 1_700_000_000_000;
const SEEDS = [0x5eed, 0x1379, 0x2b17];

function fact(confidence: number, taughtBy = 'أبوه'): Fact {
  return { subject: 'س', object: 'ص', confidence, taughtBy, lastSeenTick: 1 };
}

const BASE: Claim = { fact: fact(0.6), generalized: false, dispute: 'لا نزاع', seen: false, read: false };

async function afterTeaching(seed: number, lessons: readonly string[], ask: string) {
  const zubair = await Zubair.create({ storage: memoryStorage(), seed, fresh: true, heritage: true });
  let clock = CLOCK;
  for (const line of lessons) { await zubair.hear(line, clock); clock += 45_000; }
  return zubair.hear(ask, clock);
}

/* ————— الرتبة ————— */

test('درسُ الأب الواحد يقين: هو ينقل ما سمع لا يستنتج', () => {
  assert.equal(rankOf(BASE), 'يقين');
});

test('والتعميم ضعيفٌ مهما بلغ شبهُه', () => {
  assert.equal(rankOf({ ...BASE, generalized: true }), 'ضعيف');
});

test('والنزاع القائم يُسقط، والمنقضي يُخفض', () => {
  assert.equal(rankOf({ ...BASE, dispute: 'قائم' }), 'ضعيف');
  assert.equal(rankOf({ ...BASE, dispute: 'انقضى' }), 'راجح');
});

test('وما هدمه تصحيحُ الأب لا يُقال', () => {
  assert.equal(rankOf({ ...BASE, fact: fact(0.24) }), 'ضعيف');
});

test('وما لا حقيقةَ فيه ضعيفٌ ولا يُبنى عليه', () => {
  assert.equal(rankOf({ ...BASE, fact: null }), 'ضعيف');
});

test('والرتب مرتَّبةٌ ترتيباً واحداً لا يختلف', () => {
  assert.ok(RANK_ORDER['يقين'] > RANK_ORDER['راجح']);
  assert.ok(RANK_ORDER['راجح'] > RANK_ORDER['ضعيف']);
});

/* ————— المراجعة: ثلاث سلطات، مرورٌ واحد، إعادةٌ واحدة ————— */

test('ما لا يطابق نوعَ الطلب يُردّ إلى مالكه مرّةً واحدة', () => {
  const first = review({ request: 'مكان', rank: 'يقين', claim: BASE, typeFits: false, isRedo: false });
  assert.equal(first.action, 'أُعيدت');
  /* ولا تعاود: من عاد بغير النوع بعد الردّ سقط. وبلا هذا تصير المراجعة حلقةً
   * لا حَكَماً، وتُعاد الدعوى إلى مالكها إلى ما لا نهاية. */
  const second = review({ request: 'مكان', rank: 'يقين', claim: BASE, typeFits: false, isRedo: true });
  assert.equal(second.action, 'أُسقطت');
});

test('واليقين يمرّ، والراجح يُخفَض، والضعيف يسقط', () => {
  const of = (rank: 'يقين' | 'راجح' | 'ضعيف') =>
    review({ request: 'جنس', rank, claim: BASE, typeFits: true, isRedo: false }).action;
  assert.equal(of('يقين'), 'أُقرّت');
  assert.equal(of('راجح'), 'أُخفضت');
  assert.equal(of('ضعيف'), 'أُسقطت');
});

test('ولا فعلَ رابع', () => {
  const actions = new Set<string>();
  for (const rank of ['يقين', 'راجح', 'ضعيف'] as const) {
    for (const typeFits of [true, false]) {
      for (const isRedo of [true, false]) {
        for (const claim of [BASE, { ...BASE, fact: null }]) {
          actions.add(review({ request: 'جنس', rank, claim, typeFits, isRedo }).action);
        }
      }
    }
  }
  assert.deepEqual([...actions].sort(), ['أُخفضت', 'أُسقطت', 'أُعيدت', 'أُقرّت']);
});

/* ————— السجلّ ————— */

test('كل مراجعةٍ تُكتب، وحكمُك يُلحَق بها', () => {
  const arbiter = new Arbiter();
  arbiter.record({
    tick: 1, request: 'جنس', owner: 'الجُداري', rank: 'راجح',
    action: 'أُخفضت', why: 'نُوزعت ثم استقرّت', said: 'بظنّي القطة حيوان',
  });
  assert.equal(arbiter.entries.length, 1);
  assert.equal(arbiter.entries[0]?.fatherSaid, null);
  arbiter.fatherJudged('praise');
  assert.equal(arbiter.entries[0]?.fatherSaid, 'praise');
  /* وحكمٌ ثانٍ لا يُبدّل الأول: لكلّ مراجعةٍ حكمٌ واحد */
  arbiter.fatherJudged('correct');
  assert.equal(arbiter.entries[0]?.fatherSaid, 'praise');
});

test('والحصاد يقول: كم مرّةً وقع كلُّ فعل، وكم مرّةً وافقتَه', () => {
  const arbiter = new Arbiter();
  for (let i = 0; i < 3; i++) {
    arbiter.record({
      tick: i, request: 'جنس', owner: 'الجُداري', rank: 'يقين',
      action: 'أُقرّت', why: '', said: '',
    });
    arbiter.fatherJudged(i === 0 ? 'correct' : 'praise');
  }
  const row = arbiter.tally().find((r) => r.action === 'أُقرّت');
  assert.equal(row?.times, 3);
  assert.equal(row?.praised, 2);
  assert.equal(row?.corrected, 1);
});

test('والسجلّ يبقى بعد إغلاق التطبيق', () => {
  const arbiter = new Arbiter();
  arbiter.record({
    tick: 7, request: 'مكان', owner: 'الجُداري', rank: 'ضعيف',
    action: 'أُسقطت', why: 'لا شيء عند مالكه', said: 'ما بعرف وين',
  });
  arbiter.fatherJudged('praise');
  const revived = new Arbiter();
  revived.load(JSON.parse(JSON.stringify(arbiter.save())));
  assert.equal(revived.entries.length, 1);
  assert.equal(revived.entries[0]?.action, 'أُسقطت');
  assert.equal(revived.entries[0]?.fatherSaid, 'praise');
});

/* ————— المخرج الثالث: الملتبس ————— */

test('النحو يقول «لم أحدّد» بدل أن يجزم بتأويلٍ من اثنين', () => {
  const syntax = new Syntax();
  const lexicon = new Lexicon(new Rng(0x11));
  const of = (text: string) => {
    const percept = lexicon.perceive(text, false);
    return syntax.request(percept, syntax.parse(percept));
  };
  // أداةُ صفةٍ مع فعل استخبار: صفةٌ أم فعل؟
  assert.equal(of('كيف بتعمل هالشي؟'), 'مُلتبس');
  // إشارةٌ إلى حاضرٍ لا يراه
  assert.equal(of('شو هالحكي'), 'مُلتبس');
  // شرطٌ لا استفهام
  assert.equal(of('وين ما تروح'), 'مُلتبس');
  // وما بيّنَ لا يُجعل ملتبساً: الالتباس يُرصَد ولا يُوسَّع
  assert.equal(of('شو الفسطاق؟'), 'جنس');
  assert.equal(of('وين الفسطاق؟'), 'مكان');
});

test('وجوابُ الملتبس سؤالٌ لا ترجيح', async () => {
  for (const seed of SEEDS) {
    const out = await afterTeaching(seed, ['الشفنترة أداة'], 'كيف بتعمل هالشي؟');
    assert.equal(out.kind, 'question', `قال «${out.text}» بنوع ${out.kind}`);
    assert.ok(!out.text.includes('أداة'), `رجّح تأويلاً: «${out.text}»`);
  }
});

/* ————— ووصلُ كلِّ ذلك في زبير ————— */

test('ما نُوزع ثم استقرّ يُقال ظنّاً لا جزماً', async () => {
  for (const seed of SEEDS) {
    const out = await afterTeaching(
      seed,
      ['الدرنبوش فاكهة', 'الدرنبوش خضار', 'الدرنبوش خضار', 'الدرنبوش خضار'],
      'شو الدرنبوش؟',
    );
    assert.match(out.text, /خضار/, `قال «${out.text}»`);
    assert.equal(out.rank, 'راجح', `رتبةُ «${out.text}» كانت ${out.rank}`);
    assert.match(out.text, /بظنّي|أظنّ/, `جزم بما نُوزع فيه: «${out.text}»`);
  }
});

test('وما لم يُنازَع يُقال جزماً بلا «بظنّي»', async () => {
  for (const seed of SEEDS) {
    const out = await afterTeaching(seed, ['الزقفوط نبات'], 'شو الزقفوط؟');
    assert.equal(out.rank, 'يقين');
    assert.ok(!/بظنّي|أظنّ/.test(out.text), `تحفّظ بلا سبب: «${out.text}»`);
  }
});
