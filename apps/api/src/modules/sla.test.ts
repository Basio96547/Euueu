import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { TicketsService } from './tickets.module.js';

/**
 * حساب المهل ضمن ساعات العمل.
 *
 * الخدمة تُنشأ بلا تبعيات حقيقية: الدالة المفحوصة حسابُ وقتٍ صرف
 * لا يمسّ قاعدة بيانات ولا يرسل رسالة.
 */
const svc = new TicketsService(null as any, null as any);
const add = (from: Date, mins: number): Date => (svc as any).addBusinessMinutes(from, mins);

/** بناء لحظة بتوقيت دمشق (UTC+3) والعودة بها إلى UTC */
const damascus = (y: number, m: number, d: number, h: number, min = 0) =>
  new Date(Date.UTC(y, m - 1, d, h - 3, min));

/** قراءة ساعة دمشق من لحظة UTC */
const hourIn = (d: Date) => new Date(d.getTime() + 3 * 3_600_000).getUTCHours();
const dayIn = (d: Date) => new Date(d.getTime() + 3 * 3_600_000).getUTCDay();

describe('مهل الدعم ضمن ساعات العمل', () => {
  /*
   * التعهّد على مدار الساعة في بلد تنقطع فيه الكهرباء وعدٌ لا يُوفى.
   * فالعدّاد يمشي في الدوام وحده: السبت–الخميس 10:00–20:00 بتوقيت دمشق.
   */

  test('داخل الدوام: إضافة مباشرة', () => {
    // الأحد 2026-08-02 الساعة 11:00 دمشق + 30 دقيقة
    const due = add(damascus(2026, 8, 2, 11), 30);
    assert.equal(hourIn(due), 11);
    assert.equal(new Date(due.getTime() + 3 * 3_600_000).getUTCMinutes(), 30);
  });

  test('قبل الافتتاح: يبدأ العدّ من العاشرة لا من لحظة الوصول', () => {
    // رسالة الساعة 3 فجراً لا تستهلك مهلتها والمتجر نائم
    const due = add(damascus(2026, 8, 2, 3), 60);
    assert.equal(hourIn(due), 11, 'يجب أن ينتهي الأجل الحادية عشرة');
  });

  test('بعد الإغلاق: يُرحَّل إلى صباح اليوم التالي', () => {
    const due = add(damascus(2026, 8, 2, 21), 60);
    assert.equal(hourIn(due), 11);
    assert.equal(new Date(due.getTime() + 3 * 3_600_000).getUTCDate(), 3);
  });

  test('يتخطّى نهاية الدوام إلى اليوم التالي', () => {
    // 19:30 + 60 دقيقة = 30 اليوم و30 غداً ⇒ 10:30 صباحاً
    const due = add(damascus(2026, 8, 2, 19, 30), 60);
    assert.equal(new Date(due.getTime() + 3 * 3_600_000).getUTCDate(), 3);
    assert.equal(hourIn(due), 10);
    assert.equal(new Date(due.getTime() + 3 * 3_600_000).getUTCMinutes(), 30);
  });

  test('الجمعة عطلة: لا يُحتسب منها دقيقة', () => {
    // الخميس 2026-08-06 الساعة 19:00 + 120 دقيقة
    const start = damascus(2026, 8, 6, 19);
    assert.equal(dayIn(start), 4, 'نقطة البداية يجب أن تكون خميساً');
    const due = add(start, 120);
    assert.notEqual(dayIn(due), 5, 'وقع الأجل يوم الجمعة');
    assert.equal(dayIn(due), 6, 'يجب أن يقع السبت');
  });

  test('السبت يوم عمل هنا لا عطلة', () => {
    const start = damascus(2026, 8, 8, 11);      // السبت
    assert.equal(dayIn(start), 6);
    const due = add(start, 60);
    assert.equal(dayIn(due), 6, 'خرج من السبت بلا داعٍ');
    assert.equal(hourIn(due), 12);
  });

  test('مهلة طويلة تتوزّع على أيام متتالية', () => {
    // 40 ساعة عمل = أربعة أيام كاملة (10 ساعات لليوم)
    const due = add(damascus(2026, 8, 2, 10), 40 * 60);
    assert.ok(due.getTime() > damascus(2026, 8, 5, 10).getTime());
    assert.ok(dayIn(due) !== 5, 'وقع الأجل يوم الجمعة');
  });

  test('الأجل يقع دائماً داخل الدوام', () => {
    for (const h of [0, 5, 9, 10, 14, 19, 20, 23]) {
      for (const mins of [30, 120, 480]) {
        const due = add(damascus(2026, 8, 2, h), mins);
        const hh = hourIn(due);
        assert.ok(hh >= 10 && hh <= 20, `وقع خارج الدوام: ${hh}:00 لـ ${h}+${mins}د`);
        assert.notEqual(dayIn(due), 5, 'وقع يوم الجمعة');
      }
    }
  });

  test('صفر دقيقة يعيد اللحظة نفسها', () => {
    const at = damascus(2026, 8, 2, 11);
    assert.equal(add(at, 0).getTime(), at.getTime());
  });

  test('الأجل يتقدّم كلما زادت المهلة', () => {
    const at = damascus(2026, 8, 2, 11);
    let prev = 0;
    for (const m of [30, 60, 240, 600, 1200]) {
      const t = add(at, m).getTime();
      assert.ok(t > prev, 'المهلة الأطول لم تعطِ أجلاً أبعد');
      prev = t;
    }
  });
});
