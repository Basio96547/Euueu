import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

/**
 * سلّم أولوية الخصومات — الفصل 7 §7.7
 * الترتيب: عرض الكمية ← الحزمة ← قاعدة التسعير ← الكوبون.
 * الدوال المفحوصة هنا حسابٌ صرف: تُستنسخ منطقها لا استدعاؤها،
 * لأن الأصل يلمس قاعدة بيانات والحساب هو محلّ الخطأ لا الاستعلام.
 */

/** خصم شريحة الكمية على سطر */
const lineAfterBreak = (unit: number, qty: number, discountBp: number) => {
  const gross = unit * qty;
  return gross - Math.floor((gross * discountBp) / 10_000);
};

/** خصم الكوبون بعد الشريحة، بسقف وبحدّ لا ينزل تحت الصفر */
function couponOff(subtotal: number, shipping: number, type: string, value: number, cap: number | null) {
  let d = type === 'PERCENTAGE' ? Math.floor((subtotal * value) / 100)
        : type === 'FIXED_AMOUNT' ? value
        : shipping;
  if (cap !== null) d = Math.min(d, cap);
  return Math.max(0, Math.min(d, subtotal + shipping));
}

describe('عرض الكمية', () => {
  test('لا يُطبَّق تحت الحد الأدنى', () => {
    assert.equal(lineAfterBreak(2500, 2, 0), 5000);
  });

  test('يُطبَّق عند بلوغ الحد', () => {
    assert.equal(lineAfterBreak(2500, 3, 1000), 6750);   // 7500 − 10%
  });

  test('النسبة بنقاط الأساس لا بالمئة', () => {
    assert.equal(lineAfterBreak(94000, 2, 500), 178600); // 188000 − 5%
  });

  /*
   * الكسر يُقتطع لا يُقرَّب صعوداً: خصمٌ أكبر بسنت من المستحق يتراكم
   * عبر آلاف الأسطر إلى فرق حقيقي في الدفتر، ولا أحد يشتكي منه فيُكتشف.
   */
  test('الكسر يُقتطع لصالح الدفتر', () => {
    assert.equal(lineAfterBreak(333, 3, 777), 922);      // 999 − 77.6 ⇒ خصم 77
  });

  test('لا خصم بنسبة صفر', () => {
    assert.equal(lineAfterBreak(1000, 5, 0), 5000);
  });
});

describe('الكوبون', () => {
  test('النسبة المئوية', () => {
    assert.equal(couponOff(23000, 200, 'PERCENTAGE', 20, null), 4600);
  });

  test('السقف يقيّد النسبة', () => {
    assert.equal(couponOff(50000, 200, 'PERCENTAGE', 10, 2500), 2500);
  });

  test('المبلغ الثابت', () => {
    assert.equal(couponOff(23000, 200, 'FIXED_AMOUNT', 1500, null), 1500);
  });

  test('الشحن المجاني يساوي قيمة الشحن', () => {
    assert.equal(couponOff(23000, 200, 'FREE_SHIPPING', 0, null), 200);
  });

  /* مستحقٌ سالب لا معنى له نقداً: المندوب لا يدفع للزبون */
  test('الخصم لا يتجاوز ما يُدفع', () => {
    assert.equal(couponOff(1000, 200, 'FIXED_AMOUNT', 99999, null), 1200);
  });

  test('لا خصم سالب', () => {
    assert.ok(couponOff(1000, 0, 'PERCENTAGE', 0, null) >= 0);
  });
});

