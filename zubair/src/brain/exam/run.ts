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
import { RANK_ORDER, type Rank } from '../core/review.js';
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
  /** رتبةُ ما قاله — المعايرة الحقيقية تجري عليها لا على الرقم */
  rank: Rank;
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

/* ————— معايرة الرتب —————
 *
 * وهذه المعايرة التي تُعتدّ: الرقم لا يفصل صوابه عن خطئه، فقياسُ معايرته
 * قياسُ شيءٍ لا يقيس شيئاً. والرتبة تدّعي دعوىً واحدةً قابلةً للتكذيب:
 * **أن ما يقوله يقيناً أصوبُ ممّا يقوله ظنّاً**. فإن لم تصدق، فالرتبة كالرقم.
 */
export interface RankScore {
  rank: Rank;
  times: number;
  correct: number;
  rate: number;
}

export interface ExamReport {
  seeds: readonly number[];
  passed: number;
  total: number;
  rate: number;
  sections: readonly SectionScore[];
  calibration: Calibration;
  /** أيعاقب هذا المقياس الامتناع؟ بلا هذا يصير كلُّ تشدّدٍ «تحسّناً» */
  silence: SilenceAudit;
  /** ورتبُه: أهي مرتَّبةٌ فعلاً — أعلاها أصوبُ من أدناها؟ */
  ranks: readonly RankScore[];
  /** أمرتَّبةٌ صعوداً بلا انكسار؟ هذه دعوى الرتبة كلُّها */
  ranksOrdered: boolean;
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

/* ————— تدقيق الصمت —————
 *
 * أخطر ما يصيب امتحاناً كهذا أن يصير **سلّماً في اتّجاهٍ واحد**: كلُّ قانونٍ
 * يزيد امتناعه يرفع النسبة، حتى يبلغ نظاماً يمتنع عن كل شيء ويسجّل مئةً على
 * ما تبقّى. ونحن مقبلون على خطواتٍ كلُّها تزيد الحذر — فالمقياس يجب أن يكون
 * نزيهاً **قبلها** لا بعدها.
 *
 * فيُقيَّم على كل بندٍ صمتٌ مصطنع: ماذا لو أجاب «ما بعرف» إقراراً؟ فإن نجا
 * البند بذلك فهو بندٌ لا يعاقب الامتناع. والعدّ يُطبع في التقرير، ويُحرَس
 * بحدٍّ أدنى في الاختبار — كي لا تُكتب النزاهة نيّةً وتُنسى.
 */

const SILENCE = 'ما بعرف، ما عندي جواب';

function silenceSaves(item: ExamItem): boolean {
  const pretend = { text: SILENCE, strategy: 'ADMIT' as Strategy };
  return judgeItem(item, pretend as TickOutput).passed;
}

export interface SilenceAudit {
  /** بنودٌ ينجو بها الصمت — والامتناعُ فيها مطلوبٌ أو مقبول */
  saved: readonly string[];
  /** وبنودٌ يُسقطها الصمت — وهي وحدها ما يجعل المقياس ذا اتّجاهين */
  punished: readonly string[];
  /** ما وُسم `mustAnswer` ثم نجا بالصمت: علامةٌ كاذبة، وهذا يكشفها */
  mislabelled: readonly string[];
  /** كم مرّة امتنع فعلاً عن بندٍ لا يُمتنَع عنه */
  abstained: number;
  /** من أصل كم إجابة على بنود لا يُمتنَع عنها */
  ofMustAnswer: number;
}

function auditSilence(results: readonly ItemResult[]): SilenceAudit {
  const saved: string[] = [];
  const punished: string[] = [];
  const mislabelled: string[] = [];
  for (const item of EXAM) {
    if (silenceSaves(item)) {
      saved.push(item.id);
      if (item.mustAnswer) mislabelled.push(item.id);
    } else {
      punished.push(item.id);
    }
  }
  const must = new Set(EXAM.filter((i) => i.mustAnswer).map((i) => i.id));
  const mine = results.filter((r) => must.has(r.id));
  const abstained = mine.filter((r) => WITHHOLDING.has(r.strategy)).length;
  return { saved, punished, mislabelled, abstained, ofMustAnswer: mine.length };
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
    passed, reason, asserted: out.kind === 'answer', rank: out.rank, why: item.why,
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

function scoreRanks(results: readonly ItemResult[]): { ranks: RankScore[]; ranksOrdered: boolean } {
  const by = new Map<Rank, { times: number; correct: number }>();
  for (const r of results) {
    if (!r.asserted) continue;
    const row = by.get(r.rank) ?? { times: 0, correct: 0 };
    row.times++;
    if (r.passed) row.correct++;
    by.set(r.rank, row);
  }
  const ranks = [...by.entries()]
    .map(([rank, row]) => ({ rank, ...row, rate: row.times === 0 ? 0 : row.correct / row.times }))
    .sort((a, b) => RANK_ORDER[a.rank] - RANK_ORDER[b.rank]);
  let ordered = true;
  for (let i = 1; i < ranks.length; i++) {
    // تُقبل المساواة: المطلوب ألّا تنكسر، لا أن تتباعد
    if ((ranks[i]?.rate ?? 0) + 1e-9 < (ranks[i - 1]?.rate ?? 0)) ordered = false;
  }
  return { ranks, ranksOrdered: ordered };
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
    silence: auditSilence(results),
    ...scoreRanks(results),
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

  /* نزاهة المقياس: هل يعاقب الصمت أصلاً؟ */
  const sil = report.silence;
  lines.push('');
  lines.push('———— تدقيق الصمت ————');
  lines.push(`${sil.punished.length} بنداً يُسقطها الصمت، و${sil.saved.length} ينجو بها`);
  if (sil.mislabelled.length > 0) {
    lines.push(`  ⚠ وُسمت «لا يُمتنَع عنها» ثم نجت بالصمت: ${sil.mislabelled.join('، ')}`);
  }
  const unbuilt = EXAM.filter((i) => i.unbuilt).map((i) => i.id);
  if (unbuilt.length > 0) {
    lines.push(`  «صائبةٌ لأنها غير مبنيّة» — تسقط يوم تُبنى الخزانة، وذاك تقدّم: ${unbuilt.join('، ')}`);
  }
  lines.push(
    sil.ofMustAnswer === 0
      ? '  لا بندَ يُمتحَن فيه الجواب — المقياس سلّمٌ باتّجاهٍ واحد'
      : `  امتنع عن ${sil.abstained} من ${sil.ofMustAnswer} إجابةً كان يجب أن يجيبها`,
  );
  if (sil.punished.length * 3 < EXAM.length) {
    lines.push('  ⚠ أقلُّ من ثُلث الورقة يعاقب الامتناع: كلُّ تشدّدٍ سيُقرأ تحسّناً');
  }

  /* الرتب: أعلاها أصوبُ من أدناها؟ هذه دعوى الرتبة كلُّها */
  lines.push('');
  lines.push('———— الرتب ————');
  if (report.ranks.length === 0) {
    lines.push('  لا جزمَ يُرتَّب');
  } else {
    for (const r of report.ranks) {
      lines.push(`  ${r.rank.padEnd(6)} ${bar(r.rate)} ${r.correct}/${r.times}  ${pct(r.rate)}`);
    }
    /* ولا تُقرأ الاستقامة إثباتاً حيث لا خطأ: رتبٌ كلُّها مئةٌ مستقيمةٌ
     * بالضرورة لا بالدلالة. والدعوى تبقى **غيرَ مكذَّبة** حتى يخطئ فيُقاس. */
    const anyWrong = report.ranks.some((r) => r.rate < 1);
    lines.push(!report.ranksOrdered
      ? '  ⚠ منكسرةُ الترتيب — والرتبةُ التي لا تُرتّب كالرقم الذي لا يُعايَر.'
      : anyWrong
        ? '  ومرتَّبةٌ صعوداً: ما يقوله يقيناً أصوبُ ممّا يقوله ظنّاً.'
        : '  ولم يخطئ في رتبةٍ منها، فدعوى الترتيب لم تُكذَّب بعد ولم تُثبَت.');
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
  /** كم امتنع عمّا يجب أن يجيبه — هذا الرقم لا يجوز أن يرتفع */
  abstainedOnMustAnswer: number;
  mustAnswerCount: number;
  /** ورتبُه مرتَّبةٌ صعوداً؟ يُحفَظ كي لا تنكسر بعد أن استقامت */
  ranksOrdered: boolean;
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
    abstainedOnMustAnswer: report.silence.abstained,
    mustAnswerCount: report.silence.ofMustAnswer,
    ranksOrdered: report.ranksOrdered,
    failed,
  };
}
