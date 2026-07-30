/* ————— اختبار الحاسّة ومنطقة شكل الكلمة —————
 *
 * كل اختبار هنا يقيس وظيفة لا وجود دالّة: التطبيع يُقاس بأن صورتين لكلمة
 * واحدة تصيران سلسلة واحدة، وشكل الكلمة يُقاس برقمَي تشابه مرتَّبين، والمعجم
 * يُقاس بعدّاد يرتفع وحجم لا ينمو بالتكرار، والاستعادة تُقاس بتطابق التمثيل
 * عدداً عدداً بعد أن يمرّ على JSON.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  Lexicon,
  hashCharFeatures,
  normalizeArabic,
  tokenize,
  type LexiconState,
} from '../core/text.js';
import { cosine, vec } from '../core/tensor.js';
import { DIMS } from '../core/types.js';

/* البُعد مكتوب `number` لا مستنبطاً: DIMS ثابت `as const` فيصير النوع المستنبط
 * العدد ٤٨ حرفياً، ولا يقبل ٦٤ عند القياس ببُعد ملامح الحروف. */

/** ملامح كلمة في بُعد المعجم — مختصر يتكرّر في كل اختبارات الشكل. */
function features(word: string, dim: number = DIMS.word) {
  return hashCharFeatures(word, vec(dim));
}

function similarity(a: string, b: string, dim: number = DIMS.word): number {
  return cosine(features(a, dim), features(b, dim));
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, x) => sum + x, 0) / values.length;
}

/* ————— التطبيع ————— */

test('التطبيع يوحّد صور الكلمة الواحدة', () => {
  // الألفات: أب يكتب على جوال لا يضع الهمزات نصف الوقت
  assert.equal(normalizeArabic('أسد'), 'اسد');
  assert.equal(normalizeArabic('آسد'), 'اسد');
  assert.equal(normalizeArabic('إسد'), 'اسد');
  assert.equal(normalizeArabic('ٱسد'), 'اسد');
  assert.equal(normalizeArabic('أسد'), normalizeArabic('اسد'));

  // التاء المربوطة والياء المقصورة
  assert.equal(normalizeArabic('مدرسة'), normalizeArabic('مدرسه'));
  assert.equal(normalizeArabic('مدرسة'), 'مدرسه');
  assert.equal(normalizeArabic('على'), normalizeArabic('علي'));

  // المدّ العاطفي: «سلاااام» و«سلاام» انفعال واحد لا كلمتان
  assert.equal(normalizeArabic('سلاااام'), normalizeArabic('سلاام'));
  assert.equal(normalizeArabic('سلاااام'), 'سلاام');
  assert.equal(normalizeArabic('حلوووو'), 'حلوو');
  // ولا يُقلَّص إلى حرف واحد: «مد» و«مدّ» يجب أن يبقيا مختلفين
  assert.equal(normalizeArabic('مدّ'), 'مد');

  // التشكيل والتطويل
  assert.equal(normalizeArabic('سَلَامٌ عَلَيْكُمْ'), 'سلام عليكم');
  assert.equal(normalizeArabic('قِطَّة'), 'قطه');
  assert.equal(normalizeArabic('ســلام'), 'سلام');

  // الأرقام: تُوحَّد ولا تُقلَّص، فـ«333» عدد لا مدّ
  assert.equal(normalizeArabic('٢٠٢٤'), '2024');
  assert.equal(normalizeArabic('۵'), '5');
  assert.equal(normalizeArabic('3333'), '3333');
  assert.equal(normalizeArabic('٣٣٣٣'), '3333');

  // المسافات والحدود
  assert.equal(normalizeArabic('  مرحبا   بك '), 'مرحبا بك');
  assert.equal(normalizeArabic(''), '');

  // ثبات: التطبيع المكرّر لا يغيّر شيئاً، وهذا شرط أن تكون مفاتيح المعجم مستقرّة
  for (const sample of ['أسد', 'مدرسة', 'سلاااام', 'سَلَامٌ عَلَيْكُمْ', '٢٠٢٤']) {
    const once = normalizeArabic(sample);
    assert.equal(normalizeArabic(once), once);
  }
});

