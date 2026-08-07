/* ————— تشغيل الامتحان المجمَّد —————
 *
 * الورقة في `paper.ts` والتصحيح هنا. وثلاثة قرارات في التصحيح تستحقّ التسمية:
 *
 *  ١) **دماغٌ جديد لكل بند.** أغلى من دماغٍ واحد يمرّ على الورقة كلها، لكن
 *     الأرخص يكذب: بندٌ يعلّمه «الزقفوط نبات» يُفسد بنداً بعده يمتحن جهله
 *     بالزقفوط. والامتحان الذي يسرّب إلى نفسه ليس امتحاناً.
 *
 *  ٢) **الرفض يسبق القبول.** إن قال ما لا يجوز سقط البند ولو قال الصواب معه.
 *     لأن الهلوسة لا تُكفَّر بإصابةٍ في الجملة نفسها.
 *
 *  ٣) **جدول المعايرة.** هذا هو الجواب على النقد الذي وُجّه إليّ: أن عتبةً
 *     مضبوطةً بالحدس ليست احتمالاً. فتُجمَع كل جملةٍ جزم بها، وتُبوَّب بثقته
 *     المعلنة، ويُقاس ما أصاب منها فعلاً في كل خانة. إن قال «٠٫٧» في مئة جملة
 *     وأصاب سبعين، فرقمه احتمال. وإلا فهو رقمٌ مضبوطٌ بالحدس، ويُكتب ذلك في
 *     التقرير بلا تجميل.
 */

import { Zubair } from '../brain.js';
import { memoryStorage } from '../core/persist.js';
import { normalizeArabic } from '../core/text.js';
import type { Strategy, TickOutput } from '../core/types.js';
import { EXAM, SECTIONS, type ExamItem, type Section } from './paper.js';

/** البذور الثابتة: عدّةُ أدمغةٍ لا واحد، فلا تُقاس الورقة بحظّ بذرةٍ واحدة. */
export const SEEDS: readonly number[] = [0x5eed, 0x1379, 0x2b17];

/** ساعةٌ ثابتة: الدماغ يقيس الغياب بالزمن، فزمنٌ حقيقي يعني نتيجةً متحرّكة. */
const CLOCK_START = 1_700_000_000_000;
const CLOCK_STEP = 45_000;

/** ما يُحتسب إمساكاً عن الجزم */
const WITHHOLDING: ReadonlySet<Strategy> = new Set(['ADMIT', 'ASK_QUESTION']);

export interface ItemResult {
  id: string;
  section: Section;
  seed: number;
  ask: string;
  /** ما قاله زبير حرفياً */
  said: string;
  strategy: Strategy;
  confidence: number;
  passed: boolean;
  /** سبب السقوط بعبارة واحدة، وفارغٌ عند النجاح */
  reason: string;
  /** أجزم بجملته؟ به يدخل جدول المعايرة */
  asserted: boolean;
  why: string;
}

export interface SectionScore {
  section: Section;
  passed: number;
  total: number;
  rate: number;
}

export interface CalibrationBucket {
  /** حدّا الخانة: [lower, upper) */
  lower: number;
  upper: number;
  /** متوسّط ما ادّعاه من ثقة في هذه الخانة */
  claimed: number;
  /** وما أصابه فعلاً */
  observed: number;
  count: number;
}

export interface Calibration {
  buckets: readonly CalibrationBucket[];
  /** متوسّط الفارق بين الدعوى والواقع، موزوناً بعدد الجمل — صفرٌ يعني معايرة تامّة */
  error: number;
  asserted: number;
  correct: number;
  /* ————— أسبقُ من المعايرة: أيتغيّر رقمه أصلاً؟ —————
   * رقمٌ ثابت لا يحمل معلومةً، معايَراً كان أو غير معايَر. والترجيح به يومئذٍ
   * مطابقٌ رياضياً لأسبقيةٍ مكتوبةٍ باليد — يخفيها ولا يحلّها. */
  /** الانحراف المعياري لثقته على ما جزم به */
  spread: number;
  lowest: number;
  highest: number;
  /** متوسّط ثقته حين أصاب، وحين أخطأ */
  meanWhenRight: number;
  meanWhenWrong: number;
  /** الفرق بينهما: هذا وحده يقول إن كان رقمه يفصل صوابه عن خطئه */
  separation: number;
}

