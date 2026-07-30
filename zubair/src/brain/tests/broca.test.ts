/* ————— اختبار الكلام: منطقة بروكا —————
 *
 * هذا الفص هو ما يراه الأب، فاختباره اختبارُ الصدق قبل أن يكون اختبار وظيفة:
 * أن يبقى الوليد وليداً في كلامه، وأن يُظهر التخمين تخميناً لا يقيناً، وأن يسأل
 * عمّا يجهله فعلاً لا عمّا يُلفَّق له.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Lexicon } from '../core/text.js';
import { Rng, vec } from '../core/tensor.js';
import { Broca, type SpeechRequest } from '../lobes/broca.js';
import { STAGES, STRATEGIES, type Fact, type Interoception, type Stage, type StageId, type Strategy } from '../core/types.js';

const INTERO: Interoception = {
  arousal: 1, fatigue: 0.1, curiosity: 0.6, attachment: 0.5, boredom: 0.1, confidence: 0.3,
};

function fact(subject: string, object: string, confidence = 0.8): Fact {
  return { subject, object, confidence, taughtBy: 'أبوه', lastSeenTick: 1 };
}

interface Options {
  strategy: Strategy;
  stage?: StageId;
  said?: string;
  unknown?: readonly string[];
  askedBefore?: readonly string[];
  fact?: Fact | null;
  generalized?: { fact: Fact; similarity: number } | null;
  seed?: number;
  lexicon?: Lexicon;
}

/** يبني طلب كلام كاملاً كما يبنيه الدماغ، فلا يُختبر الفص في فراغ. */
function request(options: Options): SpeechRequest {
  const lexicon = options.lexicon ?? new Lexicon(new Rng(0x5a1d));
  const percept = lexicon.perceive(options.said ?? 'القطة حيوان', true);
  const stage: Stage = STAGES[options.stage ?? 2]!;
  return {
    strategy: options.strategy,
    stage,
    percept,
    understanding: {
      meaning: vec(64), intent: 'ASK', intentProbs: Float32Array.from([0.6, 0.2, 0.2]), uncertainty: 0.3,
    },
    recall: { episodes: [], scores: [], best: null, bestScore: 0 },
    fact: options.fact ?? null,
    generalized: options.generalized ?? null,
    intero: INTERO,
    unknownWords: options.unknown ?? percept.unknown,
    askedBefore: options.askedBefore ?? [],
    lexicon,
    selfName: 'زبير',
    rng: new Rng(options.seed ?? 0x1234),
  };
}

const wordCount = (text: string): number => text.trim().split(/\s+/).filter(Boolean).length;

/* ————— التدرّج: الصدق في المرحلة ————— */

test('الوليد لا ينطق جملة تامة مهما كان جوابه صحيحاً', () => {
  const broca = new Broca();
  const limit = STAGES[0]!.maxWords;
  for (let seed = 0; seed < 50; seed++) {
    // حتى مع حقيقة صريحة يعرفها، لا يستطيع أن ينطقها جملة: هذا هو حدّ المرحلة
    const speech = broca.speak(request({
      strategy: 'ANSWER_MEMORY', stage: 0, fact: fact('قطه', 'حيوان'), seed,
    }));
    assert.ok(wordCount(speech.text) <= limit,
      `«${speech.text}» فيها ${wordCount(speech.text)} كلمة وحدّ الوليد ${limit}`);
    assert.ok(speech.text.trim().length > 0, 'ولا يسكت');
  }
});

test('كل مرحلة تحترم حدّها في خمسين توليدة', () => {
  const broca = new Broca();
  for (const stage of STAGES) {
    for (let seed = 0; seed < 50; seed++) {
      for (const strategy of STRATEGIES) {
        const speech = broca.speak(request({
          strategy, stage: stage.id, seed,
          fact: fact('قطه', 'حيوان'),
          generalized: { fact: fact('قطط', 'حيوان', 0.4), similarity: 0.4 },
        }));
        assert.ok(wordCount(speech.text) <= stage.maxWords,
          `[${stage.name}/${strategy}] «${speech.text}» تجاوزت ${stage.maxWords}`);
      }
    }
  }
});