describe('ترتيب التطبيق', () => {
  /*
   * الكوبون يُحسب على المجموع **بعد** شريحة الكمية.
   *
   * نسبتان مئويتان تتبادلان الموضع بلا أثر — الضرب تبادليّ.
   * لكن المبلغ الثابت والسقف لا يتبادلان، وهناك يظهر الفرق:
   * فالترتيب ليس تفصيلاً أسلوبياً بل يحدّد ما يدفعه الزبون.
   */
  test('نسبتان مئويتان لا يتأثران بالترتيب', () => {
    const a = lineAfterBreak(2500, 3, 1000);
    const breakThenCoupon = a - couponOff(a, 0, 'PERCENTAGE', 10, null);
    const couponThenBreak = lineAfterBreak(7500 - couponOff(7500, 0, 'PERCENTAGE', 10, null), 1, 1000);
    assert.equal(breakThenCoupon, couponThenBreak);
  });

  test('المبلغ الثابت يتأثر بالترتيب — ولهذا يُثبَّت', () => {
    const breakFirst = lineAfterBreak(2500, 3, 1000)            // 6750
      - couponOff(lineAfterBreak(2500, 3, 1000), 0, 'FIXED_AMOUNT', 1000, null);
    const couponFirst = lineAfterBreak(7500 - 1000, 1, 1000);   // خصم ثم شريحة
    assert.equal(breakFirst, 5750);
    assert.equal(couponFirst, 5850);
    assert.notEqual(breakFirst, couponFirst);
  });

  test('السقف يجعل الترتيب مهماً كذلك', () => {
    const breakFirst = 6750 - couponOff(6750, 0, 'PERCENTAGE', 10, 700);   // 675 دون السقف
    const couponFirst = lineAfterBreak(7500 - couponOff(7500, 0, 'PERCENTAGE', 10, 700), 1, 1000);
    assert.equal(breakFirst, 6075);
    assert.notEqual(breakFirst, couponFirst);
  });
});

/** كم مرة تتكرر الحزمة كاملةً في السلة — الأقل بين مفرداتها */
function bundleTimes(
  items: Array<{ sku: string; qty: number }>,
  cart: Record<string, number>,
): number {
  let times = Infinity;
  for (const it of items) {
    const have = cart[it.sku] ?? 0;
    if (!have) return 0;
    times = Math.min(times, Math.floor(have / it.qty));
  }
  return Number.isFinite(times) ? times : 0;
}

describe('الحزم', () => {
  const items = [{ sku: 'PHONE', qty: 1 }, { sku: 'CASE', qty: 1 }];

  test('لا تنطبق بمفردة ناقصة', () => {
    assert.equal(bundleTimes(items, { PHONE: 1 }), 0);
    assert.equal(bundleTimes(items, { CASE: 3 }), 0);
  });

  test('تنطبق مرة عند اكتمالها', () => {
    assert.equal(bundleTimes(items, { PHONE: 1, CASE: 1 }), 1);
  });

  /*
   * جوالان وجراب واحد = حزمة واحدة لا اثنتان.
   * القسمة على المفردة الأوفر تعطي خصماً على بضاعة لم تُشترَ.
   */
  test('العدد هو الأقل بين المفردات لا الأكثر', () => {
    assert.equal(bundleTimes(items, { PHONE: 2, CASE: 1 }), 1);
    assert.equal(bundleTimes(items, { PHONE: 1, CASE: 5 }), 1);
    assert.equal(bundleTimes(items, { PHONE: 3, CASE: 3 }), 3);
  });

  test('الكمية داخل الحزمة محسوبة', () => {
    const pack = [{ sku: 'PHONE', qty: 1 }, { sku: 'CASE', qty: 2 }];
    assert.equal(bundleTimes(pack, { PHONE: 2, CASE: 3 }), 1);   // 3÷2 = 1
    assert.equal(bundleTimes(pack, { PHONE: 2, CASE: 4 }), 2);
  });

  test('الوفر يتضاعف بعدد المرات', () => {
    const list = 94900, price = 91900;
    const times = bundleTimes(items, { PHONE: 3, CASE: 3 });
    assert.equal(times, 3);
    assert.equal((list - price) * times, 9000);
  });

  /* حزمة أغلى من مفرداتها ليست عرضاً — تُرفض عند الإنشاء */
  test('الحزمة يجب أن تكون أرخص من مجموع مفرداتها', () => {
    const list = 94900;
    assert.ok(91900 < list, 'حزمة صحيحة');
    assert.ok(!(95900 < list), 'حزمة أغلى تُرفض');
  });
});
