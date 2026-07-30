/* ————— الحُصين: الذاكرة العرضية —————
 *
 * كل ما يقوله الأب يُحفظ هنا حرفياً في اللحظة، لأن درساً واحداً يجب أن يكفي ليعرف.
 * الفهم يأتي بعدها في النوم، حين يُعاد هذا الحفظ على بقية الفصوص فيتحوّل إلى بنية.
 *
 * ثلاثة قرارات بنيوية هي التي تحدّد إن كان هذا الفص سريعاً أم عبئاً:
 *
 * ١) المفاتيح في `Float32Array` واحد متّصل (سعة × بُعد المعنى) لا في مصفوفة
 *    مصفوفات. البحث يمرّ على أربعة آلاف ذكرى في كل نبضة، ومصفوفة مصفوفات تعني
 *    أربعة آلاف قفزة متباعدة في الذاكرة؛ والمعالج العصبي لا يستلم إلا كتلة
 *    متّصلة أصلاً، فأي بنية أخرى تعني نسخاً كاملاً قبل كل بحث.
 *
 * ٢) المفتاح يُخزَّن مُسوّى الطول. فيصير التشابه الجيبي ضرباً داخلياً مباشراً بلا
 *    قسمة ولا جذر تربيعي في كل مقارنة — وأربعة آلاف جذر في النبضة فرق محسوس على
 *    جوال متوسط. ونُسوّي متجه الاستفهام كذلك، فتتساوى النتيجة سواء نفّذ منفذ
 *    الحساب ضرباً داخلياً عارياً أم تشابهاً جيبياً كاملاً: سلوك الحُصين لا يتغيّر
 *    باختلاف المسرّع تحته، وهذا شرط أن يكون الدماغ نفسه على كل جهاز.
 *
 * ٣) فهرس الذكرى في المصفوفة هو نفسه رقم شقّها في كتلة المفاتيح. كل حذف ملزَم
 *    بحفظ هذا التقابل، وإلا استُدعيت ذكرى بمفتاح ذكرى أخرى — وهو عطب لا يظهر في
 *    الاختبار السطحي بل يظهر بعد أشهر على شكل جواب لا علاقة له بالسؤال.
 */

import { clamp, type Rng, type Vec } from '../core/tensor.js';
import { DIMS, INTENTS, type Accelerator, type ComputePort, type Episode, type Lobe } from '../core/types.js';

/** بُعد المعنى — يُثبَّت في ثابت محلّي لأنه يدخل كل حساب عنوان في كتلة المفاتيح. */
const D = DIMS.meaning;

/* ————— أوزان أولوية الإعادة في النوم —————
 *
 * الشرط الذي بُنيت عليه هذه الأرقام: وزن الخطأ وحده (٤) أكبر من مجموع أقصى ما
 * تعطيه الحداثة والطرافة (١٫٥ + ١). أي أن ذكرى أخطأ فيها تسبق دائماً ذكرى أصاب
 * فيها، مهما كانت الثانية أحدث وأقلّ إعادة. هذا مقصود: النوم عند الدماغ الحقيقي
 * ليس مراجعة متساوية للماضي بل إعادة مكثّفة لما لم يُتقَن.
 */
const REPLAY_ERROR = 4;
const REPLAY_RECENCY = 1.5;
const REPLAY_NOVELTY = 1;

export interface Recall {
  episodes: Episode[];
  scores: number[];
  best: Episode | null;
  bestScore: number;
}

export interface HippocampusState {
  capacity: number;
  /** بُعد المعنى وقت الحفظ — به يُرفض دماغ حُفظ بأبعاد أخرى بدل أن يُقرأ خطأً */
  meaningDim: number;
  nextId: number;
  episodes: Episode[];
}

/**
 * يكتب متجهاً مُسوّى الطول في `out` بدءاً من `offset` بطول `dim` بالضبط.
 *
 * هذه هي البوابة الوحيدة التي تدخل بها الأرقام كتلة المفاتيح، ولذلك كل الحراسات
 * مجموعة فيها: طول مختلف، وقيمة غير منتهية، ومتجه صفري. متجه واحد فيه NaN لا
 * يُفسد مقارنته وحدها بل يُفسد ترتيب الذكريات كلها.
 */