export interface ExamReport {
  seeds: readonly number[];
  passed: number;
  total: number;
  rate: number;
  sections: readonly SectionScore[];
  calibration: Calibration;
  results: readonly ItemResult[];
  ms: number;
}

/** يحتوي جوابُه واحداً من هذه؟ المقارنة على الصورة المطبَّعة: «مدينة» و«مدينه» واحد. */
function says(said: string, needles: readonly string[]): string | null {
  const hay = normalizeArabic(said);
  for (const needle of needles) {
    const n = normalizeArabic(needle);
    if (n.length > 0 && hay.includes(n)) return needle;
  }
  return null;
}

function judgeItem(item: ExamItem, out: TickOutput): { passed: boolean; reason: string } {
  // (٢) الرفض أولاً: قولُ الممنوع يُسقط البند ولو صاحبه صواب
  if (item.reject) {
    const said = says(out.text, item.reject);
    if (said !== null) return { passed: false, reason: `قال ما لا يجوز: «${said}»` };
  }
  if (item.withhold) {
    if (!WITHHOLDING.has(out.strategy)) {
      return { passed: false, reason: `جزم حيث يجب أن يُمسك (${out.strategy})` };
    }
    return { passed: true, reason: '' };
  }
  if (item.expect) {
    if (says(out.text, item.expect) === null) {
      return { passed: false, reason: `لم يقل شيئاً من: ${item.expect.join('، ')}` };
    }
  }
  return { passed: true, reason: '' };
}

/** بندٌ واحد على دماغٍ واحدٍ جديد. */
async function runItem(item: ExamItem, seed: number): Promise<ItemResult> {
  const zubair = await Zubair.create({
    storage: memoryStorage(), seed, fresh: true, heritage: true,
  });
  let clock = CLOCK_START;
  for (const line of item.teach ?? []) {
    await zubair.hear(line, clock);
    clock += CLOCK_STEP;
  }
  const out = await zubair.hear(item.ask, clock);
  const { passed, reason } = judgeItem(item, out);
  return {
    id: item.id, section: item.section, seed, ask: item.ask,
    said: out.text, strategy: out.strategy, confidence: out.confidence,
    passed, reason, asserted: out.kind === 'answer', why: item.why,
  };
}

/* ————— جدول المعايرة ————— */

/* عشر خاناتٍ بعرض ٠٫١ لا خمسٌ بعرض ٠٫٢.
 *
 * وهذا تصحيحُ خطأٍ مني: بالخمس ظهر ٩٥ جواباً في خانةٍ واحدة، فقُرئ التقرير —
 * بحقّ — على أن ثقته رقمٌ ثابت. والثابت لم يكن ثقته بل خاناتي. */
const BUCKETS = 10;