test('لا فراغ ولا فاصلة معلّقة في آخر كلامه', () => {
  const broca = new Broca();
  for (const stage of STAGES) {
    for (const strategy of STRATEGIES) {
      for (let seed = 0; seed < 20; seed++) {
        const speech = broca.speak(request({ strategy, stage: stage.id, seed }));
        assert.ok(speech.text.trim().length > 0, `[${stage.name}/${strategy}] لا يسكت`);
        assert.ok(!/[،؛:,\-–—]$/u.test(speech.text.trim()),
          `[${stage.name}/${strategy}] «${speech.text}» تنتهي بعلامة وصل معلّقة`);
        assert.ok(!/[a-zA-Z]/.test(speech.text), 'ولا حرف لاتيني في كلام طفل عربي');
      }
    }
  }
});

/* ————— السؤال: أسئلة أطفال ————— */

test('يسأل عن كلمة يجهلها فعلاً وحاضرة في كلامك', () => {
  const broca = new Broca();
  const speech = broca.speak(request({
    strategy: 'ASK_QUESTION', stage: 1,
    said: 'عندي شيء اسمه كنكارو',
    unknown: ['كنكارو'],
  }));
  assert.equal(speech.kind, 'question');
  assert.equal(speech.about, 'كنكارو', 'يُسمّي ما سأل عنه ليُسجّله الجبهي');
  assert.ok(speech.text.includes('كنكارو'), `وسؤاله عنها فعلاً: «${speech.text}»`);
});

test('لا يعيد سؤالاً سأله: يبحث عن جهل آخر', () => {
  const broca = new Broca();
  const speech = broca.speak(request({
    strategy: 'ASK_QUESTION', stage: 2,
    said: 'عندي كنكارو وأيضاً بنغول',
    unknown: ['كنكارو', 'بنغول'],
    askedBefore: ['كنكارو'],
  }));
  assert.notEqual(speech.about, 'كنكارو', 'لا يعيد ما سأل عنه');
  assert.equal(speech.about, 'بنغول', 'بل ينتقل إلى جهله الآخر');
});

test('أسئلة الوليد ليست أسئلة اليافع', () => {
  const broca = new Broca();
  const collect = (stageId: StageId): Set<string> => {
    const out = new Set<string>();
    for (let seed = 0; seed < 30; seed++) {
      out.add(broca.speak(request({
        strategy: 'ASK_QUESTION', stage: stageId,
        said: 'عندي شيء اسمه كنكارو', unknown: ['كنكارو'], seed,
      })).text);
    }
    return out;
  };

  const infant = collect(1);
  const youth = collect(4);
  for (const question of infant) {
    assert.ok(!youth.has(question), `سؤال المُهد «${question}» لا يقوله اليافع`);
  }
  // ويافعُه يسأل سؤالاً أطول وأعمق: هذا هو النمو في الكلام
  const longestInfant = Math.max(...[...infant].map(wordCount));
  const longestYouth = Math.max(...[...youth].map(wordCount));
  assert.ok(longestYouth > longestInfant,
    `سؤال اليافع أطول (${longestInfant} ← ${longestYouth} كلمة)`);
});

test('حين لا يجهل شيئاً حاضراً يسأل سؤالاً عامّاً ولا يسكت', () => {
  const broca = new Broca();
  const lexicon = new Lexicon(new Rng(3));
  for (let i = 0; i < 3; i++) lexicon.perceive('القطة حيوان', true);
  const speech = broca.speak(request({
    strategy: 'ASK_QUESTION', stage: 1, said: 'القطة حيوان',
    unknown: [], askedBefore: ['قطه', 'القطه', 'حيوان'], lexicon,
  }));
  assert.equal(speech.kind, 'question');
  assert.ok(speech.text.includes('؟'), `سؤالٌ فيه علامته: «${speech.text}»`);
});

/* ————— الصدق في التعبير عن يقينه ————— */