function writeUnit(src: readonly number[] | Vec, out: Float32Array, offset: number, dim: number): void {
  const n = Math.min(dim, src.length);
  let square = 0;
  for (let i = 0; i < n; i++) {
    const raw = src[i]!;
    const value = Number.isFinite(raw) ? raw : 0;
    out[offset + i] = value;
    square += value * value;
  }
  // معنى أقصر من البُعد يُكمَّل أصفاراً: الأصفار لا تُسهم في الضرب الداخلي فلا تُحرّف التشابه
  for (let i = n; i < dim; i++) out[offset + i] = 0;
  if (square === 0) return; // متجه صفري لا اتجاه له، وتسويته قسمة على صفر
  const inverse = 1 / Math.sqrt(square);
  for (let i = 0; i < dim; i++) out[offset + i]! *= inverse;
}

/** مكافأة غير منتهية تجعل قيمة البقاء NaN فيصير النسيان اعتباطياً — تُصفَّر بلا ضجيج. */
function saneReward(reward: number): number {
  return Number.isFinite(reward) ? clamp(reward, -1, 1) : 0;
}

function saneNumber(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function asText(value: string | null): string | null {
  return typeof value === 'string' ? value : null;
}

export class Hippocampus implements Lobe<HippocampusState> {
  readonly name = 'hippocampus';
  readonly ar = 'الحُصين';
  readonly role = 'يحفظ كل درس كذكرى كاملة، ويستدعي أشبهها بما تقوله الآن، ويُعيدها في النوم';

  private readonly capacity: number;
  /** كتلة المفاتيح كاملة السعة، تُملأ تدريجياً — الحجز مرة واحدة يمنع نسخ الكتلة كلما كبرت */
  private readonly keys: Float32Array;
  /** متجه الاستفهام المُسوّى، مخزن ثابت كي لا تُخصَّص ذاكرة في كل نبضة */
  private readonly query: Float32Array;
  private episodes: Episode[] = [];
  private nextId = 1;

  /**
   * السعة قابلة للحقن كي يُختبر النسيان بأربع ذكريات لا بأربعة آلاف، والافتراضي
   * هو `DIMS.episodes` كما في العقد.
   */
  constructor(capacity: number = DIMS.episodes) {
    this.capacity = Math.max(1, Math.floor(saneNumber(capacity, DIMS.episodes)));
    this.keys = new Float32Array(this.capacity * D);
    this.query = new Float32Array(D);
  }

  get count(): number {
    return this.episodes.length;
  }

  get all(): readonly Episode[] {
    return this.episodes;
  }

  store(e: Omit<Episode, 'id' | 'replays'>): Episode {
    if (this.episodes.length >= this.capacity) this.forgetWeakest();

    const slot = this.episodes.length;
    writeUnit(e.meaning, this.keys, slot * D, D);

    // تُنسَخ المصفوفتان لا تُشار إليهما: المُوصِل يمرّر عادةً مخزناً يُعاد استخدامه
    // في النبضة التالية، والإشارة إليه تعني ذكرى تتغيّر بعد أن حُفظت
    const episode: Episode = {
      id: this.nextId++,
      said: e.said,
      tokens: e.tokens.slice(),
      meaning: Array.from(e.meaning),
      intent: e.intent,
      subject: e.subject,
      object: e.object,
      replied: e.replied,
      reward: saneReward(e.reward),
      tick: saneNumber(e.tick, 0),
      replays: 0,
    };
    this.episodes.push(episode);
    return episode;
  }

  recall(meaning: Vec, k: number, compute: ComputePort): Recall {
    if (this.episodes.length === 0) return emptyRecall();
    writeUnit(meaning, this.query, 0, D);
    const scores = compute.similarities(this.query, this.keys, this.episodes.length, D);
    return this.rank(scores, k);
  }

  /** الطريق نفسه عبر المسرّع: مقارنة معنى واحد بكل الذكريات هي العملية الوحيدة
   *  التي تستحقّ المعالج العصبي فعلاً، ولذلك هي وحدها غير متزامنة. */
  async recallFast(meaning: Vec, k: number, accel: Accelerator): Promise<Recall> {
    if (this.episodes.length === 0) return emptyRecall();
    writeUnit(meaning, this.query, 0, D);
    const scores = await accel.similarities(this.query, this.keys, this.episodes.length, D);
    return this.rank(scores, k);
  }

  annotate(tick: number, replied: string | null, reward: number): Episode | null {
    // البحث من الأحدث: حكم الأب يقع على نبضة قريبة، ولو تكرّرت النبضة فالمقصودة
    // هي الأخيرة لا الأولى
    for (let i = this.episodes.length - 1; i >= 0; i--) {
      const episode = this.episodes[i]!;
      if (episode.tick === tick) {
        episode.replied = replied;
        episode.reward = saneReward(reward);
        return episode;
      }
    }
    return null;
  }

  replayBatch(count: number, rng: Rng): Episode[] {
    const wanted = Math.max(0, Math.floor(saneNumber(count, 0)));
    const n = this.episodes.length;
    if (wanted === 0 || n === 0) return [];

    const out: Episode[] = [];
    const weights = new Float64Array(n);

    for (let draw = 0; draw < wanted; draw++) {
      // تُحسب الأوزان في كل سحبة لا مرة واحدة قبل الحلقة: كل إعادة تُنقص أولوية ما
      // أُعيد، فتتوزّع دورة النوم على ذكريات مختلفة بدل أن تُعيد الأقوى مراراً.
      // الكلفة (عدد الإعادات × عدد الذكريات) مقبولة لأن النوم ليس مسار نبضة.
      const { min, span } = this.tickSpan();
      let total = 0;
      for (let i = 0; i < n; i++) {
        const episode = this.episodes[i]!;
        const recency = (episode.tick - min) / span;
        const weight =
          1 +
          REPLAY_ERROR * Math.max(0, -episode.reward) +
          REPLAY_RECENCY * recency +
          REPLAY_NOVELTY / (1 + episode.replays);
        weights[i] = weight;
        total += weight;
      }

      // الاختيار المرجّح بالمرور على المجموع التراكمي؛ الافتراضي الأخير يحمي من
      // خطأ التقريب حين يقع الحدّ على المجموع بالضبط
      let mark = rng.next() * total;
      let picked = n - 1;
      for (let i = 0; i < n; i++) {
        mark -= weights[i]!;
        if (mark <= 0) {
          picked = i;
          break;
        }
      }

      const episode = this.episodes[picked]!;
      episode.replays++;
      out.push(episode);
    }

    return out;
  }

  save(): HippocampusState {
    return {
      capacity: this.capacity,
      meaningDim: D,
      nextId: this.nextId,
      // نسخ صريح: لقطة الحفظ لا يجوز أن تتغيّر لو تعلّم زبير شيئاً قبل أن تُكتب
      episodes: this.episodes.map((e) => ({
        ...e,
        tokens: [...e.tokens],
        meaning: [...e.meaning],
      })),
    };
  }

  load(state: HippocampusState): void {
    let restored: Episode[] | null = null;
    let nextId = 1;

    try {
      if (!state) return;
      // بُعد معنى مختلف يعني دماغاً بُنِيَ بأبعاد أخرى: مفاتيحه لا تُقارَن بمفاتيحنا
      // فتُتجاهل الحالة كلها ويُبقى على التهيئة
      if (state.meaningDim !== D) return;
      const saved = state.episodes;
      if (!Array.isArray(saved)) return;

      const kept: Episode[] = [];
      for (const raw of saved) {
        if (!raw) continue;
        const meaning = raw.meaning;
        if (!Array.isArray(meaning) || meaning.length !== D) continue; // ذكرى بأبعاد غريبة تُترك بصمت
        const id = Math.floor(saneNumber(raw.id, 0));
        kept.push({
          id: id > 0 ? id : kept.length + 1,
          said: typeof raw.said === 'string' ? raw.said : '',
          tokens: Array.isArray(raw.tokens) ? raw.tokens.filter((t) => typeof t === 'string') : [],
          meaning: meaning.map((v) => saneNumber(v, 0)),
          intent: INTENTS.includes(raw.intent) ? raw.intent : 'UNKNOWN',
          subject: asText(raw.subject),
          object: asText(raw.object),
          replied: asText(raw.replied),
          reward: saneReward(raw.reward),
          tick: saneNumber(raw.tick, 0),
          replays: Math.max(0, Math.floor(saneNumber(raw.replays, 0))),
        });
      }

      // دماغ محفوظ بسعة أكبر من سعة هذه النسخة: نُبقي الأحدث لأن الأقدم هو ما
      // كان سيُنسى أولاً على أي حال
      restored = kept.length > this.capacity ? kept.slice(kept.length - this.capacity) : kept;
      for (const episode of restored) nextId = Math.max(nextId, episode.id + 1);
      nextId = Math.max(nextId, Math.floor(saneNumber(state.nextId, 1)));
    } catch {
      // حالة معطوبة بأي شكل لم نتوقّعه: الاستثناء هنا يعني فقدان دماغ زبير كله،
      // فنُبقيه كما هو ونصمت
      restored = null;
    }

    if (!restored) return;

    // الالتزام دفعة واحدة بعد نجاح القراءة كلها: حالة نصف محمّلة أسوأ من حالة لم تُحمّل
    this.keys.fill(0);
    this.episodes = restored;
    for (let i = 0; i < restored.length; i++) writeUnit(restored[i]!.meaning, this.keys, i * D, D);
    this.nextId = nextId;
  }

  /** أعلى `k` تشابهاً مرتّبةً تنازلياً. */
  private rank(scores: Vec, k: number): Recall {
    const n = Math.min(this.episodes.length, scores.length);
    const want = Math.min(n, Math.max(0, Math.floor(saneNumber(k, 0))));
    if (want === 0) return emptyRecall();

    // إدخال في قائمة محدودة بـ k بدل فرز الأربعة آلاف: الكلفة (n × k) وk هنا
    // آحاد، فهي أرخص بمراتب من فرز كامل في كل نبضة
    const topIndex: number[] = [];
    const topScore: number[] = [];
    for (let i = 0; i < n; i++) {
      const raw = scores[i]!;
      // NaN من مسرّع خارجي لا يجوز أن يتصدّر الترتيب، فيُدفَع إلى القاع
      const score = Number.isFinite(raw) ? raw : -Infinity;
      if (topIndex.length === want && score <= topScore[want - 1]!) continue;
      let p = topIndex.length === want ? want - 1 : topIndex.length;
      topIndex[p] = i;
      topScore[p] = score;
      while (p > 0 && topScore[p - 1]! < topScore[p]!) {
        const index = topIndex[p - 1]!;
        topIndex[p - 1] = topIndex[p]!;
        topIndex[p] = index;
        const value = topScore[p - 1]!;
        topScore[p - 1] = topScore[p]!;
        topScore[p] = value;
        p--;
      }
    }

    const episodes = topIndex.map((i) => this.episodes[i]!);
    return {
      episodes,
      scores: topScore,
      best: episodes[0] ?? null,
      bestScore: topScore[0] ?? 0,
    };
  }

  /**
   * النسيان الانتقائي: قيمة البقاء = |المكافأة| + عدد الإعادات + الحداثة، ويُنسى
   * الأدنى. المكافأة بقيمتها المطلقة لأن الخطأ الموسوم قيمة تعليمية كالمدح تماماً،
   * والنسيان بالأقدمية وحدها خطأ فادح: أول ما علّمه أبوه قد يكون أهمّ ما علّمه.
   */
  private forgetWeakest(): void {
    const n = this.episodes.length;
    if (n === 0) return;
    const { min, span } = this.tickSpan();
    let worst = 0;
    let worstValue = Infinity;
    for (let i = 0; i < n; i++) {
      const episode = this.episodes[i]!;
      const recency = (episode.tick - min) / span;
      const value = Math.abs(episode.reward) + episode.replays + recency;
      if (value < worstValue) {
        worstValue = value;
        worst = i;
      }
    }
    this.removeAt(worst);
  }

  private removeAt(index: number): void {
    const n = this.episodes.length;
    // إزاحة ذيل الكتلة بـ copyWithin (نقل كتلة واحد) لا بحلقة: تحفظ تقابل الفهرس
    // بين المصفوفة والمفاتيح، وتُبقي الترتيب الزمني كما هو فيقرأ الأب ذكرياته
    // بالترتيب الذي علّمه بها
    this.keys.copyWithin(index * D, (index + 1) * D, n * D);
    this.keys.fill(0, (n - 1) * D, n * D);
    this.episodes.splice(index, 1);
  }

  /** مدى النبضات الحاضر، ليصير عمر الذكرى نسبةً في [0,1] لا رقماً مطلقاً يكبر بلا حدّ. */
  private tickSpan(): { min: number; span: number } {
    let min = Infinity;
    let max = -Infinity;
    for (const episode of this.episodes) {
      if (episode.tick < min) min = episode.tick;
      if (episode.tick > max) max = episode.tick;
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, span: 1 };
    // ذكريات كلها في نبضة واحدة: المدى صفر، والقسمة عليه تُنتج NaN فيصير الترتيب اعتباطياً
    return { min, span: Math.max(1, max - min) };
  }
}

/** حُصين فارغ ليس خطأً بل حال الوليد: يُعاد استدعاء خالٍ لا استثناء. */
function emptyRecall(): Recall {
  return { episodes: [], scores: [], best: null, bestScore: 0 };
}
