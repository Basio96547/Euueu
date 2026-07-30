/* ————— الجهاز الحوفي: اللوزة والوطاء والجزيرة والحزام —————
 *
 * أربعة أعضاء صغيرة لا تفهم كلاماً ولا تُنتجه، لكنها هي التي تجعل زبير طفلاً
 * لا آلة تُجيب: تسم تجاربه بالعاطفة، وتولّد فضوله وملله وتعلّقه بأبيه، وتُعلمه
 * بحاله، وتُخبره متى لا يعرف فيسكت أو يسأل بدل أن يخترع.
 */

import { Dense, squaredLossGrad } from '../core/net.js';
import { Rng, clamp, normalizedEntropy, vec, type Vec } from '../core/tensor.js';
import { DIMS, type ComputePort, type Interoception, type Lobe } from '../core/types.js';

/* ————— اللوزة ————— */

export interface AmygdalaState {
  net: ReturnType<Dense['save']>;
}

export class Amygdala implements Lobe<AmygdalaState> {
  readonly name = 'amygdala';
  readonly ar = 'اللوزة';
  readonly role = 'تسم المعاني بمدحك وتصحيحك: ما أخطأ فيه يبقى موسوماً فيتحفّظ عنده';

  private readonly net: Dense;
  private readonly grad: Vec = vec(1);
  private readonly target: Vec = vec(1);

  constructor(rng?: Rng) {
    // خرج واحد بـ tanh: القيمة في [-1,1] وهو مدى المكافأة نفسه، فلا حاجة لأي
    // تحويل بين ما يتعلّمه وما يستقبله
    this.net = new Dense(DIMS.meaning, 1, 'tanh', rng ?? new Rng(0x1a3f));
  }

  valence(meaning: Vec, compute: ComputePort): number {
    const out = this.net.forward(meaning, compute);
    const value = out[0] ?? 0;
    return Number.isFinite(value) ? clamp(value, -1, 1) : 0;
  }

  /** اشتراط: هذا المعنى اقترن بهذه المكافأة. تكراره يُرسّخ الوسم. */
  condition(meaning: Vec, reward: number, lr = 0.05): void {
    if (!Number.isFinite(reward)) return;
    const prediction = this.net.forward(meaning);
    this.target[0] = clamp(reward, -1, 1);
    squaredLossGrad(prediction, this.target, this.grad);
    this.net.backward(this.grad);
    this.net.step(lr);
  }

  save(): AmygdalaState {
    return { net: this.net.save() };
  }

  load(state: AmygdalaState): void {
    try {
      if (state?.net) this.net.load(state.net);
    } catch { /* وسم عاطفي عطب يُترك: يبدأ محايداً */ }
  }
}

/* ————— الوطاء ————— */

export interface HypothalamusState {
  intero: Interoception;
  companionTicks: number;
  lastInput: string;
  repeats: number;
}

/** أرضية التعلّق: لا يهبط تحتها مهما طال غيابك. الطفل لا ينكر أباه. */
const ATTACHMENT_FLOOR = 0.25;

export class Hypothalamus implements Lobe<HypothalamusState> {
  readonly name = 'hypothalamus';
  readonly ar = 'الوطاء';
  readonly role = 'دوافعه: فضول وملل وتعب، وتعلّق بك يهبط بغيابك ولا ينكرك أبداً';

  private intero: Interoception = {
    arousal: 1, fatigue: 0, curiosity: 0.5, attachment: 0.3, boredom: 0, confidence: 0.1,
  };
  private companionTicks = 0;
  private repeats = 0;

  get state(): Interoception {
    return this.intero;
  }

