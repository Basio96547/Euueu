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

/* ————— نزاهة المقياس نفسه —————
 *
 * وهذا أهمّ ما في هذا الملف، وأسبقُ من كل نسبةٍ فيه.
 *
 * كلُّ قانونٍ أُضيف — الفراغ، النوع، الغريزة — يزيد امتناع زبير. فإن لم يكن في
 * الورقة بندٌ **يسقط** إذا قال «لا أعرف»، صارت سلّماً في اتّجاهٍ واحد: كلُّ
 * تشدّدٍ يرفع النسبة، حتى يبلغ نظاماً يمتنع عن كل شيء ويسجّل مئةً على ما تبقّى.
 * ونحن مقبلون على خطواتٍ كلُّها تزيد الحذر — فالنزاهة تُحرَس قبلها لا بعدها. */

test('أكثرُ الورقة يعاقب الامتناع — وإلا فكلُّ تشدّدٍ يُقرأ تحسّناً', async () => {
  const report = await once();
  const { punished, saved } = report.silence;
  assert.ok(
    punished.length >= saved.length * 2,
    `${punished.length} بنداً يُسقطها الصمت مقابل ${saved.length} ينجو بها — المقياس يميل إلى الصمت`,
  );
});

test('ولا بندَ وُسم «لا يُمتنَع عنه» ثم نجا بالصمت', async () => {
  const report = await once();
  /* العلامة نيّةٌ حتى تُدقَّق: يُقيَّم على كل بندٍ صمتٌ مصطنع، فإن نجا به بندٌ
   * موسومٌ فالعلامة كاذبة ولا تحرس شيئاً. */
  assert.deepEqual(report.silence.mislabelled, []);
});

test('ولم يزدد امتناعه عمّا يجب أن يجيبه', async () => {
  const report = await once();
  assert.ok(
    report.silence.abstained <= baseline.abstainedOnMustAnswer,
    `امتنع عن ${report.silence.abstained} بعد أن كان ${baseline.abstainedOnMustAnswer}`,
  );
  assert.equal(report.silence.ofMustAnswer, baseline.mustAnswerCount);
});

/* ————— المعايرة —————
 *
 * لا يُطالَب اليوم بأن تكون ثقته احتمالاً — الأساس المحفوظ يشهد أنها ليست
 * كذلك. لكن لا يجوز أن تزداد بُعداً بلا أن يتحسّن شيء.
 *
 * وقد اتّسع الفارق مرّةً **بسبب تحسّن**: لمّا منعته الملكيةُ من الجزم بما لا
 * يملك، صار كلُّ جزمٍ له صواباً، فارتفعت إصابتُه إلى ١٠٠٪ وبقيت دعواه عند
 * ٠٫٦٥ — فاتّسعت الفجوة. وذلك ليس انحداراً بل دليلٌ آخر على أن الرقم ليس
 * احتمالاً. فحين يتحسّن، يُحفظ أساسٌ جديد ويُقرأ الفارق على وجهه. */
test('فارق المعايرة لم يتّسع', async () => {
  const report = await once();
  assert.ok(
    report.calibration.error <= baseline.calibrationError + 0.02,
    `فارق المعايرة ${report.calibration.error.toFixed(3)} بعد ${baseline.calibrationError.toFixed(3)}`,
  );
});

/* ————— أسبقُ من المعايرة: أيتغيّر رقمه أصلاً؟ —————
 *
 * الجواب اليوم: يتغيّر بين أن يعرف وألّا يعرف، ولا يتغيّر بين أن يصيب وأن
 * يخطئ — لأن قرار الكلام استهلك التمييز كلَّه قبل أن يصل إلى الرقم. فما يبقى
 * في يد الحَكَم رقمٌ مسطَّح، والترجيح به أسبقيةٌ باليد في ثوبٍ عدديّ.
 *
 * فهذا الاختبار يحرس الحقيقة كما هي اليوم: إن صار رقمه يفصل صوابه عن خطئه،
 * فشِلَ هذا الاختبار — وذاك فشلٌ مطلوب، عنده يُفتح باب الترجيح العددي. */
test('ثقته لا تفصل صوابه عن خطئه بعد — فالحَكَم يعمل بالرتب', async () => {
  const report = await once();
  const cal = report.calibration;
  assert.ok(
    Number.isNaN(cal.separation) || cal.separation <= 0.05,
    `صار فصلُ ثقته ${cal.separation.toFixed(3)} — راجع الحَكَم: قد يصلح الترجيح العددي الآن`,
  );
});

test('وكل ما جزم به دخل جدول المعايرة', async () => {
  const report = await once();
  const asserted = report.results.filter((r) => r.asserted).length;
  assert.equal(report.calibration.asserted, asserted);
  assert.ok(asserted > 0, 'ورقةٌ لا جزمَ فيها لا تقيس معايرة');
});
