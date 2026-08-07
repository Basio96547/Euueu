/* ————— سجل النمو —————
 *
 * لا يجوز أن يُقال «زبير يتعلّم» بلا رقم يسنده. هذه الدوال تحوّل حالة دماغه
 * إلى أرقام يقرؤها أبوه، وشرطها الصدق: إن هبطت نسبة إصابته فلتقل ذلك.
 */

import type { GrowthMetrics } from './types.js';

/** نافذة القياس: عشرون جواباً. أقلّ منها ضجيج، وأكثر منها يُخفي التغيّر الحديث. */
export const WINDOW = 20;

/**
 * نسبة إصابته في آخر عشرين حكماً، والعشرين التي قبلها.
 *
 * الرقمان معاً لا رقم واحد: النسبة المطلقة لا تقول شيئاً عن التعلّم، والتقدّم
 * فرقٌ لا قيمة. حكم +1 صحيح و‎-1 خطأ.
 */
export function accuracyOf(verdicts: readonly number[]): { recent: number; previous: number } {
  if (!verdicts || verdicts.length === 0) return { recent: 0, previous: 0 };
  const recentSlice = verdicts.slice(-WINDOW);
  const previousSlice = verdicts.slice(Math.max(0, verdicts.length - 2 * WINDOW), Math.max(0, verdicts.length - WINDOW));
  return { recent: ratio(recentSlice), previous: ratio(previousSlice) };
}

function ratio(slice: readonly number[]): number {
  if (slice.length === 0) return 0;
  let right = 0;
  for (const verdict of slice) if (verdict > 0) right++;
  return right / slice.length;
}

/** جملة عربية واحدة تصف حال زبير لأبيه. تقول الهبوط كما تقول الارتفاع. */
export function summarize(m: GrowthMetrics): string {
  /* لا اسمَ طورٍ هنا: كان يُقال «زبير في مرحلة طفل» فيُوصَف بسنّه لا بما يعرف.
   * والذي يهمّ الأب أن يعرف **ما عنده** لا في أيّ درجةٍ من سُلَّم. */
  const parts = [`زبير يعرف ${m.vocab} كلمة`];
  if (m.facts > 0) parts.push(`و${m.facts} حقيقة`);

  if (m.lessons === 0) {
    return `${parts.join('، ')} — ولم تُعلّمه شيئاً بعد.`;
  }

  const recent = Math.round(m.recentAccuracy * 100);
  const previous = Math.round(m.previousAccuracy * 100);
  let verdict: string;
  if (m.previousAccuracy === 0 && m.recentAccuracy === 0) {
    verdict = 'ولم يُصب في أي جواب بعد';
  } else if (previous === 0) {
    verdict = `وأصاب في ${recent}٪ من آخر ${WINDOW} جواباً`;
  } else if (recent > previous) {
    verdict = `وأصاب في ${recent}٪ من آخر ${WINDOW} جواباً — أعلى من ${previous}٪ قبلها`;
  } else if (recent < previous) {
    // الصدق هنا أهم من التشجيع: أب لا يعرف أن ابنه تراجع لا يستطيع إصلاح تعليمه
    verdict = `لكن إصابته هبطت إلى ${recent}٪ بعد أن كانت ${previous}٪`;
  } else {
    verdict = `وإصابته ثابتة على ${recent}٪ بلا تقدّم`;
  }

  parts.push(verdict);
  return `${parts.join('، ')}.`;
}
