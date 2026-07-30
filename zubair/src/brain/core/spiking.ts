/* ————— جهد الفعل: خلية نبضية تتكامل وتتسرّب وتُطلق —————
 *
 * كل ما في دماغ زبير قبل هذا الملف كان **معدّلاً**: العقدة تُخرج رقماً متّصلاً
 * يمثّل «كم تنشط»، وهو تجريدٌ لمتوسّط تردّد إطلاقها. والخلية الحقيقية لا تُخرج
 * رقماً: تُخرج نبضةً أو لا تُخرج شيئاً. تتراكم فيها الشحنة، وتتسرّب مع الزمن،
 * فإذا بلغ جهدها الحدّ انفجرت دفعةً واحدة ثم عادت إلى راحتها وامتنعت عن
 * الإطلاق حيناً مهما بلغ الدخل.
 *
 * وهذا الفرق ليس تفصيلاً رياضياً: بالتجريد المعدّلي **يضيع الزمن**. المؤثّر
 * الخافت الذي يُلحّ والمؤثّر الخافت الذي يمرّ مرّة يُعطيان الرقم نفسه، وهما عند
 * الخلية النبضية ضدّان: الأول يتراكم حتى يعبر، والثاني يتسرّب فلا يعبر أبداً.
 * ولذلك لا يوقظك ضوءٌ خافت خاطف، ويوقظك ضوءٌ خافت يُلحّ.
 *
 * ———— النموذج ————
 *
 * Leaky Integrate-and-Fire، مكتوب بحدثٍ لا بخطوة ثابتة:
 *
 *   V ← V · exp(−Δt / τ)        تسريبٌ أُسّي بمقدار ما مرّ من زمن حقيقي
 *   V ← V + I                   شحنة الحدث الواصل
 *   إن V ≥ θ:  نبضة، ثم V ← 0، ثم جموحٌ لا يُطلق فيه
 *
 * والحدثيّة مقصودة: حواسّ زبير لا تصل بمعدّل ثابت — العين ثلاثون إطاراً في
 * الثانية، وكلام أبيه مرّة في دقيقة. فلو خطونا بخطوة ثابتة لخطونا آلاف الخطوات
 * الفارغة بين كلمتين، ولو خطونا بخطوة الكلام لضاع الزمن الذي بُني هذا كلُّه
 * لأجله. والتسريب بالزمن الحقيقي يُعطي الأمرين معاً بحساب واحد.
 */

export interface LifParams {
  /** ثابت التسريب بالميلي ثانية: بعد τ يبقى نحو ٣٧٪ من الجهد */
  tauMs: number;
  /** عتبة الإطلاق. رفعها إغلاقٌ للخلية، وخفضها فتحٌ لها */
  threshold: number;
  /** جهد الراحة بعد الإطلاق */
  reset: number;
  /** الجموح بالميلي ثانية: لا تُطلق فيه مهما بلغ الدخل — به يصير للتردّد سقف */
  refractoryMs: number;
}

export const LIF_DEFAULTS: LifParams = {
  /* ٩٠٠ مث: مؤثّرٌ يتكرّر مرّتين في الثانية يتراكم، ومؤثّرٌ يتكرّر مرّة في ثوانٍ
   * يتسرّب بينهما فلا يتراكم. وهذا هو المدى الذي يعمل عليه انتباه الإنسان. */
  tauMs: 900,
  threshold: 0.08,
  reset: 0,
  /* ١٢٠ مث: أطول من جموح الخلية الحقيقية بكثير (٢ مث)، لأن «النبضة» هنا ليست
   * جهد فعلٍ واحد بل عبور مجرى حاسّة إلى قشرتها، وهو حدثٌ أبطأ بمراتب. */
  refractoryMs: 120,
};

/** أطول سجلّ إطلاقات يُحفظ — منه يُحسب التردّد، وأكثر منه لا يُقرأ أبداً. */
const HISTORY = 16;

export interface LifState {
  v: number;
  threshold: number;
  lastChargeAt: number;
  lastSpikeAt: number;
  spikes: number;
  recent: number[];
}

export class LifNeuron {
  private v: number;
  private threshold: number;
  /** ‎−١ يعني «لم يصلها شيء بعد»: صفرٌ لحظةٌ صالحة في الاختبارات فلا يصلح علامة */
  private lastChargeAt = -1;
  private lastSpikeAt = -1;
  private spikes = 0;
  private recent: number[] = [];

  constructor(private readonly params: LifParams = LIF_DEFAULTS) {
    this.v = params.reset;
    this.threshold = params.threshold;
  }

  /**
   * تصل الخلية شحنةٌ في لحظة. تعيد: أأطلقت الآن؟
   *
   * والدخل السالب يُقصَر إلى الصفر: هذه خلية مثيرة لا كابحة، والكبح في دماغ
   * زبير يقع برفع العتبة من فوق (انتباهه) لا بشحنةٍ سالبة من تحت.
   */
  charge(current: number, at: number): boolean {
    const now = Number.isFinite(at) ? at : (this.lastChargeAt < 0 ? 0 : this.lastChargeAt);

    if (this.lastChargeAt >= 0) {
      const dt = Math.max(0, now - this.lastChargeAt);
      // تسريب أُسّي: أطول ما مضى أكثر ما تسرّب، وبعد عشرة أضعاف τ لا يبقى شيء
      if (dt > 0) this.v *= Math.exp(-dt / Math.max(1, this.params.tauMs));
    } else {
      this.v = this.params.reset;
    }
    this.lastChargeAt = now;

    const input = Number.isFinite(current) ? Math.max(0, current) : 0;

    // الجموح: الشحنة تصل ولا تُخزَّن. هذا ما يمنع مؤثّراً ثابتاً من إغراق القشرة
    if (this.lastSpikeAt >= 0 && now - this.lastSpikeAt < this.params.refractoryMs) {
      this.v = this.params.reset;
      return false;
    }

    this.v += input;
    if (this.v < this.threshold) return false;

    this.v = this.params.reset;
    this.lastSpikeAt = now;
    this.spikes++;
    this.recent.push(now);
    if (this.recent.length > HISTORY) this.recent = this.recent.slice(-HISTORY);
    return true;
  }