/* ————— التجزئة ————— */

test('الترميز يعالج جملة عربية فيها ترقيم وأرقام هندية', () => {
  assert.deepEqual(
    tokenize('ما هذا؟ عندي ٣ تفاحات، وكتاب واحد.'),
    ['ما', 'هذا', 'عندي', '3', 'تفاحات', 'وكتاب', 'واحد'],
  );

  assert.deepEqual(
    tokenize('قال لي: «القطة حيوان» — ثم صمت!'),
    ['قال', 'لي', 'القطه', 'حيوان', 'ثم', 'صمت'],
  );

  assert.deepEqual(tokenize("ابن-عمي 'كتاب' (جديد)"), ['ابن', 'عمي', 'كتاب', 'جديد']);
  assert.deepEqual(tokenize('الساعة ١٢:٣٠ صباحاً'), ['الساعه', '12', '30', 'صباحا']);

  // أدوات الاستفهام وحروف الجرّ محفوظة: هي حاملة القصد، وحذفها يمحو السؤال
  assert.deepEqual(tokenize('من أين أنت؟'), ['من', 'اين', 'انت']);
  assert.deepEqual(tokenize('هل هذا لي أم لك؟'), ['هل', 'هذا', 'لي', 'ام', 'لك']);

  // ترقيم محض لا يُنتج رموزاً فارغة
  assert.deepEqual(tokenize('؟؟؟ !!!'), []);
  assert.deepEqual(tokenize('   '), []);
  assert.deepEqual(tokenize(''), []);
});

/* ————— شكل الكلمة ————— */

test('ملامح الحروف تُقرّب الجذر الواحد وتُبعد ما لا يشترك في شيء', () => {
  const root = similarity('يكتب', 'كاتب');
  const stranger = similarity('يكتب', 'برتقال');

  // الرقمان مقيسان لا مفترضان: انظر رسالة الفشل لو تغيّر الهاش
  assert.ok(root > 0.4, `شبه الجذر الواحد ضعيف: ${root.toFixed(3)}`);
  assert.ok(
    root > stranger + 0.2,
    `الترتيب انقلب: يكتب/كاتب=${root.toFixed(3)} ويكتب/برتقال=${stranger.toFixed(3)}`,
  );

  // القياس على مجموعتين لا على زوج واحد: الهاش في ٤٨ بُعداً يُصيب زوجاً
  // بالمصادفة، فالحكم على المتوسط
  const rootPairs: Array<[string, string]> = [
    ['يكتب', 'كاتب'],
    ['كتب', 'مكتوب'],
    ['يلعب', 'لاعب'],
    ['مدرسه', 'يدرس'],
    ['يشرب', 'شارب'],
  ];
  const strangerPairs: Array<[string, string]> = [
    ['يكتب', 'برتقال'],
    ['يكتب', 'شمس'],
    ['كاتب', 'قمر'],
    ['يلعب', 'تفاحه'],
    ['مدرسه', 'سياره'],
    ['يشرب', 'جبل'],
    ['كتب', 'زهره'],
  ];
  const rootMean = mean(rootPairs.map(([a, b]) => similarity(a, b)));
  const strangerMean = mean(strangerPairs.map(([a, b]) => similarity(a, b)));
  assert.ok(
    rootMean > strangerMean + 0.25,
    `الفصل بين المجموعتين ضعيف: أقارب=${rootMean.toFixed(3)} وغرباء=${strangerMean.toFixed(3)}`,
  );

  // وفي ٦٤ بُعداً (DIMS.charFeatures) يجب أن يبقى الترتيب نفسه
  const rootWide = mean(rootPairs.map(([a, b]) => similarity(a, b, DIMS.charFeatures)));
  const strangerWide = mean(strangerPairs.map(([a, b]) => similarity(a, b, DIMS.charFeatures)));
  assert.ok(
    rootWide > strangerWide + 0.25,
    `الفصل في ٦٤ بُعداً ضعيف: ${rootWide.toFixed(3)} مقابل ${strangerWide.toFixed(3)}`,
  );
});