test('الجواب من ذاكرة صريحة بلا تحفّظ، والتعميم بتحفّظ', () => {
  const broca = new Broca();
  const hedges = ['أظن', 'يمكن', 'ربما', 'مثل', 'مو متأكّد', 'لست متأكّد'];
  const hasHedge = (text: string): boolean => hedges.some((h) => text.includes(h));

  let memoryHedged = 0;
  let generalHedged = 0;
  for (let seed = 0; seed < 30; seed++) {
    const fromMemory = broca.speak(request({
      strategy: 'ANSWER_MEMORY', stage: 3, fact: fact('قطه', 'حيوان'), seed,
    }));
    if (hasHedge(fromMemory.text)) memoryHedged++;

    const byGuess = broca.speak(request({
      strategy: 'ANSWER_GENERAL', stage: 3, seed,
      generalized: { fact: fact('قطه', 'حيوان', 0.5), similarity: 0.6 },
    }));
    if (hasHedge(byGuess.text)) generalHedged++;
  }

  assert.equal(memoryHedged, 0, 'التحفّظ في موضع اليقين كذبٌ معكوس: أبوه علّمه هذا بنفسه');
  assert.ok(generalHedged >= 25, `والتخمين يظهر تخميناً (${generalHedged} من ٣٠)`);
});

test('شبه بعيد يستحقّ تحفّظاً أصرح', () => {
  const broca = new Broca();
  let explicit = 0;
  for (let seed = 0; seed < 20; seed++) {
    const speech = broca.speak(request({
      strategy: 'ANSWER_GENERAL', stage: 4, seed,
      generalized: { fact: fact('قطه', 'حيوان', 0.4), similarity: 0.35 },
    }));
    if (/مو متأكّد|لست متأكّد/.test(speech.text)) explicit++;
  }
  assert.ok(explicit >= 18, `يقول إنه غير متأكّد حين يكون الشبه بعيداً (${explicit} من ٢٠)`);
});

test('الإقرار بالجهل طلبُ تعليم لا اعتذار', () => {
  const broca = new Broca();
  for (let seed = 0; seed < 20; seed++) {
    const speech = broca.speak(request({ strategy: 'ADMIT', stage: 3, seed }));
    assert.equal(speech.kind, 'admission');
    assert.ok(/علّمني|بدي أعرف|أريد أن أعرف/.test(speech.text),
      `يطلب التعليم: «${speech.text}»`);
  }
});

/* ————— الثغثغة ————— */

test('يُثغثغ بما سمع لا بحروف عشوائية', () => {
  const broca = new Broca();
  const heard = 'دمشق';
  for (let seed = 0; seed < 30; seed++) {
    const speech = broca.speak(request({
      strategy: 'BABBLE', stage: 0, said: heard, seed,
    }));
    assert.equal(speech.kind, 'babble');
    // كل حرف في ثغثغته إمّا من كلمة أبيه أو صائت: الوليد يُثغثغ بما سمع
    for (const letter of speech.text.replace(/\s/g, '')) {
      assert.ok(heard.includes(letter) || 'اوي'.includes(letter),
        `الحرف «${letter}» في «${speech.text}» ليس مما سمعه`);
    }
  }
});

/* ————— اللهجة: كلامه يصير كلامك ————— */

test('يتعلّم لهجتك: خمس جمل شامية تُحوّل كلامه', () => {
  const shami = new Broca();
  const fusha = new Broca();

  const count = (broca: Broca, markers: readonly string[]): number => {
    let hits = 0;
    for (let seed = 0; seed < 20; seed++) {
      const text = broca.speak(request({ strategy: 'ADMIT', stage: 3, seed })).text;
      if (markers.some((m) => text.includes(m))) hits++;
    }
    return hits;
  };

  for (const sentence of ['شو هذا', 'ليش هيك', 'كيفك اليوم', 'بدي أعرف كتير', 'هاد منيح']) {
    shami.learnStyle(sentence);
  }
  for (const sentence of ['ماذا هذا', 'لماذا هكذا', 'كيف حالك', 'أريد أن أعرف كثيرا', 'هذا جيد', 'ليس هكذا']) {
    fusha.learnStyle(sentence);
  }

  assert.equal(shami.dialectAr, 'شامية', 'من كلّمه بالشامية صار شامياً');
  assert.equal(fusha.dialectAr, 'فصحى', 'ومن كلّمه بالفصحى صار فصيحاً');

  const shamiHits = count(shami, ['ما بعرف', 'بدي']);
  const fushaHits = count(fusha, ['لا أعرف', 'أريد']);
  assert.ok(shamiHits >= 18, `كلامه شاميّ (${shamiHits} من ٢٠)`);
  assert.ok(fushaHits >= 18, `وكلام الآخر فصيح (${fushaHits} من ٢٠)`);
});

