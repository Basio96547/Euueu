/* ————— اختبار الذاكرة: الحُصين والمهاد —————
 *
 * القاعدة هنا أن كل اختبار يُثبت وظيفةً برقم لا بوجود دالة: الاستدعاء يُثبت
 * بتشابه أعلى من عتبة، والنسيان بذكرى بقيت وأخرى ذهبت، والتعزيز بفرق بين رقمٍ
 * قبل ورقمٍ بعد. ولذلك كل عشوائية هنا من `Rng` ببذرة ثابتة: لو دخل
 * `Math.random` صار «زبير يتعلّم» انطباعاً لا يُبرهَن.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Hippocampus, type HippocampusState } from '../lobes/hippocampus.js';
import { Thalamus, type ThalamusState } from '../lobes/thalamus.js';
import { Rng, matvec, reluInto, sigmoidInto, tanhInto, vec, type Vec } from '../core/tensor.js';
import { DIMS, type Accelerator, type ComputePort, type Episode, type Interoception } from '../core/types.js';
import type { Percept } from '../core/text.js';

const GATE_IN = DIMS.word + 6;

/* ————— منافذ حساب اختبارية —————
 * نكتبها هنا لا في `core/npu.ts` كي لا يعتمد اختبار الذاكرة على فص غيره. */

/** منفذ يحسب التشابه ضرباً داخلياً عارياً بلا قسمة — وهذا ما تفترضه مفاتيح الحُصين. */
function dotPort(): ComputePort {
  return {
    unit: 'cpu',
    describeAr: 'منفذ اختباري: ضرب داخلي عارٍ',
    dense(x, w, b, inDim, outDim, activation) {
      const y = vec(outDim);
      matvec(y, x, w, inDim, outDim);
      if (b) for (let j = 0; j < outDim; j++) y[j]! += b[j]!;
      if (activation === 'tanh') tanhInto(y);
      else if (activation === 'sigmoid') sigmoidInto(y);
      else if (activation === 'relu') reluInto(y);
      return y;
    },
    similarities(query, keys, count, dim) {
      const out = vec(count);
      for (let i = 0; i < count; i++) {
        let sum = 0;
        const base = i * dim;
        for (let d = 0; d < dim; d++) sum += query[d]! * keys[base + d]!;
        out[i] = sum;
      }
      return out;
    },
  };
}

/**
 * مسرّع يحسب التشابه الجيبي كاملاً بالقسمة على الطولين — عكس المنفذ أعلاه بقصد.
 * وجوده هنا اختبارٌ لقرار تصميمي: تسوية المفتاح والاستفهام معاً يجب أن تجعل
 * النتيجتين واحدة، وإلا تغيّر سلوك زبير باختلاف الجهاز الذي يفكّر عليه.
 */
function cosineAccelerator(): Accelerator {
  return {
    unit: 'cpu',
    describeAr: 'مسرّع اختباري: تشابه جيبي بالقسمة',
    details: 'يُستخدم لإثبات أن تسوية المفاتيح تُغني عن القسمة',
    async similarities(query, keys, count, dim) {
      const out = vec(count);
      let queryNorm = 0;
      for (let d = 0; d < dim; d++) queryNorm += query[d]! * query[d]!;
      queryNorm = Math.sqrt(queryNorm);
      for (let i = 0; i < count; i++) {
        const base = i * dim;
        let sum = 0;
        let keyNorm = 0;
        for (let d = 0; d < dim; d++) {
          const k = keys[base + d]!;
          sum += query[d]! * k;
          keyNorm += k * k;
        }
        keyNorm = Math.sqrt(keyNorm);
        out[i] = queryNorm === 0 || keyNorm === 0 ? 0 : sum / (queryNorm * keyNorm);
      }
      return out;
    },
    dispose() {
      /* لا موارد خارجية في المسرّع الاختباري */
    },
  };
}

/* ————— مولّدات مدخلات ثابتة ————— */

type NewEpisode = Omit<Episode, 'id' | 'replays'>;

function randomMeaning(rng: Rng): number[] {
  const out: number[] = [];
  for (let i = 0; i < DIMS.meaning; i++) out.push(rng.gauss());
  return out;
}

function toVec(values: readonly number[]): Vec {
  return Float32Array.from(values);
}

/** معنى مشوَّش قليلاً: هكذا يعود المعنى فعلاً — أب يقول الجملة مرة أخرى بصيغة قريبة. */
function perturb(values: readonly number[], rng: Rng, scale: number): Vec {
  const out = vec(values.length);
  for (let i = 0; i < values.length; i++) out[i] = values[i]! + scale * rng.gauss();
  return out;
}

function episodeOf(said: string, meaning: readonly number[], tick: number, reward: number): NewEpisode {
  return {
    said,
    tokens: said.split(' '),
    meaning,
    intent: 'TEACH_FACT',
    subject: null,
    object: null,
    relation: null,
    replied: null,
    reward,
    tick,
  };
}

