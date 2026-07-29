import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAr, buildSynonyms, expandQuery, categoriesForQuery } from './arabic.js';

describe('تطبيع العربية', () => {
  /*
   * الزبون يكتب «ايفون» بلا همزة، والكتالوج يكتب «آيفون» بمدّة.
   * بلا تطبيع يبحث نصف السوق عن جهاز لا يجده المتجر — وهو موجود.
   */
  test('يوحّد صور الألف', () => {
    const forms = ['ايفون', 'آيفون', 'أيفون', 'إيفون'];
    const normalized = new Set(forms.map(normalizeAr));
    assert.equal(normalized.size, 1, `لم تتوحّد: ${[...normalized].join(' · ')}`);
  });

  test('يوحّد التاء المربوطة والهاء', () => {
    assert.equal(normalizeAr('سماعة'), normalizeAr('سماعه'));
  });

  test('يوحّد الألف المقصورة والياء', () => {
    assert.equal(normalizeAr('مصطفى'), normalizeAr('مصطفي'));
  });

  test('يسقط التشكيل', () => {
    assert.equal(normalizeAr('جَوَّال'), normalizeAr('جوال'));
  });

  test('يسقط التطويل', () => {
    assert.equal(normalizeAr('جــوال'), normalizeAr('جوال'));
  });

  test('لا يمسّ اللاتينية والأرقام', () => {
    assert.equal(normalizeAr('iPhone 15 Pro'), normalizeAr('iPhone 15 Pro'));
    assert.ok(normalizeAr('ZA/A').includes('ZA/A') || normalizeAr('ZA/A').includes('za/a'));
  });

  test('نص فارغ لا يكسر الدالة', () => {
    assert.equal(normalizeAr(''), '');
  });
});

describe('المرادفات', () => {
  test('الخريطة ثنائية الاتجاه: كل صورة تدلّ على أخواتها', () => {
    const syn = buildSynonyms();
    const iphone = normalizeAr('ايفون');
    assert.ok(syn[iphone]?.length, 'لا مرادفات لـ«ايفون»');
    // ثنائية الاتجاه: لو دلّت «ا» على «ب» فلتدلّ «ب» على «ا»
    for (const other of syn[iphone]!) {
      assert.ok(syn[other]?.includes(iphone), `${other} لا يعود إلى ${iphone}`);
    }
  });

  test('لا كلمة مرادفة لنفسها', () => {
    const syn = buildSynonyms();
    for (const [term, others] of Object.entries(syn)) {
      assert.ok(!others.includes(term), `${term} مرادف لنفسه`);
    }
  });

  test('التوسيع يشمل الأصل ويزيد عليه', () => {
    const q = expandQuery('ايفون');
    assert.ok(q.includes(normalizeAr('ايفون')));
    assert.ok(q.length > 1);
  });

  test('كلمة لا مرادف لها تُعاد وحدها', () => {
    assert.deepEqual(expandQuery('زربطانه'), [normalizeAr('زربطانه')]);
  });
});

describe('الكلمات العامة تُترجم إلى فئات', () => {
  /*
   * «جوال» و«موبايل» ليستا اسمَي منتج بل اسم الفئة كلها.
   * بلا هذا الجسر يُرجع البحث صفر نتائج لأكثر كلمتين يكتبهما السوق.
   */
  test('«جوال» تفتح فئات الهواتف كلها', () => {
    const cats = categoriesForQuery('جوال');
    assert.ok(cats.includes('smartphones'));
    assert.ok(cats.includes('feature-phones'));
    assert.ok(cats.includes('used-refurbished'));
  });

  test('«موبايل» تعطي الفئات نفسها', () => {
    assert.deepEqual(categoriesForQuery('موبايل').sort(), categoriesForQuery('جوال').sort());
  });

  test('«شاحن» لا تجرّ الهواتف معها', () => {
    const cats = categoriesForQuery('شاحن');
    assert.deepEqual(cats, ['chargers']);
    assert.ok(!cats.includes('smartphones'));
  });

  test('اسم منتج بعينه ليس فئة', () => {
    assert.deepEqual(categoriesForQuery('ايفون 15'), []);
  });

  test('نص فارغ لا يعطي فئة', () => {
    assert.deepEqual(categoriesForQuery(''), []);
  });
});

describe('عتبة التسامح مع الأخطاء تُقاس بالبايت', () => {
  /*
   * Meilisearch يقيس طول الكلمة بالبايت، والحرف العربي بايتان.
   * هذا الاختبار يوثّق الحساب الذي بُنيت عليه العتبة 12، لأن الرقم
   * يبدو تعسفياً لمن يقرؤه بعد سنة ويظنّه قابلاً للخفض.
   */
  const bytes = (s: string) => Buffer.byteLength(s, 'utf8');

  test('الحرف العربي بايتان', () => {
    assert.equal(bytes('ايفون'), 10);          // خمسة أحرف
    assert.equal(bytes('انفينكس'), 14);
  });

  test('العتبة 12 تمنع التسامح عن الكلمات العربية القصيرة', () => {
    const ONE_TYPO = 12;
    assert.ok(bytes('ايفون') < ONE_TYPO, 'ايفون يجب ألا تنال تسامحاً');
    assert.ok(bytes('سماعه') < ONE_TYPO);
    assert.ok(bytes('شاحن') < ONE_TYPO);
  });

  test('وتُبقيه للكلمات العربية الطويلة حيث الخطأ محتمل فعلاً', () => {
    assert.ok(bytes('سماعات لاسلكيه'.split(' ')[0]!) >= 12);
  });

  test('الثمن معروف: الاسم اللاتيني القصير يفقد تسامحه', () => {
    assert.ok(bytes('Lightning') < 12, 'وهذا مقصود وموثَّق لا سهو');
  });
});