test('لا يحكم بلهجة قبل ثلاث شواهد: التخمين ليس تعلّماً', () => {
  const broca = new Broca();
  assert.equal(broca.dialectAr, 'لم يتبيّن بعد', 'وليدٌ لم يسمع شيئاً لا لهجة له');
  broca.learnStyle('ماذا هذا');
  assert.equal(broca.dialectAr, 'لم يتبيّن بعد', 'وشاهدٌ واحد لا يكفي');
});

/* ————— الثبات والحفظ ————— */

test('نفس البذرة تُعطي نفس الكلام حرفياً', () => {
  const broca = new Broca();
  for (const strategy of STRATEGIES) {
    const first = broca.speak(request({ strategy, stage: 2, seed: 777, fact: fact('قطه', 'حيوان') }));
    const second = broca.speak(request({ strategy, stage: 2, seed: 777, fact: fact('قطه', 'حيوان') }));
    assert.equal(second.text, first.text, `«${strategy}» ثابت — وبلا ثبات لا يُختبر تعلّمه`);
  }
});

test('يتكلّم بإملاء أبيه لا بالصورة المطبَّعة', () => {
  const broca = new Broca();
  const lexicon = new Lexicon(new Rng(0xe1));
  lexicon.perceive('التفاحة فاكهة', true);

  // مفتاح الحقيقة مطبَّع («تفاحه») لأن الجُداري يُسقط التعريف ويطبّع
  const speech = broca.speak(request({
    strategy: 'ANSWER_MEMORY', stage: 3, lexicon, fact: fact('تفاحه', 'فاكهه'),
  }));
  assert.ok(speech.text.includes('فاكهة'), `يقول «فاكهة» لا «فاكهه»: «${speech.text}»`);
  assert.ok(!speech.text.includes('فاكهه'), 'فالتطبيع للفهم لا للكلام');
});

test('كلامه لا ينهار على مدخلات فقيرة', () => {
  const broca = new Broca();
  const empty = new Lexicon(new Rng(5));
  for (const strategy of STRATEGIES) {
    for (const said of ['', '   ', '؟', '١٢٣']) {
      const speech = broca.speak(request({
        strategy, stage: 0, said, unknown: [], askedBefore: [], fact: null,
        generalized: null, lexicon: empty,
      }));
      assert.ok(speech.text.trim().length > 0,
        `«${strategy}» على «${said}» لا يُخرج فراغاً`);
    }
  }
});

test('أسلوب أبيه يُحفظ ويُستعاد', () => {
  const broca = new Broca();
  for (const sentence of ['شو هذا', 'ليش هيك', 'كيفك', 'بدي أعرف']) broca.learnStyle(sentence);
  const expected = broca.speak(request({ strategy: 'ADMIT', stage: 3, seed: 42 })).text;

  const fresh = new Broca();
  fresh.load(JSON.parse(JSON.stringify(broca.save())));
  assert.equal(fresh.dialectAr, broca.dialectAr, 'اللهجة انتقلت');
  assert.equal(fresh.speak(request({ strategy: 'ADMIT', stage: 3, seed: 42 })).text, expected,
    'ونفس الكلام بعد الاستعادة');

  for (const bad of [null, 'نص', 6, {}, { shami: 'خطأ', openers: 'لا' }]) {
    assert.doesNotThrow(() => fresh.load(bad as never), 'وحالة عطبة لا تُسقطه');
  }
});