test('ملامح الحروف ثابتة ومسوّاة الطول ولا تنفجر على الحدود', () => {
  const a = features('كتاب');
  const b = features('كتاب');
  assert.deepEqual(Array.from(a), Array.from(b));
  assert.equal(cosine(a, features('كتاب')), 1);

  // الطول واحد كي لا يصير التشابه دالّة على طول الكلمة
  const length = Math.sqrt(Array.from(a).reduce((sum, x) => sum + x * x, 0));
  assert.ok(Math.abs(length - 1) < 1e-5, `الطول ليس واحداً: ${length}`);

  // الكلمة الفارغة والأبعاد الصغيرة والمتجه الصفري: لا استثناء ولا NaN
  const empty = features('');
  assert.ok(Array.from(empty).every((x) => x === 0));
  const tiny = hashCharFeatures('كتاب', vec(4));
  assert.ok(Array.from(tiny).every((x) => Number.isFinite(x)));
  const nothing = hashCharFeatures('كتاب', vec(0));
  assert.equal(nothing.length, 0);
  // التطبيع يسبق التجزيء: «كتاب» و«كِتَاب» شكل واحد
  assert.equal(cosine(features('كتاب'), features('كِتَاب')), 1);
});

/* ————— المعجم ————— */

test('المعجم ينمو بالكلمة الجديدة ولا ينمو بتكرارها والعدّاد يرتفع', () => {
  const lexicon = new Lexicon();
  assert.equal(lexicon.size, 0);

  const first = lexicon.perceive('القطة حيوان لطيف', true);
  assert.deepEqual(first.tokens, ['القطه', 'حيوان', 'لطيف']);
  assert.equal(lexicon.size, 3);
  assert.deepEqual(first.unknown, ['القطه', 'حيوان', 'لطيف']);
  assert.ok(first.ids.every((id) => id >= 0));
  assert.equal(lexicon.countOf('القطة'), 1);

  const sizeAfterFirst = lexicon.size;
  const second = lexicon.perceive('القطة حيوان لطيف', true);
  // لا نموّ بالتكرار: نفس الأرقام ونفس الحجم
  assert.equal(lexicon.size, sizeAfterFirst);
  assert.deepEqual(second.ids, first.ids);
  assert.deepEqual(second.unknown, []);
  // والعدّاد يرتفع: هذا هو الرقم الذي يُثبت أنه «سمعها مرّتين»
  assert.equal(lexicon.countOf('القطة'), 2);
  assert.equal(lexicon.countOf('القطه'), 2);
  assert.equal(lexicon.countOf('لطيف'), 2);
  assert.equal(lexicon.countOf('برتقال'), 0);

  // كلمة واحدة جديدة تزيد الحجم واحداً لا أكثر
  lexicon.perceive('القطة تشرب', true);
  assert.equal(lexicon.size, sizeAfterFirst + 1);
  assert.equal(lexicon.countOf('القطة'), 3);

  // learn المتكرّر لا يخلق صفّاً ثانياً
  const id = lexicon.learn('حيوان');
  assert.equal(id, lexicon.idOf('حيوان'));
  assert.equal(lexicon.size, sizeAfterFirst + 1);

  // الرقم والكلمة عكس بعضهما، وما خرج عن المدى يعيد null لا استثناء
  assert.equal(lexicon.wordOf(lexicon.idOf('حيوان')), 'حيوان');
  assert.equal(lexicon.wordOf(9999), null);
  assert.equal(lexicon.wordOf(-1), null);
  assert.equal(lexicon.idOf('كلمة لم تُقل'), -1);
  assert.equal(lexicon.idOf(''), -1);

  // كلمة يعرفها يجب أن تُوجد ولو وصلت ملتصقة بترقيم أو محفوفة بمسافات: مفاتيح
  // الخريطة كلها من المجزِّئ، فطريق البحث هو طريق التخزين نفسه
  assert.equal(lexicon.idOf('  حيوان!  '), lexicon.idOf('حيوان'));
  assert.equal(lexicon.idOf('«القطة»'), lexicon.idOf('القطه'));
  assert.equal(lexicon.countOf('حيوان؟'), lexicon.countOf('حيوان'));

  // ما ليس كلمة لا يشغل صفّاً في المعجم
  const sizeBefore = lexicon.size;
  assert.equal(lexicon.learn('؟'), -1);
  assert.equal(lexicon.learn('   '), -1);
  assert.equal(lexicon.learn(''), -1);
  assert.equal(lexicon.size, sizeBefore);
});

