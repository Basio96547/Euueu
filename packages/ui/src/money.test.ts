import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { roundCash, toSypRaw, formatSyp, cashDue, fxHealth } from './money.js';

/*
 * الأرقام هنا بالليرة السورية الجديدة: حُذف صفران في 2026-01-01، وأصغر
 * ورقةٍ متداولة عشرُ ليرات. و132 رقمُ اختبارٍ مختار، لا سعرَ البذرة.
 *
 * وهذه الاختبارات هي ما يمنع عودة الوحدة القديمة تسلُّلاً: من يغيّر
 * الخطوة إلى ألفٍ يسقط هنا قبل أن يصل إلى بطاقة سعرٍ في يد زبون.
 */
const RATE = 132;

describe('التقريب النقدي', () => {
  test('يقرّب لأقرب عشر ليرات صعوداً وهبوطاً', () => {
    assert.equal(roundCash(21_331), 21_330);
    assert.equal(roundCash(21_336), 21_340);
    assert.equal(roundCash(21_335), 21_340);   // النصف يصعد
    assert.equal(roundCash(0), 0);
  });

  test('لا يُنتج مبلغاً سالباً من صفر', () => {
    assert.equal(roundCash(4), 0);
    assert.equal(roundCash(6), 10);
  });

  test('عشرةُ الجديدة هي ألفُ القديمة — القاعدة لم تتغيّر', () => {
    // 1000 ليرة قديمة = 10 جديدة، فالتقريب يقع على المبلغ نفسه بعد الحذف
    assert.equal(roundCash(2_133_100 / 100), 21_330);
  });
});

describe('التحويل إلى الليرة', () => {
  test('المرجع بالسنتات والليرة طبقة عرض', () => {
    assert.equal(toSypRaw(16_600, RATE), 21_912);
  });

  test('سعر صرف صفر لا يُنتج NaN', () => {
    assert.equal(toSypRaw(16_600, 0), 0);
  });
});

describe('المستحق النقدي', () => {
  /*
   * جوهر المسألة: التقريب مرة واحدة في النهاية.
   * لو قُرِّب كل سطر على حدة لاختلف المجموع عمّا يُطبع على الإيصال،
   * ولظهر فرق يومي في التسوية لا مصدر له سوى الحساب نفسه.
   */
  test('يقرّب المجموع مرة واحدة لا كل سطر', () => {
    const r = cashDue([16_400, 200], 0, RATE);
    assert.equal(r.totalUsdCents, 16_600);
    assert.equal(r.rawSyp, 21_912);
    assert.equal(r.cashSyp, 21_910);
    assert.equal(r.roundingDiffSyp, -2);
  });

  test('التقريب المتكرر ينحرف — والدالة لا تفعله', () => {
    /* ثلاثة أسطر يصعد تقريبُ كلٍّ منها، فيتراكم الفرق إلى عشر ليرات */
    const lines = [1_004, 1_004, 1_004];
    const perLine = lines.reduce((a, c) => a + roundCash(toSypRaw(c, RATE)), 0);
    const once = cashDue(lines, 0, RATE).cashSyp;
    assert.equal(perLine, 3_990);
    assert.equal(once, 3_980);
    assert.notEqual(perLine, once);          // الفرق حقيقي لا نظري
    assert.equal(once, roundCash(toSypRaw(3_012, RATE)));
  });

  test('الشحن يدخل المجموع قبل التقريب', () => {
    const r = cashDue([23_000], 200, RATE);
    assert.equal(r.totalUsdCents, 23_200);
    assert.equal(r.cashSyp, 30_620);
    assert.equal(r.roundingDiffSyp, -4);
  });

  test('فرق التقريب لا يتجاوز نصف وحدة التقريب', () => {
    for (let cents = 10_000; cents < 10_200; cents++) {
      const { roundingDiffSyp } = cashDue([cents], 0, RATE);
      assert.ok(Math.abs(roundingDiffSyp) <= 5, `تجاوز عند ${cents}`);
    }
  });

  test('سلة فارغة تعطي صفراً لا NaN', () => {
    const r = cashDue([], 0, RATE);
    assert.equal(r.totalUsdCents, 0);
    assert.equal(r.cashSyp, 0);
  });
});

describe('صحة سعر الصرف', () => {
  const H = 3_600_000;

  test('طازج ما دام بعيداً عن الانتهاء', () => {
    assert.equal(fxHealth(new Date(Date.now() + 12 * H).toISOString()), 'FRESH');
  });

  test('يقارب الانتهاء', () => {
    assert.equal(fxHealth(new Date(Date.now() + 2 * H).toISOString()), 'EXPIRING');
  });

  test('منتهٍ ضمن فترة السماح: يُباع بهامش أمان', () => {
    assert.equal(fxHealth(new Date(Date.now() - 3 * H).toISOString()), 'STALE_MARGIN');
  });

  test('منتهٍ منذ زمن: يتوقف البيع', () => {
    assert.equal(fxHealth(new Date(Date.now() - 30 * H).toISOString()), 'STALE_HALT');
  });
});

describe('العرض', () => {
  test('يعرض بأرقام لاتينية وفواصل آلاف', () => {
    assert.match(formatSyp(124_080), /124,080/);
  });
});