  /** تسريبٌ إلى لحظة بلا شحنة: قراءة الجهد الآن بعد أن مرّ زمنٌ فارغ. */
  leakTo(at: number): number {
    if (this.lastChargeAt < 0 || !Number.isFinite(at)) return this.v;
    const dt = Math.max(0, at - this.lastChargeAt);
    if (dt > 0) {
      this.v *= Math.exp(-dt / Math.max(1, this.params.tauMs));
      this.lastChargeAt = at;
    }
    return this.v;
  }

  /** أأطلقت في النافذة الأخيرة؟ هذا ما تقرؤه القشرة، لا الجهد نفسه. */
  firedWithin(at: number, windowMs: number): boolean {
    if (this.lastSpikeAt < 0) return false;
    if (!Number.isFinite(at)) return true;
    return at - this.lastSpikeAt <= Math.max(0, windowMs);
  }

  /** تردّد الإطلاق بالهرتز في نافذة — وهو **قوّة** الإشارة في ترميز التردّد. */
  rateHz(at: number, windowMs: number): number {
    const window = Math.max(1, windowMs);
    if (!Number.isFinite(at)) return 0;
    let count = 0;
    for (const stamp of this.recent) if (at - stamp <= window) count++;
    return count / (window / 1000);
  }

  /** رفع العتبة إغلاقٌ من فوق: هكذا يُغلق المهاد حاسّةً في النوم. */
  setThreshold(value: number): void {
    if (Number.isFinite(value)) this.threshold = Math.max(1e-4, value);
  }

  get potential(): number {
    return this.v;
  }

  get thresholdNow(): number {
    return this.threshold;
  }

  get spikeCount(): number {
    return this.spikes;
  }

  /** كم يحتاج الآن ليعبر: صفرٌ يعني أن أيّ شحنة تُطلقه. */
  get gapToFire(): number {
    return Math.max(0, this.threshold - this.v);
  }

  save(): LifState {
    return {
      v: this.v,
      threshold: this.threshold,
      lastChargeAt: this.lastChargeAt,
      lastSpikeAt: this.lastSpikeAt,
      spikes: this.spikes,
      recent: [...this.recent],
    };
  }

  load(state: LifState): void {
    if (!state || typeof state !== 'object') return;
    if (Number.isFinite(state.v)) this.v = Math.max(0, state.v);
    if (Number.isFinite(state.threshold)) this.threshold = Math.max(1e-4, state.threshold);
    if (Number.isFinite(state.lastChargeAt)) this.lastChargeAt = state.lastChargeAt;
    if (Number.isFinite(state.lastSpikeAt)) this.lastSpikeAt = state.lastSpikeAt;
    if (Number.isFinite(state.spikes)) this.spikes = Math.max(0, Math.floor(state.spikes));
    if (Array.isArray(state.recent)) {
      this.recent = state.recent.filter((x) => Number.isFinite(x)).slice(-HISTORY);
    }
  }
}

/**
 * طبقة نبضية: خلايا مستقلّة تُشحن كلٌّ بمجراها وتُقرأ معاً.
 *
 * وخرجها متجهٌ من صفر وواحد لا من كسور — وهذا هو الفرق كلُّه. القشرة التي
 * تستقبله لا تسأل «كم قوّة هذا المجرى» بل «أوصل أم لم يصل».
 */
export class LifLayer {
  private readonly cells: LifNeuron[] = [];

  constructor(size: number, params: LifParams = LIF_DEFAULTS) {
    for (let i = 0; i < Math.max(0, size); i++) this.cells.push(new LifNeuron(params));
  }

  cell(index: number): LifNeuron | null {
    return this.cells[index] ?? null;
  }

  get size(): number {
    return this.cells.length;
  }

  /** يشحن خلية واحدة، ويعيد نبضتها. */
  charge(index: number, current: number, at: number): boolean {
    return this.cells[index]?.charge(current, at) ?? false;
  }

  /** خرج الطبقة الآن: صفرٌ أو واحد لكل خلية في النافذة المعطاة. */
  spikes(at: number, windowMs: number): number[] {
    return this.cells.map((cell) => (cell.firedWithin(at, windowMs) ? 1 : 0));
  }

  setThresholds(values: readonly number[]): void {
    for (let i = 0; i < this.cells.length; i++) {
      const value = values[i];
      if (value !== undefined) this.cells[i]!.setThreshold(value);
    }
  }

  save(): LifState[] {
    return this.cells.map((cell) => cell.save());
  }

  load(state: LifState[]): void {
    if (!Array.isArray(state)) return;
    for (let i = 0; i < this.cells.length; i++) {
      const saved = state[i];
      if (saved) this.cells[i]!.load(saved);
    }
  }
}