test('learnNew=false لا يسرّب شيئاً إلى المعجم', () => {
  const lexicon = new Lexicon();
  lexicon.perceive('القطة حيوان', true);
  const sizeBefore = lexicon.size;
  const countBefore = lexicon.countOf('حيوان');

  const evaluation = lexicon.perceive('الكلب حيوان', false);
  assert.equal(lexicon.size, sizeBefore, 'التقييم نمّى المعجم فصار يقيس الحفظ');
  assert.equal(lexicon.countOf('حيوان'), countBefore, 'التقييم رفع العدّاد');
  assert.equal(lexicon.countOf('الكلب'), 0);
  assert.deepEqual(evaluation.unknown, ['الكلب']);
  assert.deepEqual(evaluation.ids, [-1, lexicon.idOf('حيوان')]);

  // المجهول يُمثَّل بشكل حروفه: هذا كل ما يملكه عنه
  const unknownVec = evaluation.tokenVecs[0]!;
  assert.equal(unknownVec.length, DIMS.word);
  assert.ok(cosine(unknownVec, features('الكلب')) > 0.999);

  // والمعروف يُمثَّل بتمثيله المتعلَّم
  const knownVec = evaluation.tokenVecs[1]!;
  const row = lexicon.embedding.get(lexicon.idOf('حيوان'));
  assert.ok(cosine(knownVec, row) > 0.999);
  // نسخة لا الصفّ نفسه: فصٌّ متهوّر لا يجوز أن يُتلف ذاكرة كلمة
  knownVec[0] = 12345;
  assert.notEqual(row[0], 12345);

  // حصيلة الحروف متوسط لا مجموع
  const two = lexicon.perceive('برتقال وزيتون', false);
  assert.equal(two.unknown.length, 2);
  const expected = vec(DIMS.word);
  for (const word of two.unknown) {
    const f = features(word);
    for (let i = 0; i < expected.length; i++) expected[i]! += f[i]! / two.unknown.length;
  }
  assert.ok(cosine(two.charBag, expected) > 0.999);
});

test('علامة الاستفهام وأدواتها تُميّز السؤال من الخبر', () => {
  const lexicon = new Lexicon();
  const asks = (text: string) => lexicon.perceive(text, false).isQuestion;

  assert.equal(asks('شو هذا؟'), true);
  assert.equal(asks('شو هذا'), true);
  assert.equal(asks('ما معنى قطة'), true);
  assert.equal(asks('ماذا تفعل'), true);
  assert.equal(asks('مين علّمك'), true);
  assert.equal(asks('كيف حالك'), true);
  assert.equal(asks('ليش زعلان'), true);
  assert.equal(asks('لماذا صمت'), true);
  assert.equal(asks('هل تعرفني'), true);
  assert.equal(asks('أين أبي'), true);
  assert.equal(asks('وين رحت'), true);
  assert.equal(asks('متى تنام'), true);
  assert.equal(asks('كم عمرك'), true);
  assert.equal(asks('من علّمك هذا'), true);
  assert.equal(asks('this is a question?'), true);

  // خبر محض
  assert.equal(asks('القطة حيوان'), false);
  assert.equal(asks('أحسنت يا زبير'), false);
  // «من» و«ما» و«كم» بعد الرمز الأول جرٌّ ونفيٌ وخبرٌ لا استفهام: بلا هذا
  // القيد يصير أكثر كلام الأب سؤالاً فيجيب زبير حيث كان يجب أن يتعلّم
  assert.equal(asks('خرجت من البيت'), false);
  assert.equal(asks('أعطيتك كم قلم'), false);
  assert.equal(asks('أنا ما بعرف'), false);
});

