import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { roundCash, toSypRaw, formatSyp, cashDue, fxHealth } from './money.js';

describe('التقريب النقدي', () => {
  test('يقرّب لأقرب ألف صعوداً وهبوطاً', () => {
    assert.equal(roundCash(2_133_100), 2_133_000);
    assert.equal(roundCash(2_133_600), 2_134_000);
    assert.equal(roundCash(2_133_500), 2_134_000);   // النصف يصعد
    assert.equal(roundCash(0), 0);
  });

  test('لا يُنتج مبلغاً سالباً من صفر', () => {
    assert.equal(roundCash(400), 0);
    assert.equal(roundCash(600), 1000);
  });
});

describe('التحويل إلى الليرة', () => {
  test('المرجع بالسنتات والليرة طبقة عرض', () => {
    assert.equal(toSypRaw(16_600, 12_850), 2_133_100);
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
    const r = cashDue([16_400, 200], 0, 12_850);
    assert.equal(r.totalUsdCents, 16_600);
    assert.equal(r.rawSyp, 2_133_100);
    assert.equal(r.cashSyp, 2_133_000);
    assert.equal(r.roundingDiffSyp, -100);
  });

  test('التقريب المتكرر ينحرف — والدالة لا تفعله', () => {
    const lines = [3_333, 3_333, 3_334];
    const perLine = lines.reduce((a, c) => a + roundCash(toSypRaw(c, 12_850)), 0);
    const once = cashDue(lines, 0, 12_850).cashSyp;
    assert.notEqual(perLine, once);          // الفرق حقيقي لا نظري
    assert.equal(once, roundCash(toSypRaw(10_000, 12_850)));
  });

  test('الشحن يدخل المجموع قبل التقريب', () => {
    const r = cashDue([23_000], 200, 12_850);
    assert.equal(r.totalUsdCents, 23_200);
    assert.equal(r.cashSyp, 2_981_000);
    assert.equal(r.roundingDiffSyp, -200);
  });

  test('فرق التقريب لا يتجاوز نصف وحدة التقريب', () => {
    for (let cents = 10_000; cents < 10_200; cents++) {
      const { roundingDiffSyp } = cashDue([cents], 0, 12_850);
      assert.ok(Math.abs(roundingDiffSyp) <= 500, `تجاوز عند ${cents}`);
    }
  });

  test('سلة فارغة تعطي صفراً لا NaN', () => {
    const r = cashDue([], 0, 12_850);
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
    assert.match(formatSyp(2_133_000), /2,133,000/);
  });
});
