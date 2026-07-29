import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, checkPasswordStrength } from './password.js';

describe('تجزئة كلمة السرّ', () => {
  test('تتحقّق من الكلمة الصحيحة', async () => {
    const h = await hashPassword('كلمة سرّ طويلة كفاية');
    assert.equal(await verifyPassword('كلمة سرّ طويلة كفاية', h), true);
  });

  test('ترفض الخاطئة', async () => {
    const h = await hashPassword('Bis123123321');
    assert.equal(await verifyPassword('Bis123123322', h), false);
    assert.equal(await verifyPassword('', h), false);
  });

  /*
   * لكل كلمة ملحٌ خاص: بلا ملح تُكشف كلمتان متطابقتان لموظّفَين
   * بمجرد النظر إلى الجدول، ويُهزم الجدول كله بقوس قزح واحد.
   */
  test('الكلمة نفسها تعطي تجزئتين مختلفتين', async () => {
    const a = await hashPassword('نفس الكلمة تماماً');
    const b = await hashPassword('نفس الكلمة تماماً');
    assert.notEqual(a, b, 'التجزئة متطابقة — الملح غائب');
    assert.equal(await verifyPassword('نفس الكلمة تماماً', a), true);
    assert.equal(await verifyPassword('نفس الكلمة تماماً', b), true);
  });

  test('التجزئة تحمل معاملاتها فلا تُبطل رفعُها القديمَ', async () => {
    const h = await hashPassword('كلمة سرّ للفحص');
    const [algo, N, r, p] = h.split('$');
    assert.equal(algo, 'scrypt');
    assert.ok(Number(N) >= 16384, 'كلفة المعالجة منخفضة');
    assert.ok(Number(r) > 0 && Number(p) > 0);
  });

  test('تجزئة مشوَّهة تُرفض ولا ترمي', async () => {
    for (const bad of ['', 'ليست تجزئة', 'bcrypt$1$2$3$4$5', 'scrypt$$$$']) {
      assert.equal(await verifyPassword('أي شيء', bad), false, `لم تُرفض: ${bad}`);
    }
  });

  test('التطبيع يوحّد الصور المركّبة للمحرف نفسه', async () => {
    // نفس النص بصورتين يونيكود مختلفتين يجب أن يُقبل بكلتيهما
    const composed = 'passwordé123';
    const decomposed = 'passwordé123';
    const h = await hashPassword(composed);
    assert.equal(await verifyPassword(decomposed, h), true);
  });
});

describe('قوة كلمة السرّ', () => {
  test('تقبل كلمة معقولة الطول', () => {
    assert.equal(checkPasswordStrength('Bis123123321').ok, true);
    assert.equal(checkPasswordStrength('حصان بطارية دبوس صحيح').ok, true);
  });

  /*
   * الطول هو ما يهمّ. اشتراط رموز وأرقام إلزامية يدفع الناس إلى
   * «Password1!» ثم إلى ورقة ملصقة على الشاشة.
   */
  test('ترفض القصيرة', () => {
    const r = checkPasswordStrength('Ab1!x');
    assert.equal(r.ok, false);
    assert.match(r.reason!, /عشرة/);
  });

  test('ترفض الشائعة جداً', () => {
    assert.equal(checkPasswordStrength('password').ok, false);
    assert.equal(checkPasswordStrength('12345678').ok, false);
    assert.equal(checkPasswordStrength('PassWord1').ok, false);   // قصيرة أيضاً
  });

  test('ترفض محرفاً واحداً مكرَّراً', () => {
    assert.equal(checkPasswordStrength('aaaaaaaaaaaa').ok, false);
    assert.equal(checkPasswordStrength('111111111111').ok, false);
  });

  test('ترفض المفرطة في الطول', () => {
    assert.equal(checkPasswordStrength('x'.repeat(300)).ok, false);
  });

  test('لا تشترط رموزاً ولا أرقاماً', () => {
    assert.equal(checkPasswordStrength('كلمات عربية بلا أرقام').ok, true);
  });
});