function calibrate(results: readonly ItemResult[]): Calibration {
  const claimed = new Array<number>(BUCKETS).fill(0);
  const correct = new Array<number>(BUCKETS).fill(0);
  const count = new Array<number>(BUCKETS).fill(0);
  const values: number[] = [];
  let rightSum = 0;
  let wrongSum = 0;
  let wrong = 0;
  let asserted = 0;
  let hit = 0;
  for (const r of results) {
    if (!r.asserted) continue;
    const c = Math.min(Math.max(r.confidence, 0), 1);
    const b = Math.min(BUCKETS - 1, Math.floor(c * BUCKETS));
    claimed[b] = (claimed[b] ?? 0) + c;
    count[b] = (count[b] ?? 0) + 1;
    values.push(c);
    if (r.passed) { correct[b] = (correct[b] ?? 0) + 1; hit++; rightSum += c; }
    else { wrong++; wrongSum += c; }
    asserted++;
  }
  const buckets: CalibrationBucket[] = [];
  let error = 0;
  for (let b = 0; b < BUCKETS; b++) {
    const n = count[b] ?? 0;
    if (n === 0) continue;
    const meanClaimed = (claimed[b] ?? 0) / n;
    const observed = (correct[b] ?? 0) / n;
    buckets.push({ lower: b / BUCKETS, upper: (b + 1) / BUCKETS, claimed: meanClaimed, observed, count: n });
    error += (n / Math.max(1, asserted)) * Math.abs(meanClaimed - observed);
  }
  const mean = values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.length === 0 ? 0
    : values.reduce((s, x) => s + (x - mean) ** 2, 0) / values.length;
  const meanWhenRight = hit === 0 ? 0 : rightSum / hit;
  const meanWhenWrong = wrong === 0 ? 0 : wrongSum / wrong;
  return {
    buckets, error, asserted, correct: hit,
    spread: Math.sqrt(variance),
    lowest: values.length === 0 ? 0 : Math.min(...values),
    highest: values.length === 0 ? 0 : Math.max(...values),
    meanWhenRight,
    meanWhenWrong,
    separation: wrong === 0 ? Number.NaN : meanWhenRight - meanWhenWrong,
  };
}

/* ————— الورقة كلها ————— */

export async function runExam(seeds: readonly number[] = SEEDS): Promise<ExamReport> {
  const started = Date.now();
  const results: ItemResult[] = [];
  for (const seed of seeds) {
    for (const item of EXAM) {
      results.push(await runItem(item, seed));
    }
  }
  const sections: SectionScore[] = [];
  for (const section of SECTIONS) {
    const mine = results.filter((r) => r.section === section);
    const passed = mine.filter((r) => r.passed).length;
    sections.push({
      section, passed, total: mine.length,
      rate: mine.length === 0 ? 0 : passed / mine.length,
    });
  }
  const passed = results.filter((r) => r.passed).length;
  return {
    seeds: [...seeds],
    passed,
    total: results.length,
    rate: results.length === 0 ? 0 : passed / results.length,
    sections,
    calibration: calibrate(results),
    results,
    ms: Date.now() - started,
  };
}

/* ————— التقرير ————— */

function pct(x: number): string {
  return `${Math.round(x * 100)}٪`;
}

function bar(rate: number, width = 12): string {
  const full = Math.round(rate * width);
  return '█'.repeat(full) + '·'.repeat(Math.max(0, width - full));
}

