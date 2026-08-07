/* ————— الحَكَم —————
 *
 * أصغرُ فصٍّ في الدماغ، وهذا مقصود. فبعد جدول الملكية لم يبقَ متنازعٌ فيه:
 * لكل طلبٍ مالكٌ واحد، ولا دعويين تتنافسان حتى يُرجَّح بينهما. فما بقي للحَكَم
 * أمران لا ثالث لهما:
 *
 *  ١) **حالة «لا أعرف ماذا تريد»** — صفُّ الملتبس. وجوابُه سؤالٌ يستوضح، لا
 *     ترجيحٌ بين تأويلات. فالتأويلات هنا ليست دعاوى لأحدها سندٌ أقوى، بل
 *     قراءاتٌ لجملةٍ واحدة، والأب وحده يعرف أيّها أراد. ولو بُني هنا مرجِّحٌ
 *     معقّد لكانت آلةً في غير موضعها.
 *
 *  ٢) **السجلّ**. وهو أنفع ما فيه على المدى: كل مراجعةٍ تُكتب — ما الطلب، ومن
 *     مالكه، وبأي رتبةٍ جاء، وماذا فعلت المراجعة، **وماذا فعل الأب بعدها**.
 *     فبعد شهرٍ يُقرأ السجلّ فيُعرَف إن كانت القاعدة صائبة. وربما تُعلَّم بدل
 *     أن تُكتب.
 *
 * ولا يقرّر هذا الفص شيئاً بنفسه: قواعد المراجعة في `core/review.ts` دالّاتٌ
 * صافية تُختبَر وحدها. وهذا يكتب ويعدّ.
 */

import type { Lobe } from '../core/types.js';
import type { Request } from '../core/ownership.js';
import type { Action, Rank } from '../core/review.js';

export interface Arbitration {
  tick: number;
  request: Request;
  /** الفصّ المالك كما في الجدول */
  owner: string;
  rank: Rank;
  action: Action;
  why: string;
  /** ما قاله بعد المراجعة، مقصوصاً */
  said: string;
  /** وماذا فعل الأب بعدها: مدحٌ أو تصحيح أو لا شيء — يُلحَق لاحقاً */
  fatherSaid: 'praise' | 'correct' | null;
}

export interface ArbiterState {
  log: Arbitration[];
  total: number;
}

/** طولُ السجلّ المحفوظ. مئتان تكفي شهراً من حوارٍ يومي، ولا تُثقل الحفظ. */
const KEPT = 200;

export class Arbiter implements Lobe<ArbiterState> {
  readonly name = 'arbiter';
  readonly ar = 'الحَكَم';
  readonly role = 'يستوضح حين لا يتبيّن طلبك، ويكتب سجلّ كل مراجعةٍ وما فعلتَ بعدها';

  private log: Arbitration[] = [];
  private total = 0;

  /** يُكتب قبل أن يُعرف حكم الأب؛ ويُلحَق حكمه بـ`fatherJudged`. */
  record(entry: Omit<Arbitration, 'fatherSaid'>): void {
    this.total++;
    this.log.push({ ...entry, fatherSaid: null });
    if (this.log.length > KEPT) this.log = this.log.slice(-KEPT);
  }

  /**
   * حكمُ الأب على آخر مراجعة.
   *
   * وهذا نصف قيمة السجلّ: قاعدةٌ خفّضت جواباً إلى «أظنّ» ثم مدح الأب الجواب
   * قاعدةٌ متشدّدة. وقاعدةٌ أقرّت جواباً ثم صحّحه الأب قاعدةٌ متساهلة. ولا
   * يُعرَف ذلك إلا بجمع الحكمين في سطرٍ واحد.
   */
  fatherJudged(verdict: 'praise' | 'correct'): void {
    const last = this.log[this.log.length - 1];
    if (last && last.fatherSaid === null) last.fatherSaid = verdict;
  }

  get entries(): readonly Arbitration[] {
    return this.log;
  }

  get count(): number {
    return this.total;
  }

  /**
   * حصادُ السجلّ: لكل فعلٍ من أفعال المراجعة، كم مرّةً وقع، وكم مرّةً وافقه
   * الأب بعده. وهذا هو الجدول الذي يُقرأ بعد شهر.
   */
  tally(): Array<{ action: Action; times: number; praised: number; corrected: number }> {
    const by = new Map<Action, { times: number; praised: number; corrected: number }>();
    for (const entry of this.log) {
      const row = by.get(entry.action) ?? { times: 0, praised: 0, corrected: 0 };
      row.times++;
      if (entry.fatherSaid === 'praise') row.praised++;
      if (entry.fatherSaid === 'correct') row.corrected++;
      by.set(entry.action, row);
    }
    return [...by.entries()].map(([action, row]) => ({ action, ...row }));
  }

  /** سطرٌ عربيٌّ واحد يُعرَض في التطبيق. */
  get summaryAr(): string {
    if (this.log.length === 0) return 'لم تجرِ مراجعةٌ بعد';
    const rows = this.tally();
    const parts = rows.map((r) => {
      const judged = r.praised + r.corrected;
      const agreed = judged === 0 ? '' : ` (وافقتَه ${r.praised} من ${judged})`;
      return `${r.action} ${r.times}${agreed}`;
    });
    return parts.join('، ');
  }

  save(): ArbiterState {
    return { log: this.log.map((e) => ({ ...e })), total: this.total };
  }

  load(state: ArbiterState): void {
    try {
      if (Array.isArray(state?.log)) {
        this.log = state.log
          .filter((e) => e && typeof e.request === 'string' && typeof e.action === 'string')
          .slice(-KEPT)
          .map((e) => ({ ...e, fatherSaid: e.fatherSaid ?? null }));
      }
      if (typeof state?.total === 'number' && Number.isFinite(state.total)) {
        this.total = Math.max(this.log.length, Math.floor(state.total));
      }
    } catch { /* سجلٌّ ضائع لا يُفقِد معرفةً: هذا فصُّ محاسبةٍ لا فصُّ علم */ }
  }
}