  update(input: {
    unknownCount: number;
    repeatedInput: boolean;
    awayMs: number;
    lessonsSinceSleep: number;
    knownVocab: number;
  }): Interoception {
    const unknown = safe(input.unknownCount, 0);
    const away = safe(input.awayMs, 0);
    const sinceSleep = safe(input.lessonsSinceSleep, 0);
    const vocab = safe(input.knownVocab, 0);

    this.companionTicks++;

    /* الفضول من الجهل الحاضر لا من العشوائية: كلمة مجهولة أمامه ترفعه، وجملة
     * كلّها معروفة تُهدئه. لو كان عشوائياً لصار سؤاله ضجيجاً لا تعلّماً. */
    const curiosityTarget = unknown === 0 ? 0.15 : clamp(0.35 + 0.2 * unknown, 0, 1);
    this.intero.curiosity = approach(this.intero.curiosity, curiosityTarget, 0.5);

    /* الملل من تكرارك أنت: الطفل يملّ من إعادة الشيء نفسه، والملل يدفعه
     * للتجريب (يرفع حرارة قراره) فيخرج من العادة. */
    if (input.repeatedInput) this.repeats++;
    else this.repeats = 0;
    this.intero.boredom = clamp(1 - 1 / (1 + this.repeats * 0.6), 0, 1);

    /* التعب من التعلّم بلا تثبيت: عشرون درساً بلا نوم تُتعبه، فيطلب النوم.
     * ليس تعباً حقيقياً بل مؤشّر على ذكريات كثيرة لم تُثبَّت بعد. */
    this.intero.fatigue = clamp(sinceSleep / 20, 0, 1);

    /* التعلّق يرتفع بطول الصحبة ويهبط بالغياب — يوم غياب يخفضه بمقدار محسوس،
     * لكنه لا يهبط تحت الأرضية أبداً. */
    const days = away / (24 * 60 * 60 * 1000);
    const grown = clamp(0.3 + this.companionTicks / 400, 0, 1);
    const decayed = days > 0 ? grown * Math.exp(-days / 30) : grown;
    this.intero.attachment = clamp(Math.max(ATTACHMENT_FLOOR, decayed), 0, 1);

    /* الثقة من حجم ما يعرف: وليد بلا مفردات لا يثق بكلامه، ومن عرف مئات
     * الكلمات يجيب بثقة. تشبّع لوغاريتمي فلا تصل واحداً أبداً. */
    this.intero.confidence = clamp(Math.log10(1 + vocab) / 3, 0, 0.95);

    // اليقظة يملكها جذع الدماغ، والوطاء يستهلكها قليلاً بالتعب
    this.intero.arousal = clamp(1 - 0.4 * this.intero.fatigue, 0.2, 1);

    return this.intero;
  }

  onSleep(): void {
    this.intero.fatigue = 0;
    this.intero.arousal = 1;
    this.intero.boredom = 0;
    this.repeats = 0;
  }

  save(): HypothalamusState {
    return {
      intero: { ...this.intero },
      companionTicks: this.companionTicks,
      lastInput: '',
      repeats: this.repeats,
    };
  }

  load(state: HypothalamusState): void {
    try {
      if (!state || typeof state !== 'object') return;
      if (state.intero && typeof state.intero === 'object') {
        for (const key of Object.keys(this.intero) as Array<keyof Interoception>) {
          const value = state.intero[key];
          if (typeof value === 'number' && Number.isFinite(value)) this.intero[key] = clamp(value, 0, 1);
        }
      }
      if (typeof state.companionTicks === 'number' && Number.isFinite(state.companionTicks)) {
        this.companionTicks = Math.max(0, Math.floor(state.companionTicks));
      }
      if (typeof state.repeats === 'number' && Number.isFinite(state.repeats)) {
        this.repeats = Math.max(0, Math.floor(state.repeats));
      }
    } catch { /* دوافع عطبة تُترك على حالها الابتدائية */ }
  }
}

/* ————— الجزيرة ————— */

export interface InsulaState {
  said: string[];
}

/** ترتيب أبعاد متجه الحالة الداخلية. معلن وثابت لأن أوزان العُقد القاعدية
 *  تتعلّم عليه: تغييره بعد أن يتعلّم زبير يُفسد كل ما تعلّمه. */
export const INSULA_ORDER = ['arousal', 'fatigue', 'curiosity', 'attachment', 'boredom', 'confidence'] as const;

export class Insula implements Lobe<InsulaState> {
  readonly name = 'insula';
  readonly ar = 'الجزيرة';
  readonly role = 'يعرف حاله من داخله: أنه تعب، أو أنه صار يعرف كثيراً — فيقولها لك';

  private readonly buffer: Vec = vec(INSULA_ORDER.length);
  /** ما قاله عن حاله سابقاً: لا يُكرّر الشكوى نفسها في كل نبضة */
  private said: string[] = [];

  encode(intero: Interoception): Vec {
    for (let i = 0; i < INSULA_ORDER.length; i++) {
      const key = INSULA_ORDER[i]!;
      this.buffer[i] = clamp(safe(intero[key], 0), 0, 1);
    }
    return this.buffer;
  }