test('topWords يُظهر أكثر ما يقوله الأب بترتيب ثابت', () => {
  const lexicon = new Lexicon();
  lexicon.perceive('القطة حيوان', true);
  lexicon.perceive('القطة تشرب حليب', true);
  lexicon.perceive('القطة نائمة', true);
  lexicon.perceive('حليب بارد', true);

  const top = lexicon.topWords(3);
  assert.equal(top.length, 3);
  assert.deepEqual(top[0], { word: 'القطه', count: 3 });
  assert.deepEqual(top[1], { word: 'حليب', count: 2 });
  // التساوي يُفكّ بالأقدم تعلّماً: «حيوان» قبل «تشرب»
  assert.equal(top[2]!.word, 'حيوان');
  assert.equal(top[2]!.count, 1);

  assert.deepEqual(lexicon.topWords(0), []);
  assert.equal(lexicon.topWords(100).length, lexicon.size);

  // كلمة تُعلَّم بلا أن تُسمع في جملة ليست من كلامه
  lexicon.learn('عصفور');
  assert.ok(lexicon.topWords(100).every((entry) => entry.count > 0));
  assert.equal(lexicon.topWords(100).length, lexicon.size - 1);
});

test('التمثيل الابتدائي يحمل تخميناً صرفياً فيبدأ الغريب قريباً من شبيهه', () => {
  const lexicon = new Lexicon();
  for (const word of ['يكتب', 'كاتب', 'برتقال']) lexicon.learn(word);
  const row = (word: string) => lexicon.embedding.get(lexicon.idOf(word));

  const near = cosine(row('يكتب'), row('كاتب'));
  const far = cosine(row('يكتب'), row('برتقال'));
  assert.ok(
    near > far + 0.2,
    `التمثيل الابتدائي بلا بنية صرفية: قريب=${near.toFixed(3)} بعيد=${far.toFixed(3)}`,
  );
  // ومع ذلك ليس تمثيلاً واحداً: كلمتان متشابهتان شكلاً تبقيان مميَّزتين
  assert.ok(near < 0.999);
});

/* ————— الحفظ والاستعادة ————— */

test('save/load يعيد المعجم كما كان بعد مروره على JSON', () => {
  const original = new Lexicon();
  original.perceive('القطة حيوان لطيف', true);
  original.perceive('القطة تشرب حليب', true);
  original.perceive('حليب بارد', true);

  const state = original.save();
  // يجب أن تكون الحالة JSON عادية لا Float32Array: هذا شرط عقد التوصيل
  const roundTripped = JSON.parse(JSON.stringify(state)) as LexiconState;

  const restored = new Lexicon();
  restored.load(roundTripped);

  assert.equal(restored.size, original.size);
  assert.deepEqual(restored.words(), original.words());

  for (const word of original.words()) {
    const id = original.idOf(word);
    assert.equal(restored.idOf(word), id, `تغيّر رقم «${word}» بعد الاستعادة`);
    assert.equal(restored.wordOf(id), word);
    assert.equal(restored.countOf(word), original.countOf(word), `تغيّر عدّاد «${word}»`);
    // التمثيل عدداً عدداً: تقارب ليس كافياً هنا، فالحفظ يجب أن يكون أميناً
    assert.deepEqual(
      Array.from(restored.embedding.get(id)),
      Array.from(original.embedding.get(id)),
      `تغيّر تمثيل «${word}»`,
    );
  }

  assert.deepEqual(restored.topWords(5), original.topWords(5));

  // ومعجم مستعاد يعمل: كلمة معروفة تُدرَك معروفة، وجديدة تنمو من حيث توقّف
  const percept = restored.perceive('القطة حيوان', true);
  assert.deepEqual(percept.ids, [original.idOf('القطه'), original.idOf('حيوان')]);
  assert.equal(restored.countOf('القطة'), original.countOf('القطة') + 1);
  const grown = restored.learn('عصفور');
  assert.equal(grown, original.size);
  assert.equal(restored.wordOf(grown), 'عصفور');
});