/**
 * تنبيه لمن يزيد اختباراً هنا: كل تمثيلات كلمات الجملة الواحدة تُسحَب من مجرى
 * `Rng` واحد لا من `new Rng(base + i)`. السبب أن باني `Rng` يُجبر البت الأدنى في
 * كلماته الأربع (`seed | 1`)، فالبذرتان ٢ن و٢ن+١ تُنتجان المجرى نفسه حرفياً —
 * أي كلمتين بتمثيل واحد، وهو ما يُفسد أي اختبار تمييز بصمت.
 */
function randomWordVec(rng: Rng): Vec {
  const out = vec(DIMS.word);
  const scale = 1 / Math.sqrt(DIMS.word);
  for (let i = 0; i < DIMS.word; i++) out[i] = rng.gauss() * scale;
  return out;
}

function perceptOf(words: readonly string[], tokenVecs: Vec[]): Percept {
  return {
    raw: words.join(' '),
    tokens: [...words],
    ids: words.map((_, i) => i),
    unknown: [],
    tokenVecs,
    charBag: vec(DIMS.word),
    isQuestion: false,
  };
}

function samplePercept(words: readonly string[], rng: Rng): Percept {
  return perceptOf(words, words.map(() => randomWordVec(rng)));
}

function baseIntero(): Interoception {
  return { arousal: 0.8, fatigue: 0.2, curiosity: 0.5, attachment: 0.3, boredom: 0.1, confidence: 0.4 };
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

function allFinite(v: Vec): boolean {
  for (let i = 0; i < v.length; i++) if (!Number.isFinite(v[i])) return false;
  return true;
}

/* ————— الحُصين ————— */

test('الحُصين: الذكرى تُستدعى بمعناها فتتصدّر، والمعنى الغريب يقع أدنى', () => {
  const rng = new Rng(0xa11ce);
  const h = new Hippocampus();

  const cat = randomMeaning(rng);
  const car = randomMeaning(rng);
  const rain = randomMeaning(rng);
  const stored = h.store(episodeOf('القطة حيوان', cat, 10, 0));
  h.store(episodeOf('السيارة تمشي', car, 11, 0));
  h.store(episodeOf('المطر ينزل', rain, 12, 0));

  assert.equal(h.count, 3);

  // نفس المعنى بالضبط: التشابه يجب أن يبلغ الواحد تقريباً
  const exact = h.recall(toVec(cat), 3, dotPort());
  assert.equal(exact.best?.id, stored.id);
  assert.ok(exact.bestScore > 0.999, `التشابه بنفس المعنى ${exact.bestScore}`);

  // معنى قريب لا مطابق: هذا هو الاستدعاء الحقيقي
  const near = h.recall(perturb(cat, new Rng(0xb0b), 0.15), 3, dotPort());
  assert.equal(near.best?.id, stored.id, 'الأشبه يجب أن يكون الذكرى نفسها');
  assert.ok(near.bestScore > 0.9, `تشابه المعنى القريب ${near.bestScore} يجب أن يفوق ٠٫٩`);

  // الترتيب تنازلي، والمعنى المختلف تماماً أدنى بفارق واضح
  assert.equal(near.scores.length, 3);
  for (let i = 1; i < near.scores.length; i++) {
    assert.ok(near.scores[i - 1]! >= near.scores[i]!, 'النتائج يجب أن تكون مرتّبة تنازلياً');
  }
  const worst = near.scores[near.scores.length - 1]!;
  assert.ok(worst < 0.5, `المعنى الغريب ${worst} يجب أن يبقى بعيداً`);
  assert.ok(near.bestScore - worst > 0.5, 'الفرق بين المعنى نفسه والمعنى الغريب يجب أن يكون فاصلاً');

  // k أكبر من عدد الذكريات يُقصَر ولا يرمي
  assert.equal(h.recall(toVec(cat), 99, dotPort()).episodes.length, 3);
});

test('الحُصين: الاستدعاء من ذاكرة فارغة لا يرمي', async () => {
  const h = new Hippocampus();
  const empty = h.recall(toVec(randomMeaning(new Rng(1))), 5, dotPort());
  assert.equal(empty.best, null);
  assert.equal(empty.bestScore, 0);
  assert.deepEqual(empty.episodes, []);
  assert.deepEqual(empty.scores, []);

  const emptyFast = await h.recallFast(toVec(randomMeaning(new Rng(2))), 5, cosineAccelerator());
  assert.equal(emptyFast.best, null);
  assert.equal(emptyFast.bestScore, 0);

  // ذاكرة فارغة لا تُعيد شيئاً في النوم ولا تنسى شيئاً
  assert.deepEqual(h.replayBatch(5, new Rng(3)), []);
  assert.equal(h.annotate(1, 'شيء', 1), null);
});

test('الحُصين: المسرّع غير المتزامن يعطي ترتيب المنفذ نفسه', async () => {
  const rng = new Rng(0x5eed);
  const h = new Hippocampus(32);
  const meanings: number[][] = [];
  for (let i = 0; i < 12; i++) {
    const m = randomMeaning(rng);
    meanings.push(m);
    h.store(episodeOf(`درس ${i}`, m, 100 + i, 0));
  }

  const query = perturb(meanings[7]!, new Rng(0xfeed), 0.2);
  const slow = h.recall(query, 5, dotPort());
  const fast = await h.recallFast(query, 5, cosineAccelerator());

  assert.deepEqual(
    fast.episodes.map((e) => e.id),
    slow.episodes.map((e) => e.id),
    'ضرب داخلي وتشابه جيبي يجب أن يتساويا لأن المفاتيح مُسوّاة',
  );
  for (let i = 0; i < slow.scores.length; i++) {
    assert.ok(Math.abs(slow.scores[i]! - fast.scores[i]!) < 1e-5, 'الفرق بين الطريقين يجب أن يكون خطأ تقريب فقط');
  }
  assert.ok(fast.bestScore > 0.9, `تشابه المسرّع ${fast.bestScore}`);
});

test('الحُصين: annotate يثبّت حكم الأب في الذكرى الصحيحة وحدها', () => {
  const rng = new Rng(0xc0de);
  const h = new Hippocampus(16);
  const first = h.store(episodeOf('واحد', randomMeaning(rng), 5, 0));
  const middle = h.store(episodeOf('اثنان', randomMeaning(rng), 6, 0));
  const last = h.store(episodeOf('ثلاثة', randomMeaning(rng), 7, 0));

  const marked = h.annotate(6, 'قلتُ اثنان', -1);
  assert.equal(marked?.id, middle.id);
  assert.equal(marked?.reward, -1);
  assert.equal(marked?.replied, 'قلتُ اثنان');

  // الوسم يجب أن يظهر في الذاكرة نفسها لا في نسخة عابرة
  assert.equal(h.all[1]!.reward, -1);
  assert.equal(h.all[1]!.replied, 'قلتُ اثنان');
  // والذكريتان الأخريان لم تُلمسا
  assert.equal(h.all[0]!.reward, 0);
  assert.equal(h.all[0]!.replied, null);
  assert.equal(h.all[2]!.reward, 0);

  assert.equal(h.annotate(6, 'صححتُ', 1)?.id, middle.id);
  assert.equal(h.all[1]!.reward, 1);

  // نبضة لا ذكرى لها: null لا استثناء
  assert.equal(h.annotate(999, 'شيء', 1), null);
  assert.equal(first.id < middle.id && middle.id < last.id, true, 'الأرقام تتزايد بترتيب التعليم');
});

test('الحُصين: النوم يُعيد الخطأ أكثر من الصحيح', () => {
  // عشر ذكريات: الزوجية مكافأتها ‎-1 والفردية +1، والنبضات متزايدة بالترتيب،
  // فالحداثة تُحسب لصالح الموجبة (آخرها فردي) — أي أنها تعمل ضدّ ما نُثبته، وهذا
  // مقصود: لو نجح الاختبار رغم ذلك فالأولوية للخطأ حقيقية لا أثر ترتيب.
  const shares: number[] = [];
  for (const seed of [0x1, 0x22, 0x333, 0x4444, 0x55555]) {
    const rng = new Rng(0x9a9a + seed);
    const h = new Hippocampus(64);
    for (let i = 0; i < 10; i++) {
      h.store(episodeOf(`درس ${i}`, randomMeaning(rng), 200 + i, i % 2 === 0 ? -1 : 1));
    }

    const batch = h.replayBatch(20, new Rng(seed));
    assert.equal(batch.length, 20, 'عدد الإعادات المطلوب يجب أن يُسلَّم كاملاً');

    let negative = 0;
    for (const episode of batch) if (episode.reward < 0) negative++;
    const positive = batch.length - negative;
    assert.ok(negative > positive, `بذرة ${seed}: السلبية ${negative} يجب أن تفوق الموجبة ${positive}`);
    shares.push(negative / batch.length);

    // عدّاد الإعادات يجب أن يرتفع لكل ما أُعيد، ومجموعه يساوي حجم الدفعة
    let totalReplays = 0;
    let negativeReplays = 0;
    let positiveReplays = 0;
    for (const episode of h.all) {
      totalReplays += episode.replays;
      if (episode.reward < 0) negativeReplays += episode.replays;
      else positiveReplays += episode.replays;
    }
    assert.equal(totalReplays, 20);
    assert.ok(negativeReplays > positiveReplays, 'نصيب الخطأ من الإعادة يجب أن يكون أعلى');
  }

  // النصيب المتوسط للخطأ يجب أن يفوق النصف بفارق واضح لا بحدّ الصدفة
  assert.ok(mean(shares) > 0.6, `نصيب الخطأ المتوسط ${mean(shares).toFixed(3)} يجب أن يفوق ٠٫٦`);
});

test('الحُصين: النسيان يُبقي المكافأة القوية وينسى المحايد القديم', () => {
  const rng = new Rng(0xf0f0);
  const h = new Hippocampus(4);
  const meanings: number[][] = [];
  for (let i = 1; i <= 7; i++) {
    const m = randomMeaning(rng);
    meanings.push(m);
    // الأولى وحدها موسومة بمكافأة قوية وهي أقدم الكل: لو كان النسيان بالأقدمية
    // لذهبت أولاً، وهي بالضبط ما لا يجوز أن يُنسى
    h.store(episodeOf(`درس ${i}`, m, i, i === 1 ? 1 : 0));
    assert.ok(h.count <= 4, 'السعة لا تُتجاوز أبداً');
  }

  assert.equal(h.count, 4);
  assert.deepEqual(
    h.all.map((e) => e.id),
    [1, 5, 6, 7],
    'تبقى ذات المكافأة القوية والأحدث ثلاثاً، وتُنسى المحايدة القديمة',
  );

  // الاختبار الحقيقي للحذف: هل بقي تقابل الفهرس بين الذكريات وكتلة المفاتيح؟
  // لو انزلق المفتاح لصار الاستدعاء يُخرج ذكرى بمفتاح غيرها.
  const first = h.recall(toVec(meanings[0]!), 1, dotPort());
  assert.equal(first.best?.id, 1);
  assert.ok(first.bestScore > 0.999, `مفتاح الذكرى الباقية بعد ثلاث عمليات نسيان ${first.bestScore}`);
  const newest = h.recall(toVec(meanings[6]!), 1, dotPort());
  assert.equal(newest.best?.id, 7);
  assert.ok(newest.bestScore > 0.999);

  // ذكرى أُعيدت كثيراً في النوم تصير راسخة فلا تُنسى وإن كانت محايدة
  const persistent = new Hippocampus(3);
  persistent.store(episodeOf('محايدة مُعادة', randomMeaning(rng), 1, 0));
  persistent.store(episodeOf('محايدة عادية', randomMeaning(rng), 2, 0));
  persistent.store(episodeOf('محايدة أحدث', randomMeaning(rng), 3, 0));
  for (let i = 0; i < 5; i++) persistent.all[0]!.replays++;
  persistent.store(episodeOf('جديدة', randomMeaning(rng), 4, 0));
  assert.deepEqual(
    persistent.all.map((e) => e.id),
    [1, 3, 4],
    'الرسوخ بالإعادة يحمي الذكرى كما تحميها المكافأة',
  );
});

test('الحُصين: الحفظ والاستعادة يُبقيان الذاكرة، والحالة المعطوبة لا تُسقطها', () => {
  const rng = new Rng(0x1dea);
  const source = new Hippocampus(8);
  const meanings: number[][] = [];
  for (let i = 0; i < 5; i++) {
    const m = randomMeaning(rng);
    meanings.push(m);
    source.store(episodeOf(`درس ${i}`, m, 50 + i, 0));
  }
  source.annotate(52, 'جوابي', -1);

  const wire = JSON.parse(JSON.stringify(source.save())) as HippocampusState;
  const restored = new Hippocampus(8);
  restored.load(wire);

  assert.equal(restored.count, 5);
  assert.equal(restored.all[2]!.reward, -1);
  assert.equal(restored.all[2]!.replied, 'جوابي');
  const found = restored.recall(perturb(meanings[3]!, new Rng(0x2dea), 0.1), 3, dotPort());
  assert.equal(found.best?.id, source.all[3]!.id, 'المفاتيح تُبنى من المعنى عند الاستعادة');
  assert.ok(found.bestScore > 0.9, `تشابه بعد الاستعادة ${found.bestScore}`);

  // ذكرى جديدة بعد الاستعادة لا يجوز أن تُصادم رقم ذكرى محفوظة
  const fresh = restored.store(episodeOf('بعد الاستعادة', randomMeaning(rng), 60, 0));
  assert.ok(fresh.id > 5, `الرقم الجديد ${fresh.id} يجب أن يتجاوز أرقام المحفوظ`);

  // حالات معطوبة: كلها يجب أن تُتجاهل بصمت وتُبقي ما في الرأس
  const before = restored.count;
  restored.load({ capacity: 8, meaningDim: 7, nextId: 1, episodes: [] });
  assert.equal(restored.count, before, 'بُعد معنى مختلف يُرفض كله');
  restored.load({ capacity: 8, meaningDim: DIMS.meaning, nextId: 1, episodes: 'خربان' } as unknown as HippocampusState);
  assert.equal(restored.count, before, 'حقل ليس مصفوفة يُرفض');
  restored.load(null as unknown as HippocampusState);
  assert.equal(restored.count, before, 'حالة معدومة تُرفض');
  restored.load(undefined as unknown as HippocampusState);
  assert.equal(restored.count, before);

  // ذكرى واحدة بأبعاد غريبة تُترك وحدها لا تُسقط البقية
  const mixed = new Hippocampus(8);
  const half = JSON.parse(JSON.stringify(source.save())) as HippocampusState;
  // معنىً لا يُفكّ: ذكرى واحدة تسقط ولا تُسقط البقية
  half.episodes[1] = { ...half.episodes[1]!, m: '@@@' };
  mixed.load(half);
  assert.equal(mixed.count, 4, 'الذكرى المعطوبة وحدها تُتجاهل');
  assert.ok(!mixed.all.some((e) => e.id === source.all[1]!.id));

  // دماغ محفوظ بسعة أكبر يُقرأ في سعة أصغر فيُبقى الأحدث
  const narrow = new Hippocampus(3);
  narrow.load(JSON.parse(JSON.stringify(source.save())) as HippocampusState);
  assert.equal(narrow.count, 3);
  assert.deepEqual(
    narrow.all.map((e) => e.id),
    [3, 4, 5],
  );
  assert.equal(narrow.recall(toVec(meanings[4]!), 1, dotPort()).best?.id, 5);
});

/* ————— المهاد ————— */

test('المهاد: البوابة مفتوحة نسبياً عند الميلاد ولا تنهار على جملة فارغة', () => {
  const port = dotPort();
  const thalamus = new Thalamus(new Rng(0x7a1a));

  const silence = thalamus.gate(perceptOf([], []), baseIntero(), port);
  assert.deepEqual(silence.weights, [], 'جملة فارغة: أوزان فارغة');
  assert.equal(silence.bag.length, DIMS.word);
  assert.ok(allFinite(silence.bag), 'الحصيلة على الفراغ يجب أن تبقى منتهية');
  for (let d = 0; d < silence.bag.length; d++) assert.equal(silence.bag[d], 0);
  thalamus.reinforce(1); // تعزيز بلا بوابة سابقة: لا شيء ولا استثناء

  const percept = samplePercept(['بابا', 'قطة', 'حلوة'], new Rng(0x4242));
  const opened = thalamus.gate(percept, baseIntero(), port);
  assert.equal(opened.weights.length, 3);
  for (const w of opened.weights) {
    assert.ok(Number.isFinite(w));
    // الانحياز الموجب في b هو ما يضمن هذا: وليدٌ بوابته مغلقة لا يتعلّم شيئاً
    assert.ok(w > 0.5 && w < 1, `وزن الميلاد ${w} يجب أن يكون فوق النصف`);
  }
  assert.ok(allFinite(opened.bag));

  // تمثيلات أقل من الرموز (إدراك ناقص) لا تُقرأ ما بعد النهاية
  const short = thalamus.gate(perceptOf(['واحد', 'اثنان', 'ثلاثة'], [randomWordVec(new Rng(9))]), baseIntero(), port);
  assert.equal(short.weights.length, 1);
  assert.ok(allFinite(short.bag));
});

test('المهاد: الحصيلة متوسط موزون بأوزان البوابة بالضبط', () => {
  const port = dotPort();
  const thalamus = new Thalamus(new Rng(0x9001));
  const words = ['تفاحة', 'حمراء', 'على', 'الطاولة'];
  const wordRng = new Rng(0x3001);
  const vecs = words.map(() => randomWordVec(wordRng));
  const percept = perceptOf(words, vecs);

  const { weights, bag } = thalamus.gate(percept, baseIntero(), port);
  let total = 0;
  for (const w of weights) total += w;
  assert.ok(total > 0);

  for (let d = 0; d < DIMS.word; d++) {
    let expected = 0;
    for (let i = 0; i < words.length; i++) expected += weights[i]! * vecs[i]![d]!;
    expected /= total;
    assert.ok(Math.abs(bag[d]! - expected) < 1e-5, `البُعد ${d}: ${bag[d]} مقابل ${expected}`);
  }

  // أوزان متساوية معناها متوسط بسيط — حالة مرجعية تكشف أي خطأ في المقام
  const flat = vec(DIMS.word);
  for (let i = 0; i < words.length; i++) for (let d = 0; d < DIMS.word; d++) flat[d]! += vecs[i]![d]! / words.length;
  const spread = Math.max(...weights) - Math.min(...weights);
  if (spread < 1e-6) {
    for (let d = 0; d < DIMS.word; d++) assert.ok(Math.abs(bag[d]! - flat[d]!) < 1e-5);
  }
  assert.ok(allFinite(bag));
});

test('المهاد: التعزيز الموجب يرفع الانتباه لنفس الكلمات، والسالب يخفضه', () => {
  const port = dotPort();
  const intero = baseIntero();
  const wordRng = new Rng(0x777);
  const words = ['تفاحة', 'حمراء'];
  const percept = perceptOf(words, words.map(() => randomWordVec(wordRng)));

  const praised = new Thalamus(new Rng(0x1111));
  const before = mean(praised.gate(percept, intero, port).weights);
  for (let i = 0; i < 40; i++) {
    praised.gate(percept, intero, port);
    praised.reinforce(1);
  }
  const afterPraise = mean(praised.gate(percept, intero, port).weights);
  assert.ok(
    afterPraise > before + 0.1,
    `المدح المتكرّر: الانتباه ${before.toFixed(4)} ← ${afterPraise.toFixed(4)}`,
  );
  assert.ok(afterPraise <= 1);

  // نفس البذرة كي يكون رقم «قبل» واحداً في الاتجاهين: الفرق أثر الحكم لا أثر التهيئة
  const scolded = new Thalamus(new Rng(0x1111));
  const beforeScold = mean(scolded.gate(percept, intero, port).weights);
  assert.ok(Math.abs(beforeScold - before) < 1e-9, 'التهيئة نفسها بنفس البذرة');
  for (let i = 0; i < 40; i++) {
    scolded.gate(percept, intero, port);
    scolded.reinforce(-1);
  }
  const afterScold = mean(scolded.gate(percept, intero, port).weights);
  assert.ok(
    afterScold < beforeScold - 0.1,
    `الخطأ المتكرّر: الانتباه ${beforeScold.toFixed(4)} ← ${afterScold.toFixed(4)}`,
  );
  assert.ok(afterScold >= 0);

  // مدحٌ كلُّه مدح يرفع البوابة على كل كلمة، وهذا هو الصواب لا عيب فيه: المكافأة
  // إشارة على الدور كله لا على كلمة بعينها، فلا يوجد في بيانات كلها موجبة ما
  // يُميّز كلمة عن أخرى. التمييز لا يمكن أن يُتعلَّم إلا من تعارض، ولذلك يُختبر
  // في الاختبار التالي لا هنا.
  const other = samplePercept(['مطر', 'بارد'], new Rng(0xabc));
  assert.ok(mean(praised.gate(other, intero, port).weights) > mean(new Thalamus(new Rng(0x1111)).gate(other, intero, port).weights));
});

test('المهاد: البوابة تُميّز — كلمات المدح ترتفع فوق كلمات الخطأ', () => {
  const port = dotPort();
  const intero = baseIntero();
  // جملتان مختلفتا الكلمات: إحداهما يُمدح عليها دائماً والأخرى يُخطَّأ عليها دائماً.
  // هذا هو التعارض الذي يجعل الانتباه انتقائياً بدل أن يكون مجرّد فتحٍ عام.
  const wordRng = new Rng(0x901);
  const good = perceptOf(['بابا', 'حبيبي'], [randomWordVec(wordRng), randomWordVec(wordRng)]);
  const bad = perceptOf(['بلا', 'معنى'], [randomWordVec(wordRng), randomWordVec(wordRng)]);

  const thalamus = new Thalamus(new Rng(0x5150));
  const goodBefore = mean(thalamus.gate(good, intero, port).weights);
  const badBefore = mean(thalamus.gate(bad, intero, port).weights);
  const gapBefore = goodBefore - badBefore;

  for (let i = 0; i < 60; i++) {
    thalamus.gate(good, intero, port);
    thalamus.reinforce(1);
    thalamus.gate(bad, intero, port);
    thalamus.reinforce(-1);
  }

  const goodAfter = mean(thalamus.gate(good, intero, port).weights);
  const badAfter = mean(thalamus.gate(bad, intero, port).weights);
  const gapAfter = goodAfter - badAfter;

  assert.ok(goodAfter > badAfter, `${goodAfter.toFixed(4)} يجب أن يفوق ${badAfter.toFixed(4)}`);
  assert.ok(
    gapAfter > gapBefore + 0.3,
    `فرق الانتباه بين المدح والخطأ: ${gapBefore.toFixed(4)} ← ${gapAfter.toFixed(4)}`,
  );
  assert.ok(goodAfter > goodBefore, 'كلمات المدح ترتفع');
  assert.ok(badAfter < badBefore, 'كلمات الخطأ تنخفض');
  // الانحياز المشترك بقي متوازناً لأن المدح والخطأ تساويا عدداً: ما تعلّمته
  // البوابة هو التمييز نفسه لا فتحٌ عام ولا إغلاق عام
  assert.ok(Math.abs(goodAfter + badAfter - (goodBefore + badBefore)) < gapAfter);
});

test('المهاد: قيم غير منتهية في التمثيلات لا تُنتج NaN في الحصيلة', () => {
  const port = dotPort();
  const thalamus = new Thalamus(new Rng(0x2222));

  const poisoned = vec(DIMS.word);
  poisoned.fill(0.1);
  poisoned[0] = NaN;
  poisoned[1] = Infinity;
  poisoned[2] = -Infinity;
  const zeroed = vec(DIMS.word);
  const percept = perceptOf(['مسموم', 'صفري', 'سليم'], [poisoned, zeroed, randomWordVec(new Rng(0x3333))]);

  const gated = thalamus.gate(percept, baseIntero(), port);
  assert.equal(gated.weights.length, 3);
  for (const w of gated.weights) assert.ok(Number.isFinite(w) && w >= 0 && w <= 1, `وزن ${w}`);
  assert.ok(allFinite(gated.bag), 'الحصيلة يجب أن تخلو من NaN مهما كان الدخل');

  // حالة داخلية معطوبة كذلك: البوابة تُقصّ لا تنفجر
  const brokenIntero: Interoception = {
    arousal: NaN,
    fatigue: Infinity,
    curiosity: -5,
    attachment: 12,
    boredom: -Infinity,
    confidence: 0.5,
  };
  const survived = thalamus.gate(percept, brokenIntero, port);
  for (const w of survived.weights) assert.ok(Number.isFinite(w));
  assert.ok(allFinite(survived.bag));

  // ثم تعزيز فوق هذا كله لا يجوز أن يفسد الأوزان
  thalamus.reinforce(-1);
  thalamus.reinforce(NaN);
  thalamus.reinforce(1);
  const after = thalamus.gate(percept, baseIntero(), port);
  for (const w of after.weights) assert.ok(Number.isFinite(w));
  assert.ok(allFinite(after.bag));
});

test('المهاد: الحفظ والاستعادة يُبقيان ما تعلّمته البوابة، والمعطوب لا يُسقطها', () => {
  const port = dotPort();
  const intero = baseIntero();
  const percept = samplePercept(['علّمني', 'أكثر'], new Rng(0x51));

  const trained = new Thalamus(new Rng(0x6161));
  for (let i = 0; i < 30; i++) {
    trained.gate(percept, intero, port);
    trained.reinforce(1);
  }
  const learned = mean(trained.gate(percept, intero, port).weights);

  const wire = JSON.parse(JSON.stringify(trained.save())) as ThalamusState;
  // بذرة مختلفة كي يكون التشابه بعد الاستعادة أثر الحالة المحفوظة لا أثر التهيئة
  const revived = new Thalamus(new Rng(0xdead));
  const naive = mean(revived.gate(percept, intero, port).weights);
  revived.load(wire);
  const restored = mean(revived.gate(percept, intero, port).weights);
  assert.ok(Math.abs(restored - learned) < 1e-6, `${restored} مقابل ${learned}`);
  assert.ok(Math.abs(restored - naive) > 1e-6, 'الاستعادة يجب أن تغيّر شيئاً فعلاً');

  const corrupt: ThalamusState[] = [
    { inDim: 3, gate: wire.gate },
    { inDim: GATE_IN, gate: { ...wire.gate, inDim: 3 } },
    { inDim: GATE_IN, gate: { ...wire.gate, w: [1, 2, 3] } },
    { inDim: GATE_IN, gate: { ...wire.gate, w: new Array<number>(GATE_IN + 5).fill(0.1) } },
    { inDim: GATE_IN, gate: { ...wire.gate, w: new Array<number>(GATE_IN).fill(NaN) } },
    { inDim: GATE_IN, gate: { ...wire.gate, b: [] } },
    { inDim: GATE_IN, gate: { ...wire.gate, mW: [0] } },
    { inDim: GATE_IN, gate: { ...wire.gate, steps: NaN } },
    null as unknown as ThalamusState,
    { inDim: GATE_IN } as unknown as ThalamusState,
  ];
  for (const state of corrupt) {
    revived.load(state);
    const survived = mean(revived.gate(percept, intero, port).weights);
    assert.ok(Math.abs(survived - learned) < 1e-6, 'الحالة المعطوبة لا يجوز أن تُغيّر البوابة ولا أن ترمي');
  }
});

/** معنىً مصطنعٌ ثابتٌ بطول العقد — لا عشوائيةَ فيه فتتكرّر النتيجة. */
function meaningOf(n: number): number[] {
  return Array.from({ length: DIMS.meaning }, (_, i) => Math.sin(n + i) * 0.1);
}

/* ————— الطبقة التي لا تُنسى —————
 *
 * كان النسيان يُقيَّم بـ«المكافأة + الإعادات + الحداثة» ويُنسى الأدنى، وذاك
 * بعينه ما يحذف **النادرَ المهمّ**: درسٌ قيل مرّةً، لم يُسأل عنه فلم يُحكَم
 * عليه، ولم يُعَد في نومٍ لأنه لم يُذكر — فقيمتُه أدنى ما في الحُصين، وهو قد
 * يكون اسم أمّه.
 */

test('ما حكم عليه الأب لا يُنسى ولو أغرقته آلافُ الذكريات', () => {
  const hippocampus = new Hippocampus(10);
  hippocampus.store({
    said: 'أمي اسمها فاطمة', tokens: [], meaning: meaningOf(1), intent: 'TEACH_FACT',
    subject: 'امي', object: 'فاطمه', relation: 'جنس', replied: null, reward: 1, tick: 1,
  });
  for (let i = 0; i < 40; i++) {
    hippocampus.store({
      said: `كلام ${i}`, tokens: [], meaning: meaningOf(i + 10), intent: 'CHITCHAT',
      subject: null, object: null, relation: null, replied: null, reward: 0, tick: 10 + i,
    });
  }
  assert.equal(hippocampus.count, 10);
  assert.ok(
    hippocampus.all.some((e) => e.said.includes('فاطمة')),
    'نُسي أوّلُ ما حُكم عليه — وهو النادرُ المهمّ بعينه',
  );
  assert.equal(hippocampus.protectedCount, 1);
});

test('وما رسخ بالتثبيت يُرقّى فوق النسيان', () => {
  const hippocampus = new Hippocampus(6);
  const rare = hippocampus.store({
    said: 'الزقفوط نبات', tokens: [], meaning: meaningOf(2), intent: 'TEACH_FACT',
    subject: 'زقفوط', object: 'نبات', relation: 'جنس', replied: null, reward: 0, tick: 1,
  });
  // ثلاث إعاداتٍ في النوم تُصيّرها معرفةً لا حادثة
  rare.replays = 3;
  for (let i = 0; i < 20; i++) {
    hippocampus.store({
      said: `كلام ${i}`, tokens: [], meaning: meaningOf(i + 30), intent: 'CHITCHAT',
      subject: null, object: null, relation: null, replied: null, reward: 0, tick: 5 + i,
    });
  }
  assert.ok(hippocampus.all.some((e) => e.said.includes('الزقفوط')));
});

test('ولا يمتنع عن التعلّم لو امتلأ بالمحميّ', () => {
  const hippocampus = new Hippocampus(4);
  for (let i = 0; i < 12; i++) {
    hippocampus.store({
      said: `درس ${i}`, tokens: [], meaning: meaningOf(i), intent: 'TEACH_FACT',
      subject: null, object: null, relation: null, replied: null, reward: 1, tick: i,
    });
  }
  /* دماغٌ يرفض أن يتعلّم لأن ذاكرته امتلأت بالمحميّ أسوأ من دماغٍ ينسى أقدم
   * ما حُمي: فالأقدم يسقط، ويبقى الأحدث. */
  assert.equal(hippocampus.count, 4);
  assert.ok(hippocampus.all.some((e) => e.said === 'درس 11'));
});

/* ————— حجمُ ما يُكتب على الجهاز —————
 *
 * التطبيق يحفظ الدماغ كاملاً **بعد كل درس**، لأن جوالاً يُقفل فجأةً لا ينتظر
 * إذناً. فحجمُ الملف كلفةٌ تُدفع في كل جملة لا مرّةً عند الإغلاق. وكانت
 * الأوزان تُكتب نصّاً عشرياً كامل الدقّة: عشرون حرفاً لعددٍ هو أربعة بايتات.
 */

test('الأوزان تُكتب بايتاتٍ لا نصّاً عشرياً', () => {
  const hippocampus = new Hippocampus(50);
  for (let i = 0; i < 50; i++) {
    hippocampus.store({
      said: `الزقفوط${i} حيوان`, tokens: [], meaning: meaningOf(i), intent: 'TEACH_FACT',
      subject: `زقفوط${i}`, object: 'حيوان', relation: 'جنس', replied: null, reward: 0, tick: i,
    });
  }
  const bytes = JSON.stringify(hippocampus.save()).length / 50;
  /* قِيس قبل الضغط: ١٣٠٠ بايتاً للذكرى — أي أن سعة ١٦٣٨٤ تعني عشرين ميغابايت */
  assert.ok(bytes < 700, `الذكرى ${Math.round(bytes)} بايتاً على الجهاز`);
});

test('والدماغ المحفوظ بالصورة القديمة يُقرأ ولا يُفقَد', () => {
  const source = new Hippocampus(8);
  source.store({
    said: 'القطة حيوان', tokens: ['القطه', 'حيوان'], meaning: meaningOf(3), intent: 'TEACH_FACT',
    subject: 'قطه', object: 'حيوان', relation: 'جنس', replied: null, reward: 0, tick: 1,
  });
  /* صورةُ ما قبل الضغط: مصفوفةُ أرقامٍ باسم `meaning` لا حروفٌ باسم `m` */
  const legacy = JSON.parse(JSON.stringify(source.save())) as unknown as {
    episodes: Array<Record<string, unknown>>; capacity: number; meaningDim: number; nextId: number;
  };
  legacy.episodes[0] = {
    ...legacy.episodes[0]!,
    m: undefined,
    meaning: Array.from(meaningOf(3)),
    tokens: ['القطه', 'حيوان'],
  };
  const revived = new Hippocampus(8);
  revived.load(legacy as never);
  assert.equal(revived.count, 1, 'ضاع دماغٌ قديم لأن صيغة الحفظ تغيّرت');
  assert.equal(revived.all[0]?.said, 'القطة حيوان');
});