  /** عبارة عن حاله — عند تجاوز عتبة فقط. طفل يتشكّى في كل نبضة مُزعج لا صادق. */
  express(intero: Interoception): string | null {
    if (safe(intero.fatigue, 0) > 0.85 && !this.recentlySaid('تعبت')) {
      this.remember('تعبت');
      return 'تعبت، خلّينا ننام شوي';
    }
    if (safe(intero.confidence, 0) > 0.7 && !this.recentlySaid('اعرف')) {
      this.remember('اعرف');
      return 'صرت أعرف كلمات كثيرة';
    }
    if (safe(intero.attachment, 0) <= ATTACHMENT_FLOOR + 0.01 && !this.recentlySaid('غبت')) {
      this.remember('غبت');
      return 'غبت عني كثير';
    }
    return null;
  }

  private recentlySaid(tag: string): boolean {
    return this.said.slice(-3).includes(tag);
  }

  private remember(tag: string): void {
    this.said.push(tag);
    if (this.said.length > 12) this.said = this.said.slice(-12);
  }

  save(): InsulaState {
    return { said: [...this.said] };
  }

  load(state: InsulaState): void {
    try {
      if (Array.isArray(state?.said)) this.said = state.said.filter((s) => typeof s === 'string').slice(-12);
    } catch { /* لا شيء يُفقد إن ضاع سجل شكواه */ }
  }
}

/* ————— الحزام الحوفي ————— */

export interface CingulateState {
  peak: number;
}

export class Cingulate implements Lobe<CingulateState> {
  readonly name = 'cingulate';
  readonly ar = 'الحزام الحوفي';
  readonly role = 'يقيس: هل أنا متأكّد أصلاً؟ وبه يقول «لا أعرف» بدل أن يخترع';

  private peak = 0;

  /**
   * التعارض مزيج معلن من أربعة مصادر، بأوزان مجموعها واحد:
   *   ٠٫٤٠ إنتروبيا القصد — لم يفهم ماذا يُراد منه
   *   ٠٫٣٠ ضعف الاستدعاء — لم يجد في ذكرياته شبيهاً
   *   ٠٫٢٠ ضعف ثقة الحقيقة — يعرف شيئاً لكنه غير واثق منه
   *   ٠٫١٠ سلبية الوسم — تجربته السابقة بهذا المعنى كانت خطأ
   * الوزن الأكبر للفهم لأن من لم يفهم السؤال لا ينفعه أن يملك جواباً.
   */
  conflict(input: {
    intentProbs: Vec;
    recallScore: number;
    factConfidence: number;
    valence: number;
  }): { level: number; reason: string } {
    const confusion = input.intentProbs?.length ? normalizedEntropy(input.intentProbs) : 1;
    const unfamiliar = 1 - clamp(safe(input.recallScore, 0), 0, 1);
    const unsure = 1 - clamp(safe(input.factConfidence, 0), 0, 1);
    const negative = clamp(-safe(input.valence, 0), 0, 1);

    const parts: Array<[number, string]> = [
      [0.4 * confusion, 'لم يفهم ماذا تريد منه'],
      [0.3 * unfamiliar, 'لم يجد في ذكرياته شبيهاً'],
      [0.2 * unsure, 'لا يثق بما يعرفه عن هذا'],
      [0.1 * negative, 'تجربته السابقة بهذا كانت خطأ'],
    ];

    let level = 0;
    let strongest = parts[0]!;
    for (const part of parts) {
      level += part[0];
      if (part[0] > strongest[0]) strongest = part;
    }
    level = clamp(level, 0, 1);
    if (level > this.peak) this.peak = level;

    return { level, reason: strongest[1] };
  }

  save(): CingulateState {
    return { peak: this.peak };
  }

  load(state: CingulateState): void {
    try {
      if (typeof state?.peak === 'number' && Number.isFinite(state.peak)) this.peak = clamp(state.peak, 0, 1);
    } catch { /* لا أثر */ }
  }
}

function safe(value: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** تقارب نسبي نحو هدف: أنعم من القفز، وأسرع من الجمع الثابت. */
function approach(current: number, target: number, rate: number): number {
  const from = safe(current, 0);
  return clamp(from + (safe(target, 0) - from) * clamp(rate, 0, 1), 0, 1);
}