export function formatReport(report: ExamReport): string {
  const lines: string[] = [];
  lines.push('———— الامتحان المجمَّد ————');
  lines.push(`${report.total} إجابة (${EXAM.length} بنداً × ${report.seeds.length} أدمغة) في ${(report.ms / 1000).toFixed(1)} ثانية`);
  lines.push('');
  for (const s of report.sections) {
    const label = s.section.padEnd(16, ' ');
    lines.push(`${label} ${bar(s.rate)} ${String(s.passed).padStart(2)}/${s.total}  ${pct(s.rate)}`);
  }
  lines.push('');
  lines.push(`المجموع: ${report.passed}/${report.total} = ${pct(report.rate)}`);

  /* الساقط: البند ولماذا هو في الورقة، فيُقرأ السقوط لا يُعدّ */
  const failedIds = new Map<string, ItemResult[]>();
  for (const r of report.results) {
    if (r.passed) continue;
    const list = failedIds.get(r.id) ?? [];
    list.push(r);
    failedIds.set(r.id, list);
  }
  if (failedIds.size > 0) {
    lines.push('');
    lines.push(`———— الساقط (${failedIds.size} بنداً) ————`);
    for (const [id, list] of failedIds) {
      const first = list[0];
      if (!first) continue;
      lines.push(`  ${id} (${list.length}/${report.seeds.length}) — ${first.why}`);
      lines.push(`    سُئل: ${first.ask}`);
      lines.push(`    قال: ${first.said}`);
      lines.push(`    ${first.reason}`);
    }
  }

  /* المعايرة: هل ٠٫٧ تعني سبعين بالمئة؟ */
  const cal = report.calibration;
  lines.push('');
  lines.push('———— المعايرة ————');
  lines.push(`${cal.asserted} جملة جزم بها، أصاب منها ${cal.correct}`);
  if (cal.buckets.length === 0) {
    lines.push('  لا جزمَ يُقاس');
  } else {
    /* السؤال الأسبق: أيتغيّر رقمه أصلاً؟ رقمٌ ثابت لا يُعايَر ولا يُرجَّح به. */
    lines.push(`  المدى ${cal.lowest.toFixed(2)}–${cal.highest.toFixed(2)}، الانحراف ${cal.spread.toFixed(3)}، خاناتٌ مسكونة ${cal.buckets.length}/${BUCKETS}`);
    if (Number.isNaN(cal.separation)) {
      lines.push('  لم يخطئ في جزمه، فلا يُقاس فصلُه بين صوابه وخطئه');
    } else {
      lines.push(
        `  حين أصاب ${cal.meanWhenRight.toFixed(2)}، وحين أخطأ ${cal.meanWhenWrong.toFixed(2)}`
        + ` — الفصل ${cal.separation >= 0 ? '+' : '−'}${Math.abs(cal.separation).toFixed(3)}`,
      );
      lines.push(
        cal.separation > 0.05
          ? '  ورقمه يفصل صوابه عن خطئه، فيصلح ترجيحاً.'
          : '  ورقمه لا يفصل صوابه عن خطئه — فالترجيح به أسبقيةٌ مكتوبةٌ باليد في ثوبٍ عدديّ.',
      );
    }
    lines.push('');
    lines.push('  الثقة المعلنة   ←  الإصابة الفعلية   (عدد)');
    for (const b of cal.buckets) {
      const gap = b.observed - b.claimed;
      const sign = gap >= 0 ? '+' : '−';
      lines.push(
        `  ${b.claimed.toFixed(2)}          ←  ${b.observed.toFixed(2)}`
        + `           (${b.count})  ${sign}${Math.abs(gap).toFixed(2)}`,
      );
    }
    lines.push(`  فارق المعايرة: ${cal.error.toFixed(3)}`);
    lines.push(
      cal.error <= 0.1
        ? '  ثقته قريبة من احتمالٍ حقيقي.'
        : '  ثقته رقمٌ مضبوطٌ بالحدس لا احتمال — الفارق أكبر من أن يُسمّى معايرة.',
    );
  }
  return lines.join('\n');
}

/** ما يُكتب في `exam-baseline.json`: الرقم الذي تُقارَن به النسخة التالية. */
export interface Baseline {
  rate: number;
  passed: number;
  total: number;
  seeds: readonly number[];
  sections: Record<string, number>;
  calibrationError: number;
  /** تشتّت ثقته وفصلُها: يُحفظان كي يُعرَف اليوم الذي تصير فيه ثقته كميةً حقيقية */
  confidenceSpread: number;
  confidenceSeparation: number;
  /** البنود الساقطة بالاسم: كي يُرى ما تبدّل لا كم تبدّل */
  failed: readonly string[];
}

export function baselineOf(report: ExamReport): Baseline {
  const sections: Record<string, number> = {};
  for (const s of report.sections) sections[s.section] = s.passed;
  const failed = [...new Set(report.results.filter((r) => !r.passed).map((r) => r.id))].sort();
  return {
    rate: report.rate,
    passed: report.passed,
    total: report.total,
    seeds: report.seeds,
    sections,
    calibrationError: report.calibration.error,
    confidenceSpread: report.calibration.spread,
    confidenceSeparation: report.calibration.separation,
    failed,
  };
}
