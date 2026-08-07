/* ————— حارس الامتحان —————
 *
 * سائر الاختبارات تحرس الفصوص واحداً واحداً. هذا وحده يحرس **زبير**: يعيد
 * الورقة المجمَّدة كما هي، ويقارن النتيجة بالمحفوظة في `exam-baseline.json`.
 *
 * وهو أبطأ اختبارٍ في المشروع — خمسٌ وأربعون بنداً على ثلاثة أدمغة جديدة، نحو
 * عشرين ثانية. وتلك كلفةٌ مقصودة: أرخص من أن يصير زبير أغبى ولا يقول ذلك رقم.
 *
 * ولا يُطالَب بالكمال بل بألّا ينحدر. فإن ارتفعت النسبة، حدِّث الأساس بـ
 * `pnpm exam --save` — وإن هبطت، فقد كسر تغييرُك شيئاً لم يكسر اختبار وحدة.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { runExam, baselineOf, type Baseline, type ExamReport } from '../exam/run.js';
import { EXAM, SECTIONS } from '../exam/paper.js';

const baseline: Baseline = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../exam-baseline.json', import.meta.url)), 'utf8'),
);

/* تشغيلٌ واحد تتقاسمه الاختبارات: إعادته لكل اختبار تعني دقيقةً كاملة بلا فائدة */
let cached: ExamReport | null = null;
async function once(): Promise<ExamReport> {
  if (!cached) cached = await runExam(baseline.seeds);
  return cached;
}

test('الورقة نفسها لم تُمسّ: البنود والأبواب ثابتة', () => {
  assert.equal(EXAM.length * baseline.seeds.length, baseline.total,
    'عدد الأجوبة تغيّر — إن أضفتَ بنداً فاحفظ أساساً جديداً');
  const sections = new Set(EXAM.map((item) => item.section));
  for (const section of sections) {
    assert.ok(SECTIONS.includes(section), `بابٌ خارج ترتيب التقرير: ${section}`);
  }
  const ids = new Set(EXAM.map((item) => item.id));
  assert.equal(ids.size, EXAM.length, 'معرّفٌ مكرّر: المقارنة عبر النسخ تقوم على المعرّف');
});

test('النسبة لم تنحدر عن الأساس', async () => {
  const report = await once();
  assert.ok(
    report.passed >= baseline.passed,
    `${report.passed}/${report.total} بعد أن كانت ${baseline.passed}/${baseline.total}`,
  );
});

test('ولا بابٌ واحدٌ انحدر وحده', async () => {
  const report = await once();
  for (const score of report.sections) {
    const was = baseline.sections[score.section] ?? 0;
    assert.ok(score.passed >= was, `«${score.section}»: ${score.passed} بعد ${was}`);
  }
});

test('ولا بندٌ كان يمرّ فصار يسقط', async () => {
  const report = await once();
  const known = new Set(baseline.failed);
  const now = baselineOf(report).failed;
  const fresh = now.filter((id) => !known.has(id));
  assert.deepEqual(fresh, [], `سقط ما كان يمرّ: ${fresh.join('، ')}`);
});

/* ————— المعايرة —————
 * لا يُطالَب اليوم بأن تكون ثقته احتمالاً — الأساس المحفوظ يشهد أنها ليست
 * كذلك. لكن لا يجوز أن تزداد بُعداً. */
test('فارق المعايرة لم يتّسع', async () => {
  const report = await once();
  assert.ok(
    report.calibration.error <= baseline.calibrationError + 0.02,
    `فارق المعايرة ${report.calibration.error.toFixed(3)} بعد ${baseline.calibrationError.toFixed(3)}`,
  );
});

test('وكل ما جزم به دخل جدول المعايرة', async () => {
  const report = await once();
  const asserted = report.results.filter((r) => r.asserted).length;
  assert.equal(report.calibration.asserted, asserted);
  assert.ok(asserted > 0, 'ورقةٌ لا جزمَ فيها لا تقيس معايرة');
});