test('load لا يثق بمدخله ولا يرمي استثناءً بحال', () => {
  const seed = new Lexicon();
  seed.perceive('القطة حيوان', true);
  const good = seed.save();
  const knownId = seed.idOf('القطه');

  // كل واحدة من هذه حالة عطبة قد تصل من ملف قديم على جهاز الأب
  const broken: unknown[] = [
    null,
    undefined,
    'نصّ لا كائن',
    42,
    [],
    {},
    { dim: 999, words: [], counts: [], embedding: { dim: 999, rows: [], moments: [] } },
    { dim: DIMS.word, words: 'ليست مصفوفة', counts: [], embedding: good.embedding },
    { dim: DIMS.word, words: ['القطه'], counts: [1] },
    { dim: DIMS.word, words: ['القطه'], counts: [1], embedding: null },
    // كلمات أكثر من التمثيلات: لا نعرف أي صفّ لأي كلمة
    { dim: DIMS.word, words: ['القطه', 'حيوان'], counts: [1, 1], embedding: good.embedding },
    // صفّ بطول خاطئ
    { dim: DIMS.word, words: ['القطه'], counts: [1], embedding: { dim: DIMS.word, rows: [[1, 2, 3]], moments: [] } },
    // كلمات ليست نصوصاً
    { dim: DIMS.word, words: [7], counts: [1], embedding: { dim: DIMS.word, rows: [new Array<number>(DIMS.word).fill(0)], moments: [] } },
  ];

  for (const state of broken) {
    const lexicon = new Lexicon();
    lexicon.load(good);
    assert.doesNotThrow(() => lexicon.load(state as unknown as LexiconState));
    // الحالة العطبة تُتجاهل بصمت ويُبقى على ما كان: لا معجم نصف محمَّل
    assert.equal(lexicon.size, seed.size, `حالة عطبة أفسدت المعجم: ${JSON.stringify(state)}`);
    assert.equal(lexicon.idOf('القطه'), knownId);
    assert.equal(lexicon.countOf('القطه'), 1);
    // ويبقى صالحاً للعمل بعدها
    assert.doesNotThrow(() => lexicon.perceive('القطة تشرب', true));
  }

  // قيم غير عددية داخل التمثيل تُنظَّف ولا تُسرّب NaN إلى بقية الدماغ
  const dirty: LexiconState = {
    dim: DIMS.word,
    words: ['القطه'],
    counts: [-5],
    embedding: {
      dim: DIMS.word,
      rows: [new Array<number>(DIMS.word).fill(0).map((_, i) => (i === 0 ? Number.NaN : i === 1 ? Number.POSITIVE_INFINITY : 0.5))],
      moments: [],
    },
  };
  const cleaned = new Lexicon();
  assert.doesNotThrow(() => cleaned.load(dirty));
  assert.equal(cleaned.size, 1);
  const row = cleaned.embedding.get(0);
  assert.ok(Array.from(row).every((x) => Number.isFinite(x)), 'NaN تسرّب إلى تمثيل كلمة');
  assert.equal(row[0], 0);
  assert.equal(row[1], 0);
  // عدّاد سالب لا معنى له فيُصفَّر
  assert.equal(cleaned.countOf('القطه'), 0);
});
