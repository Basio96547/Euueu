/* ————— زبير: تجميع الدماغ —————
 *
 * هذا الملف لا يفكّر، بل يوصّل. كل الذكاء في الفصوص، وهنا يمرّ الكلام بينها
 * بالترتيب التشريحي نفسه الذي يسلكه الإدراك في دماغ حقيقي: من الجذع إلى
 * الحاسّة إلى المهاد إلى القشرة إلى الحوفي إلى الجبهي إلى الكلام.
 *
 * قاعدة حاكمة: هذا الملف لا يحتوي قاعدة تعلّم واحدة ولا عتبة قرار. لو وجدت
 * نفسك تكتب هنا منطقاً معرفياً فذاك دليل أن فصاً ناقص. الفصل ليس ترتيباً
 * جمالياً: به يبقى كل فص قابلاً للاستبدال وحده، وبه يُعرف أي فص أخطأ.
 */

import { Rng, argmax, clamp, type Vec } from './core/tensor.js';
import { Lexicon } from './core/text.js';
import { bestAccelerator, cpuCompute } from './core/npu.js';
import { browserStorage, memoryStorage } from './core/persist.js';
import { accuracyOf } from './core/growth.js';
import {
  HERITAGE_EPOCHS, HERITAGE_FACTS, HERITAGE_INTENTS, HERITAGE_SOURCE, HERITAGE_VERSION,
} from './core/heritage.js';
import {
  BRAIN_STATE_VERSION, DIMS, STORAGE_KEY, STRATEGIES,
  type Accelerator, type BrainState, type ComputePort, type ComputeUnit, type Episode,
  type Feedback, type GrowthMetrics, type Intent, type Strategy, type TickOutput, type TraceStep,
} from './core/types.js';
import { Brainstem } from './lobes/brainstem.js';
import { Thalamus } from './lobes/thalamus.js';
import { TemporalLobe } from './lobes/temporal.js';
import { Hippocampus } from './lobes/hippocampus.js';
import { Parietal } from './lobes/parietal.js';
import { Amygdala, Cingulate, Hypothalamus, Insula } from './lobes/limbic.js';
import { Emotion, type Feelings } from './lobes/emotion.js';
import { BasalGanglia } from './lobes/basalGanglia.js';
import { Cerebellum, GOAL_FITS, Prefrontal } from './lobes/prefrontal.js';
import { Broca } from './lobes/broca.js';
import { VisualCortex, type VisualPercept } from './lobes/visualCortex.js';
import { AuditoryCortex, type AuditoryPercept } from './lobes/auditoryCortex.js';
import { Somatosensory, type SomaticPercept } from './lobes/somatosensory.js';
import { Inferotemporal, type Recognition } from './lobes/inferotemporal.js';
import { Syntax, type RelationKind } from './lobes/syntax.js';
import { ASKS_KNOWLEDGE, instinctMaySpeak, rowOf, typeFits, voidIsFinal } from './core/ownership.js';
import {
  transduceAudio, transduceBody, transduceVision,
  type RawAudio, type RawBody, type RawFrame, type RawTouch,
} from './core/senses.js';

/** ما بقي من النبضة الأخيرة لأن حكم الأب يأتي بعدها لا معها. */
interface PendingJudgement {
  tick: number;
  said: string;
  replied: string;
  meaning: Vec;
  state: Vec;
  strategy: Strategy;
  intent: Intent;
  subject: string | null;
  object: string | null;
  /** موضوع الكلام كما تبيّن — لا طرفَ الربط وحده.
   *
   *  والفرق جوهريّ: الربط يشترط قصداً تعليمياً، فيعود فارغاً في **كل سؤال**.
   *  فكان تصحيح الأب لجوابٍ عن سؤال لا يمسّ الحقيقة التي بُني عليها الجواب:
   *  يقول له «خطأ» عشر مرات وثقته في الحقيقة الخاطئة لا تتحرّك. */
  topic: string | null;
  /** وصف ما كان يراه إن كان جوابه عن منظر — لازم لتصحيح تسميته البصرية */
  sawFeatures: Vec | null;
  /** الاسم الذي أعطاه لما رآه، إن سُئل عن منظر */
  namedFromSight: string | null;
  assertedObject: string | null;
}

export interface CreateOptions {
  storage?: import('./core/types.js').StoragePort;
  seed?: number;
  name?: string;
  accelerator?: Accelerator;
  /** لا تقرأ دماغاً محفوظاً — لميلاد جديد نظيف في الاختبارات */
  fresh?: boolean;
  /**
   * يورَّث عربيةَ محيطه عند ميلاده.
   *
   * افتراضه false بقصد: الميراث خيارٌ يُطلَب لا سلوكٌ خفيّ، ولو كان افتراضياً
   * لصار كل اختبار يقيس تعلّماً وهو يقيس ميراثاً.
   */
  heritage?: boolean;
}

export interface JudgeResult {
  /** خطأ التنبؤ بالمكافأة: مقدار ما فاجأه حكمك */
  dopamine: number;
  /** ما تعلّمه من حكمك، بعبارات عربية تُعرض للأب */
  learned: string[];
}

export interface SleepResult {
  replayed: number;
  factsFormed: number;
  /** ما تغيّر فعلاً بالنوم — يُعرض للأب كي لا يكون النوم زراً بلا أثر */
  vocabBefore: number;
  vocabAfter: number;
  accuracyBefore: number;
}

export class Zubair {
  readonly name: string;

  private readonly rng: Rng;
  private readonly compute_: ComputePort;
  private accel: Accelerator;
  private readonly storage: import('./core/types.js').StoragePort;

  /* الفصوص */
  private readonly brainstem = new Brainstem();
  private readonly lexicon: Lexicon;
  private readonly thalamus: Thalamus;
  private readonly temporal: TemporalLobe;
  private readonly hippocampus = new Hippocampus();
  private readonly parietal = new Parietal();
  private readonly amygdala: Amygdala;
  private readonly hypothalamus = new Hypothalamus();
  private readonly insula = new Insula();
  private readonly cingulate = new Cingulate();
  private readonly emotion = new Emotion();
  private readonly basalGanglia: BasalGanglia;
  private readonly prefrontal = new Prefrontal();
  private readonly cerebellum = new Cerebellum();
  private readonly broca: Broca;
  private readonly visualCortex = new VisualCortex();
  private readonly auditoryCortex = new AuditoryCortex();
  private readonly somatosensory = new Somatosensory();
  private readonly inferotemporal = new Inferotemporal();
  private readonly syntax = new Syntax();

  /* آخر ما وصل من الحواسّ، ولحظة وصوله.
   *
   * اللحظة ليست تفصيلاً: إدراكٌ عمره دقيقة ليس «ما يراه الآن»، واستعماله يجعل
   * زبير يسمّي شيئاً رُفع عن الكاميرا. فما تجاوز نافذة الطزاجة يُعدّ غائباً. */
  private lastVision: { percept: VisualPercept; at: number } | null = null;
  private lastHearing: { percept: AuditoryPercept; at: number } | null = null;
  private lastBody: { percept: SomaticPercept; at: number } | null = null;

  /* حالة الدماغ العامة */
  private bornAt = 0;
  private lastSeenAt = 0;
  private ticks = 0;
  private sleeps = 0;
  private lessons = 0;
  private lessonsSinceSleep = 0;
  private questionsAsked = 0;
  private verdicts: number[] = [];
  /** نسخة الميراث الذي وُرِثه، وصفرٌ لمن لم يورَّث شيئاً */
  private heritageVersion = 0;
  private askedWords: string[] = [];
  /** المواضيع التي جرى الكلام عليها قريباً بجنسها — عليها تعود الضمائر */
  private recentTopics: Array<{ stem: string; gender: string }> = [];
  private pending: PendingJudgement | null = null;

  private constructor(opts: Required<Pick<CreateOptions, 'name'>> & CreateOptions) {
    this.name = opts.name;
    const seed = opts.seed ?? 0x2b17a1;
    this.rng = new Rng(seed);
    this.compute_ = cpuCompute();
    this.accel = opts.accelerator ?? {
      unit: 'cpu',
      describeAr: 'يفكّر على معالج جهازك العادي',
      details: 'لم يُطلب مسرّع',
      similarities: async (q, k, c, d) => this.compute_.similarities(q, k, c, d),
      dispose: () => {},
    };
    this.storage = opts.storage ?? defaultStorage();

    const rng = new Rng(seed ^ 0x51ab);
    this.lexicon = new Lexicon(rng);
    this.thalamus = new Thalamus(rng);
    this.temporal = new TemporalLobe(rng);
    this.amygdala = new Amygdala(rng);
    this.basalGanglia = new BasalGanglia(rng);
    this.broca = new Broca();
  }

  static async create(opts: CreateOptions = {}): Promise<Zubair> {
    const child = new Zubair({ ...opts, name: opts.name ?? 'زبير' });
    child.accel = opts.accelerator ?? (await bestAccelerator());
    if (!opts.fresh) await child.load();
    if (child.bornAt === 0) child.bornAt = Date.now();
    // الميراث مرة واحدة في العمر: من وُرِث لا يورَّث ثانيةً في كل فتح للتطبيق
    if (opts.heritage && child.heritageVersion < HERITAGE_VERSION) await child.inherit();
    return child;
  }

  /* ————— ما يراه الأب عن حال ابنه ————— */

  get metrics(): GrowthMetrics {
    const vocab = this.lexicon.size;
    const { recent, previous } = accuracyOf(this.verdicts);
    let inherited = 0;
    for (const fact of this.parietal.facts) if (fact.taughtBy === HERITAGE_SOURCE) inherited++;
    return {
      ticks: this.ticks,
      lessons: this.lessons,
      vocab,
      facts: this.parietal.facts.length,
      factsInherited: inherited,
      factsFromFather: this.parietal.facts.length - inherited,
      objectsSeen: this.inferotemporal.knownCount,
      episodes: this.hippocampus.count,
      questionsAsked: this.questionsAsked,
      recentAccuracy: recent,
      previousAccuracy: previous,
      sleeps: this.sleeps,
    };
  }

  get compute(): { unit: ComputeUnit; describeAr: string; details: string } {
    return { unit: this.accel.unit, describeAr: this.accel.describeAr, details: this.accel.details };
  }

  /**
   * الميراث: عربيةُ محيطه قبل أن يعلّمه أبوه.
   *
   * لا يمرّ على دورة النبضة كاملة بل على المسار المعرفي منها وحده — لا ذكريات
   * تُخزَّن ولا أحكام تُحسَب ولا كلام يُقال. والسبب أن الميراث ليس حواراً جرى:
   * لو خُزِّن ذكرياتٍ لظنّ زبير أن أباه قال له مئتي جملة لم يقلها، ولاختلط عليه
   * من علّمه.
   *
   * ويُوسَم كل ما وُرِث بمصدره، فيبقى الفصل بين ميراثه وتعليم أبيه قائماً في
   * سجل نموّه إلى الأبد.
   */
  async inherit(): Promise<{ words: number; facts: number; intents: number; ms: number }> {
    const started = now();
    const vocabBefore = this.lexicon.size;
    const factsBefore = this.parietal.facts.length;

    for (const [subject, object, relation] of HERITAGE_FACTS) {
      /* تُمرَّر الجملة على الحاسّة أولاً لا على المعجم مباشرة: بها تُسجَّل صور
       * الكلمات كما تُكتب («تفاحة» لا «تفاحه») فيتكلّم بإملاء صحيح، وتنمو
       * مفرداته كما تنمو بالسماع. */
      const percept = this.lexicon.perceive(`${subject} ${object}`, true);
      const bound = this.parietal.bind(percept, 'TEACH_FACT');
      /* والنحو يسدّ ما يعجز عنه الرابط: «العصفور يطير» فعلٌ لا يقبله الرابط
       * جملةً اسمية، وهو موروثٌ صحيح يجب أن يصل. */
      const parsed = this.syntax.parse(percept);
      const s = bound.subject ?? parsed.topic;
      const o = bound.object ?? parsed.comment;
      if (!s || !o) continue;
      this.parietal.learnFact(s, o, 0, HERITAGE_SOURCE, relation ?? parsed.relation ?? 'جنس');
      const a = this.lexicon.idOf(s);
      const c = this.lexicon.idOf(o);
      if (a >= 0 && c >= 0) this.lexicon.embedding.associate(a, c, 0.03);
    }

    /* القصد الموروث أنفع من المفردات: به يفهم ماذا يُراد منه من أول رسالة، بدل
     * أن يتعلّمه على حساب أبيه في عشرين درساً أولى. */
    const prepared = HERITAGE_INTENTS.map(([sentence, intent]) => {
      const percept = this.lexicon.perceive(sentence, true);
      const gate = this.thalamus.gate(percept, this.hypothalamus.state, this.compute_);
      return { percept, bag: gate.bag.slice(), intent };
    });
    for (let epoch = 0; epoch < HERITAGE_EPOCHS; epoch++) {
      for (const sample of prepared) {
        this.temporal.teachIntent(sample.percept, sample.bag, sample.intent, 0.03);
      }
    }

    this.heritageVersion = HERITAGE_VERSION;
    await this.save();

    return {
      words: this.lexicon.size - vocabBefore,
      facts: this.parietal.facts.length - factsBefore,
      intents: HERITAGE_INTENTS.length,
      ms: round2(now() - started),
    };
  }

  /* ————— الحواسّ: ما يصل قبل أن يُقال شيء —————
   *
   * تُستدعى هذه من التطبيق مع كل إطار كاميرا أو مقطع صوت أو لمسة، وهي أسرع من
   * النبضة بكثير: العين ترى ثلاثين مرة في الثانية والكلام يأتي مرة في دقيقة.
   * فلا تُشغّل دورة الدماغ كلها، بل تُحدّث ما يراه ويسمعه ويحسّه فحسب. */

  /** يرى: إطار كاميرا واحد. يعيد ما رآه وما عرفه فيه إن عرف. */
  see(frame: RawFrame, at: number = Date.now()): { salience: number; motion: number; dark: boolean; recognized: Recognition | null } {
    const percept = this.visualCortex.see(transduceVision(frame));
    this.lastVision = { percept, at };
    /* شحن الخلية النبضية بمعدّل العين لا بمعدّل الكلام: هنا يتراكم البروز
     * الخافت المُلحّ حتى يعبر، وهنا يتسرّب البروز الخافت العابر فلا يعبر. */
    this.thalamus.excite('vision', percept.salience, at);
    const recognized = this.inferotemporal.recognize(percept.features);
    return { salience: percept.salience, motion: percept.motion, dark: percept.dark, recognized };
  }

  /** يسمع: مقطع صوت واحد. لا يفهم حروفاً — يعرف نوع الصوت ونبرته. */
  listen(audio: RawAudio, at: number = Date.now()): { kind: AuditoryPercept['kind']; loudness: number; pitchHz: number | null; familiarity: number } {
    const percept = this.auditoryCortex.listen(transduceAudio(audio));
    this.lastHearing = { percept, at };
    this.thalamus.excite('hearing', percept.salience, at);
    return {
      kind: percept.kind,
      loudness: percept.loudness,
      pitchHz: percept.pitchHz,
      familiarity: this.auditoryCortex.familiarity(percept.pitchHz),
    };
  }

  /**
   * يحسّ: لمسة أو حركة جهاز.
   *
   * والإحساس يمرّ على اللوزة فوراً لا في النبضة التالية: الهزّ العنيف يُوسَم
   * سلباً ساعتَه كما يفعل الألم، ولا ينتظر أن يُكلَّم زبير حتى يتأذّى.
   */
  feel(touch: RawTouch | null, body: RawBody | null, at: number = Date.now()): { kind: SomaticPercept['kind']; intensity: number; valence: number } {
    const percept = this.somatosensory.feel(transduceBody(touch, body));
    this.lastBody = { percept, at };
    this.thalamus.excite('body', percept.salience, at);
    /* الطريق القصير: يشعر قبل أن يفهم. المشاعر تُستدعى في كل إحساس لا عند
     * الشديد وحده، لأنها هي التي تُميّز المباغت من المستمرّ — وذاك فرق الخوف من
     * الاشمئزاز، ولا يُعرَف إلا بمقارنة الإحساس بما قبله. */
    this.emotion.startled(percept.innateValence);
    if (Math.abs(percept.innateValence) > 0.25) {
      // الوسم على متجه الإحساس نفسه: تجربةٌ جسدية تُقترن بحالتها لا بكلام
      const meaning = this.embedBody(percept);
      this.amygdala.condition(meaning, percept.innateValence, 0.03 * this.emotion.imprint);
    }
    return { kind: percept.kind, intensity: percept.intensity, valence: percept.innateValence };
  }

  /** يُسقِط الإحساس الجسدي في فضاء المعنى كي تفهمه اللوزة كما تفهم الكلام. */
  private embedBody(percept: SomaticPercept): Vec {
    const meaning = new Float32Array(DIMS.meaning);
    for (let i = 0; i < percept.features.length && i < meaning.length; i++) {
      meaning[i] = percept.features[i] ?? 0;
    }
    return meaning;
  }

  /** أما زال ما رآه طازجاً؟ خمس ثوانٍ: أطول من ذلك ليس «الآن». */
  private fresh<T>(slot: { percept: T; at: number } | null, now: number): T | null {
    if (!slot) return null;
    return now - slot.at <= 5000 ? slot.percept : null;
  }

  /** حقائقه كلها بمصادرها — يُعرَف بها ما وُرِث وما علّمه أبوه. */
  get facts(): readonly import('./core/types.js').Fact[] {
    return this.parietal.facts;
  }

  /** أوُرِّث عربية محيطه؟ يُعرَض للأب كي يعرف ما ليس من صنعه. */
  get inheritedVersion(): number {
    return this.heritageVersion;
  }

  /** ما يشعر به الآن: الستّة الأساسية والأربعة المركَّبة، بشدّاتها. */
  get mood(): Feelings {
    return this.emotion.feelings;
  }

  /** قائمة مشاعره للعرض — أساسيّها ثم معقّدها. */
  get moodList(): Array<{ name: string; value: number; complex: boolean }> {
    return this.emotion.list();
  }

  /** لهجته كما تعلّمها منك: شامية أم فصحى. تُعرض في سجل نموّه. */
  get dialectAr(): string {
    return this.broca.dialectAr;
  }

  /** خريطة الدماغ كما تُعرض للأب: كل فص ووظيفته. */
  get lobes(): Array<{ name: string; ar: string; role: string }> {
    const all = [
      this.brainstem, this.lexicon, this.thalamus, this.temporal, this.hippocampus,
      this.parietal, this.amygdala, this.hypothalamus, this.insula, this.cingulate,
      this.emotion, this.basalGanglia, this.prefrontal, this.cerebellum, this.broca,
      this.visualCortex, this.auditoryCortex, this.somatosensory, this.inferotemporal,
      this.syntax,
    ];
    return all.map((lobe) => ({ name: lobe.name, ar: lobe.ar, role: lobe.role }));
  }

  /* ————— النبضة: من كلامك إلى كلامه ————— */

  async hear(text: string, at: number = Date.now()): Promise<TickOutput> {
    const trace: TraceStep[] = [];
    const timed = <T>(lobe: { name: string; ar: string }, note: string, where: ComputeUnit, fn: () => T): T => {
      const started = now();
      const value = fn();
      trace.push({ lobe: lobe.name, ar: lobe.ar, note, where, ms: round2(now() - started) });
      return value;
    };

    /* ١. جذع الدماغ: النبضة واليقظة والغياب */
    const vitals = timed(this.brainstem, 'نبضة جديدة', 'cpu', () => this.brainstem.tick(at));
    this.ticks = vitals.ticks;

    /* ٢. الحاسّة: يقرأ حرفك وينمّي مفرداته بما سمع */
    const vocabBefore = this.lexicon.size;
    const percept = timed(this.lexicon, 'قرأ كلامك', 'cpu', () => this.lexicon.perceive(text, true));
    const grown = this.lexicon.size - vocabBefore;
    if (grown > 0) {
      trace.push({
        lobe: this.lexicon.name, ar: this.lexicon.ar,
        note: `تعلّم ${grown} كلمة جديدة`, where: 'cpu', ms: 0,
      });
    }

    /* ٣. الردود الفطرية: تخمين ما تريده مني قبل أن تتعلّم قشرتي */
    const reflex = timed(this.brainstem, 'غريزة: قصدك المبدئي', 'cpu', () => this.brainstem.reflexIntent(percept));

    /* ٤. الوطاء: الدوافع تتبدّل بما سمع.
     *
     * والجهل يُقاس بكلمات المعنى وحدها: أدوات الاستفهام وأسماء الإشارة وحروف
     * الوصل ليست أشياءً يُسأل عنها. الطفل لا يقول «ما معنى هذا؟» عن كلمة «هذا»،
     * ولو عُدَّت جهلاً لصار زبير يردّ سؤالك بسؤالٍ عن أداة سؤالك. */
    /* كلمةُ معنى: ليست أداةَ استفهام ولا اسمَ إشارة ولا **حرفاً**.
     *
     * والحرف يُعرَف من النحو لا من قائمةٍ هنا، وهذا فرقٌ عملي لا ترتيبيّ: قِيسَ
     * فخرج «وماذا أيضاً عن هيك؟» — عُدّت «هيك» شيئاً يجهله فسأل عنها، لأنها لم
     * تكن في القائمة المكتوبة هنا وهي في قائمة الحروف عند النحو. والقوائم
     * المكرّرة تفترق، وقسمُ الكلمة موضعه فصٌّ واحد. */
    const isContent = (word: string): boolean =>
      !QUESTION_WORDS.has(word) && !STOP_WORDS.has(word) && !DEMONSTRATIVE_KEYS.has(word)
      && this.syntax.classify(word).pos !== 'حرف'
      // ولا لفظُ تحيّةٍ أو مدح: «شو يعني مرحبا؟» سؤالٌ عن تحيّة أبيه لا عن شيء
      && !this.syntax.social({ ...percept, tokens: [word] });
    const unknownContent = percept.unknown.filter(isContent);
    /** كلمات المعنى في جملته كلها — عنها يُسأل، لا عن أدوات سؤاله */
    const contentTokens = percept.tokens.filter(isContent);
    const repeated = this.prefrontal.recent.at(-1)?.said === percept.raw;
    const intero = timed(this.hypothalamus, 'حدّث دوافعه', 'cpu', () => this.hypothalamus.update({
      unknownCount: unknownContent.length,
      repeatedInput: repeated,
      awayMs: vitals.awayMs,
      lessonsSinceSleep: this.lessonsSinceSleep,
      knownVocab: this.lexicon.size,
    }));

    /* ٤٫٥ المهاد كبرج توزيع: أي حاسّة تصل قشرتها الآن.
     * يُستدعى قبل بوابة الكلمات لأن ترتيبه التشريحي كذلك: كل الحواسّ تمرّ به
     * أولاً، ثم يُفصّل داخل كل مجرى. */
    const vision = this.fresh(this.lastVision, at);
    const hearing = this.fresh(this.lastHearing, at);
    const somatic = this.fresh(this.lastBody, at);
    const relay = timed(this.thalamus, 'وزّع حواسّه', 'cpu', () => this.thalamus.relay({
      vision: vision ? vision.salience : null,
      hearing: hearing ? hearing.salience : null,
      body: somatic ? somatic.salience : null,
      text: percept.tokens.length > 0 ? 1 : 0,
    }, intero, vitals.arousal, at));
    trace.push({
      lobe: this.thalamus.name, ar: this.thalamus.ar,
      note: relay.focus === 'none'
        ? relay.reasonAr
        : `${relay.reasonAr} — نبض ${relay.rates[relay.focus].toFixed(1)} هرتز`,
      where: 'none', ms: 0,
    });

    /* ٤٫٥٥ ما يسمعه وما يحسّه: يصلان الحوفي إن مرّا المهاد.
     *
     * وكان مجرى السمع ومجرى الجسد يُفرَزان في المهاد ثم **لا يستقبلهما أحد**:
     * يُحسَب لهما وزنٌ ونبضٌ وقرارُ عبور، ثم يُهمَل الثلاثة. حاسّةٌ تمرّ إلى
     * قشرةٍ لا تقرؤها ليست حاسّة. */
    if (hearing && relay.passed.hearing) {
      const familiarity = this.auditoryCortex.familiarity(hearing.pitchHz);
      this.emotion.heard({
        loudness: hearing.loudness,
        familiarity,
        // الضجيج والطرق يُفزعان، وصوت الإنسان لا يُفزع بعلوّه وحده
        harsh: hearing.kind === 'ضجيج' || hearing.kind === 'طرق',
      });
      trace.push({
        lobe: this.auditoryCortex.name, ar: this.auditoryCortex.ar,
        note: `سمع ${hearing.kind} بعلوّ ${Math.round(hearing.loudness * 100)}٪`
          + (familiarity > 0.5 ? ' — صوتٌ يعرفه' : ''),
        where: 'cpu', ms: 0,
      });
    }
    if (somatic && relay.passed.body && Math.abs(somatic.innateValence) > 0.1) {
      trace.push({
        lobe: this.somatosensory.name, ar: this.somatosensory.ar,
        note: `${somatic.kind}${somatic.innateValence > 0 ? ' — أراحه' : ' — أزعجه'}`,
        where: 'cpu', ms: 0,
      });
    }

    /* ٤٫٦ ما يراه الآن: تُستدعى القشرة تحت الصدغية إن مرّ مجرى البصر فقط.
     * والشرط ليس تحسيناً للأداء بل معنى: ما لم يمرّ المهاد لم يصل الوعي. */
    let recognized: Recognition | null = null;
    if (vision && relay.passed.vision && !vision.dark) {
      const started = now();
      recognized = this.inferotemporal.recognize(vision.features);
      trace.push({
        lobe: this.inferotemporal.name, ar: this.inferotemporal.ar,
        note: recognized ? `عرف ما يراه: ${recognized.name} (${Math.round(recognized.confidence * 100)}٪)` : 'يرى شيئاً لا يعرفه',
        where: 'cpu', ms: round2(now() - started),
      });
    }

    /* ٥. المهاد: أي كلماتك تستحقّ الانتباه */
    const gated = timed(this.thalamus, 'وزّع انتباهه على كلماتك', this.compute_.unit,
      () => this.thalamus.gate(percept, intero, this.compute_));

    /* أعلى ما نظرت إليه كلمةٌ في الجملة: يُعرَض للأب كي يرى الانتباه لا يُوصَف له */
    const focusPair = strongestLink(this.thalamus.attentionMap, percept.tokens);
    if (focusPair) {
      trace.push({
        lobe: this.thalamus.name, ar: this.thalamus.ar,
        note: `«${focusPair.from}» نظرت إلى «${focusPair.to}» بوزن ${focusPair.weight.toFixed(2)}`,
        where: 'cpu', ms: 0,
      });
    }

    /* ٦. الفص الصدغي: الفهم */
    const understanding = timed(this.temporal, 'فهم المعنى والقصد', this.compute_.unit,
      () => this.temporal.understand(percept, gated.bag, reflex, this.compute_));

    /* ٧. الحُصين: هل علّمتني هذا قبلاً؟
     * البحث هو العملية الوحيدة التي تستحقّ المسرّع العصبي: معنى واحد يُقارَن
     * بآلاف الذكريات دفعة واحدة. لذلك وحدها تمرّ من هنا لا كل حساب. */
    const recallStarted = now();
    const recall = this.accel.unit === 'cpu'
      ? this.hippocampus.recall(understanding.meaning, 4, this.compute_)
      : await this.hippocampus.recallFast(understanding.meaning, 4, this.accel);
    trace.push({
      lobe: this.hippocampus.name, ar: this.hippocampus.ar,
      note: recall.best ? `استدعى ذكرى بتشابه ${recall.bestScore.toFixed(2)}` : 'لا ذكرى مشابهة',
      where: this.accel.unit, ms: round2(now() - recallStarted),
    });

    const lessonsBefore = this.lessons;

    /* ٧٫٥ النحو: تركيب الجملة قبل الربط.
     * يُستدعى قبل الجُداري لأن الجُداري يبني على ما يُخرجه: نوع العلاقة (جنسٌ
     * أم صفة أم فعل)، والنفي، وما يطلبه السؤال. */
    const parse = timed(this.syntax, 'فكّ تركيب جملتك', 'cpu', () => this.syntax.parse(percept));
    trace.push({
      lobe: this.syntax.name, ar: this.syntax.ar,
      note: parse.asks !== null
        ? `${parse.kind}: ${this.syntax.describeAsk(parse.asks)}`
        : `${parse.kind}${parse.negated ? ' منفيّة' : ''}${parse.relation ? ` · علاقة ${parse.relation}` : ''}`,
      where: 'cpu', ms: 0,
    });

    /* ٨. الفص الجُداري: الربط والحقائق والتعميم */
    const bound = timed(this.parietal, 'ربط طرفي الجملة', 'cpu',
      () => this.parietal.bind(percept, understanding.intent));

    /* النفي معرفةٌ لا تصحيح، وهذا إصلاح عطل حقيقي: «القطة ليست نبات» كانت
     * تُقرأ «أخطأتَ» لأن «ليس» في كلمات التصحيح الفطرية، فكان الأب عاجزاً عن أن
     * يُعلّم ابنه أن شيئاً **ليس** كذا. والفرق بيّن في النحو: تصحيحُ الأب نفيٌ
     * بلا طرفين («لا، خطأ»)، وتعليمُ النفي نفيٌ بطرفين («القطة ليست نبات»). */
    /* مرجع الضمير يُحسب هنا لأن التعليم يبني عليه: «هي صغيرة» بعد «القطة حيوان»
     * تعليمٌ عن القطة لا عن ضمير. والبحث بالجنس في آخر ما تحدّثنا عنه. */
    let resolvedSubject: string | null = null;
    if (parse.pronoun) {
      for (let i = this.recentTopics.length - 1; i >= 0; i--) {
        const seen = this.recentTopics[i]!;
        if (parse.pronoun.gender === 'مجهول' || seen.gender === parse.pronoun.gender) {
          resolvedSubject = seen.stem;
          break;
        }
      }
    }

    /* الحذف: محمولٌ بلا موضوع يعود على آخر ما تحدّثنا عنه.
     *
     * «القطة حيوان» ثم «صغيرة» — والثانية تعليمٌ عن القطة لا كلمةٌ مبتورة.
     * وهو من جنس إرجاع الضمير فوُضع معه: كلاهما يستكمل الجملة الحاضرة بما
     * سبقها، ومرجعهما واحد — آخر المواضيع. */
    let ellipsis: { comment: string; relation: RelationKind } | null = null;
    if (!parse.topic && !parse.pronoun && this.recentTopics.length > 0) {
      const bare = this.syntax.ellipsis(percept);
      const last = this.recentTopics[this.recentTopics.length - 1]!;
      if (bare && bare.comment !== last.stem) {
        ellipsis = bare;
        resolvedSubject = last.stem;
        trace.push({
          lobe: this.syntax.name, ar: this.syntax.ar,
          note: `«${bare.comment}» محمولٌ محذوف الموضوع — حمله على «${last.stem}»`,
          where: 'cpu', ms: 0,
        });
      }
    }

    const teachesNegation = parse.negated && parse.topic !== null && parse.comment !== null
      && understanding.intent !== 'PRAISE';

    /* جملةٌ خبرية تامّة الطرفين بلا نفي: تعليمٌ مهما قال المصنِّف.
     *
     * قِيسَ: «القطة صغيرة» صنّفها المصنِّف **تصحيحاً**، والنحو يقول عنها «اسمية
     * · علاقة صفة» — أي خبرٌ تامّ. فلم يُحفظ شيء. والبنية أوثق من التصنيف
     * المتعلَّم في هذا الموضع بعينه: التصحيح في العربية لا يخلو من نفيٍ أو لفظ
     * تخطئة، وكلاهما يراه النحو. أما المدح والتحية فيُستثنيان لأنهما خبرٌ في
     * الصورة وليسا تعليماً في القصد. */
    const teachesByStructure = parse.topic !== null && parse.comment !== null
      && parse.asks === null && !parse.negated
      /* والمدحُ يُستثنى بلفظه لا بتصنيفه: «البحر أزرق» خبرٌ صنّفه المصنِّف مدحاً
       * بعد أن اتّسع ميراثه، فسقط الدرس. والألفاظ تُحصى، والتصنيف يُخطئ. */
      && !this.syntax.social(percept);

    const teaching = understanding.intent === 'TEACH_FACT'
      || understanding.intent === 'TEACH_WORD'
      || understanding.intent === 'TEACH_NAME'
      || teachesNegation
      || teachesByStructure
      /* والحذف تعليمٌ كالتعليم الصريح: «صغيرة» بعد «القطة حيوان» درسٌ عن
       * القطة. ولولا هذا لسمعه زبير كلمةً غريبة يسأل عنها.
       *
       * ولا يُشترط معه قصدٌ من المصنِّف: النحو نفسه يستثني التحية والمدح
       * والتصحيح والسؤال والضمير قبل أن يحكم بالحذف، فاشتراطُ القصد فوق ذلك
       * تكرارٌ يُسقط الدرس إذا أخطأ المصنِّف. قِيسَ: صار «صغيرة» تُقرأ مدحاً
       * بعد أن اتّسع ميراثه، فسقط الدرس كلُّه. */
      || ellipsis !== null;

    if (teachesNegation && parse.topic && parse.comment) {
      /* النفي يُهدم به المحمول المنفيّ ولا يُبنى محمولٌ جديد: «القطة ليست نبات»
       * تُخبرنا ما ليست، لا ما هي. */
      this.parietal.contradict(parse.topic, parse.comment);
      this.lessons++;
      this.lessonsSinceSleep++;
      trace.push({
        lobe: this.parietal.name, ar: this.parietal.ar,
        note: `نفى أن ${parse.topic} ${parse.comment}`, where: 'cpu', ms: 0,
      });
    /* طرفا الجملة يُؤخذان من النحو حين يعجز الرابط عنهما.
     *
     * والرابط في الجُداري يشترط قصداً تعليمياً صريحاً، فإذا أخطأ المصنِّف القصد
     * عاد بطرفين فارغين — فيسقط الدرس وإن كانت الجملة تامّة البنية. وهذا ما
     * حدث في «القطة صغيرة»: النحو يعرف طرفيها، والرابط لا يراهما. */
    } else if (teaching
      && (bound.subject ?? resolvedSubject ?? parse.topic)
      && (bound.object ?? parse.comment ?? ellipsis?.comment)) {
      /* الضمير يحلّ محلّه مرجعه قبل الحفظ: «هي صغيرة» تُحفَظ «قطة ← صغيرة».
       * وبلا هذا الإبدال يعود الضمير ثم لا يُنتفَع به، فيبقى الكلام معلّقاً. */
      const subject = (bound.subject ?? resolvedSubject ?? parse.topic)!;
      const object = (bound.object ?? parse.comment ?? ellipsis?.comment)!;
      /* والجُداري يصحّح نوع العلاقة بما يعرفه: «القطة شرسة» ليست جنساً جديداً
       * يمحو «حيوان»، لأن «شرسة» لم تكن جنساً لشيء قط. */
      const relation = this.parietal.refineRelation(
        subject, object, parse.relation ?? ellipsis?.relation ?? 'جنس',
      );
      /* ————— الاستدراك يُصحّح في خزانته لا في خزانةٍ مجاورة —————
       *
       * «المرنجل أداة» ثم «لا، المرنجل آلة»: الثانية استدراكٌ على الأولى، فلا
       * تُحفظ إلى جانبها بل تحلّ محلّها. وبلا هذا يقع أسوأ ما في تعليم — الأب
       * يصحّح، والجواب يبقى الخطأ الأول:
       *
       *   قِيس فخرج «آلة» إلى خزانة الصفات (لأن «آلة» لم تكن جنساً لشيءٍ عنده
       *   بعد)، وبقيت «أداة» في خزانة الأجناس. ثم سُئل «شو المرنجل؟» فقرأ
       *   الأجناس فقال «أداة» — أي أنه سمع التصحيح، وحفظه، وأجاب بنقيضه.
       *
       * فالاستدراك يُلزَم بخزانة ما يستدركه: إن كان للموضوع محمولٌ في خزانةٍ،
       * فالتصحيح لها هي، ولا يُعاد تصنيفه من جديد. */
      const corrected = parse.corrects
        ? this.parietal.relationOf(subject) : null;
      const target = corrected ?? relation;
      if (corrected !== null) {
        const old = this.parietal.lookup(subject, corrected);
        if (old) this.parietal.contradict(subject, old.object, corrected);
        trace.push({
          lobe: this.parietal.name, ar: this.parietal.ar,
          note: `استدراك: يُصحّح ما في خزانة «${corrected}»`,
          where: 'none', ms: 0,
        });
      }
      this.parietal.learnFact(subject, object, this.ticks, 'أبوه', target);
      this.lessons++;
      this.lessonsSinceSleep++;
      // ترابط هيبي: طرفا الحقيقة يتقاربان في تمثيله، فيصير «قطة» و«حيوان»
      // متجاورين في ذهنه لا رمزين منفصلين — وهذا أصل التعميم لاحقاً
      const a = this.lexicon.idOf(subject);
      const b = this.lexicon.idOf(object);
      if (a >= 0 && b >= 0) this.lexicon.embedding.associate(a, b);
      /* والعدد يُحفَظ علاقةً كسائرها: «عندي ثلاث قطط» ثم «كم قطة عندي؟».
       * وكان النحو يقرأ العدد في كل جملة ثم لا يستقبله أحد — فكان «كم» سؤالاً
       * لا جواب له في دماغه أبداً مهما قال الأب. */
      if (parse.count !== null) {
        this.parietal.learnFact(subject, String(parse.count), this.ticks, 'أبوه', 'عدد');
      }

      trace.push({
        lobe: this.parietal.name, ar: this.parietal.ar,
        note: `حفظ: ${subject} ← ${object}${relation !== 'جنس' ? ` (${relation})` : ''}`,
        where: 'cpu', ms: 0,
      });
    }

    /* ٨٫٥ الوصل بين حاسّتين: ما تراه العين وما يقوله الأب.
     *
     * «هذه تفاحة» والكاميرا على تفاحة: يُقرن الشكل بالاسم فيعرفها بعينه بعدها.
     * وهذا أصل تعلّم الأسماء عند الطفل — يُشار له إلى الشيء ويُسمّى، لا يُلقَّن.
     *
     * والاسم يُحفظ بإملاء الأب لا بالصورة المطبَّعة: هو ما سيُعرَض عليه لاحقاً. */
    let namedWhatHeSees: string | null = null;
    if (vision && relay.passed.vision && !vision.dark && teaching && bound.object) {
      const pointing = bound.subject !== null && DEMONSTRATIVE_KEYS.has(bound.subject);
      // إشارةٌ صريحة («هذه») أو تعليمُ كلمة والكاميرا مفتوحة: كلاهما تسمية لما يُرى
      if (pointing || understanding.intent === 'TEACH_WORD') {
        namedWhatHeSees = this.lexicon.pretty(bound.object);
        this.inferotemporal.teach(namedWhatHeSees, vision.features, this.ticks);
        trace.push({
          lobe: this.inferotemporal.name, ar: this.inferotemporal.ar,
          note: `ربط ما يراه بالاسم: ${namedWhatHeSees}`, where: 'cpu', ms: 0,
        });
      }
    }

    /* موضوع السؤال: عمّا يسألني أبي؟ أعلى كلمة انتباهاً ليست أداة استفهام. */
    /* الضمير يعود على آخر موضوع جرى الكلام عليه — إرجاعٌ بالجنس والعدد.
     * بلا هذا ينكسر التعليم على أكثر من دور: «القطة حيوان» ثم «هي صغيرة». */
    if (parse.pronoun && resolvedSubject) {
      trace.push({
        lobe: this.syntax.name, ar: this.syntax.ar,
        note: `«${parse.pronoun.word}» تعود على «${resolvedSubject}»`, where: 'cpu', ms: 0,
      });
    }

    /* موضوع الحوار يُصفّى بالنحو مهما كان مصدره: الحرف لا يصلح موضوعاً بحال،
     * لا من الربط ولا من الانتباه. قِيسَ فخرج «وماذا أيضاً عن هيك؟». */
    const boundTopic = bound.subject ?? resolvedSubject ?? this.salientTopic(percept, gated.weights);
    const topic = boundTopic
      && this.syntax.classify(boundTopic).pos !== 'حرف'
      // ولا تحيّةٌ ولا مدح: «ومرحبا شو كمان؟» سؤالٌ عن تحيّة أبيه لا عن شيء
      && !this.syntax.social({ ...percept, tokens: [boundTopic] })
      ? boundTopic : null;
    /* البحث في العلاقة التي يطلبها السؤال لا في «الجنس» دائماً.
     *
     * وهذا أخطر عطلٍ وُجد في مراجعة الفصوص كلها، لأنه يُبطل ميزةً كاملة بُنيت
     * قبله: صار زبير يحفظ معرفته مفهرسةً بنوع العلاقة، ثم كان الجواب يبحث في
     * «الجنس» وحده. فيُعلّمه أبوه أن القطة صغيرة، ويسأله «كيف القطة؟»، فيُقرّ
     * بجهله — وهو يعرف. حفظٌ لا يُستخرَج ليس معرفة. */
    /* ————— جدول الملكية: من يجيب عن هذا الطلب؟ —————
     *
     * الاستخراج أولاً، ومالكه النحو وحده. ثم يُقرأ الصفُّ من الجدول فيُعرف
     * المالك، والبقيّة أدلّة. ولا سطرَ هنا يقرّر شيئاً: كلُّه قراءةُ جدول. */
    const request = this.syntax.request(percept, parse);
    const row = rowOf(request);
    trace.push({
      lobe: this.syntax.name, ar: this.syntax.ar,
      note: `الطلب «${row.ar}» — مالكه ${row.ownerAr}`,
      where: 'cpu', ms: 0,
    });

    const wanted = this.syntax.storeFor(request);
    const knownFact = topic && wanted ? this.parietal.lookup(topic, wanted) : null;

    /* سؤالٌ عن المشار إليه («شو هذا؟») وهو يرى شيئاً يعرفه: الجواب مما يراه لا
     * مما حُفظ نصّاً. فيُصاغ ما يراه حقيقةً آنيّة تُقدَّم على المحفوظ، لأن السؤال
     * عن الحاضر لا عن الذاكرة. */
    const askingAboutSight = understanding.intent === 'ASK'
      && recognized !== null
      && (topic === null || DEMONSTRATIVE_KEYS.has(topic));
    const seenFact = askingAboutSight && recognized
      ? {
        subject: topic ?? 'هذا',
        object: recognized.name,
        confidence: recognized.confidence,
        taughtBy: 'رآه بعينه',
        lastSeenTick: this.ticks,
      }
      : null;

    /* مطابقة الجواب للسؤال — وهذا ما طلبه الأب صراحةً.
     *
     * «وين دمشق؟» يطلب مكاناً، وجوابه «مدينة» جوابُ سؤالٍ آخر. ولو أجاب به لبدا
     * كأنه لم يسمع السؤال. فيُسأل النحوُ: أيصلح هذا الجواب لهذا السؤال؟ ويُعطى
     * جنسُ الجواب نفسه من الجُداري («مدينة» جنسها «مكان») كي يُقاس عليه. */
    /* ————— القانون الثاني: النوع —————
     *
     * مقارنةُ وسمين لا حكمٌ دلاليّ: للطلب وسمُ نوعه، وللجواب وسمُ نوعه، وما
     * لم يتطابقا رُدّ الجواب. رخيصة، ولا تُخطئ، وتصطاد ما أفلت من الملكية. */
    const candidate = seenFact ?? knownFact;
    let fact = candidate;
    if (candidate && parse.asks !== null) {
      // ووسمُ الجواب هو خزانتُه: ما خرج من خزانة الصفات صفةٌ وإن كان لفظُه اسماً
      const from = seenFact ? 'جنس' : wanted;
      const kind = this.syntax.answerKind(candidate.object, from);
      if (!typeFits(request, kind)) {
        trace.push({
          lobe: this.syntax.name, ar: this.syntax.ar,
          note: `«${candidate.object}» وسمُه «${kind}» والطلب «${request}» — فلا يُقال`,
          where: 'cpu', ms: 0,
        });
        fact = null;
      }
    }
    /* موضوع الكلام وما وجده عنه: يُعرَض للأب صراحةً.
     *
     * وهو أنفع سطرٍ في أثر النبضة على الإطلاق: أكثر ما يبدو «عجزاً عن الجواب»
     * سببُه أن الموضوع الذي بحث عنه غير الذي سأل عنه أبوه. */
    trace.push({
      lobe: this.parietal.name, ar: this.parietal.ar,
      note: topic
        ? `موضوع الكلام «${topic}»${wanted ? ` — بحث في ${wanted}` : ''}: ${knownFact ? `وجد «${knownFact.object}»` : 'لا شيء'}`
        : 'لم يتبيّن موضوع الكلام',
      where: 'none', ms: 0,
    });

    /* أرضية الجزم: حقيقةٌ ثقتُه فيها دون هذا الحدّ لا يُجيب بها جزماً.
     *
     * وهذا ثاني منبعَي الهلوسة: حقيقةٌ هُدمت بتصحيح الأب فبقيت بثقةٍ ضئيلة، ثم
     * يُجاب بها كأنها يقين. والصدق أن يُقرّ بجهله حتى يُعاد تعليمه. */
    if (fact && fact.confidence < ASSERT_FLOOR) {
      trace.push({
        lobe: this.parietal.name, ar: this.parietal.ar,
        note: `يعرف «${fact.object}» بثقة ${Math.round(fact.confidence * 100)}٪ — دون حدّ الجزم فلا يجزم`,
        where: 'none', ms: 0,
      });
      fact = null;
    }

    /* ————— القانون الأول: الفراغ —————
     *
     * طلبٌ لا خزانةَ لعنده تعني أن مالكه فارغ، وجوابُ المالك الفارغ **نهائي**:
     * لا تعميمَ يملأ مكانه، ولا فصَّ آخر يُدلي بما يملك. فعطبُ «وين الكنكارو؟
     * ← الكنكارو حيوان» لم يكن جهلَه بالمكان، بل أن جهله صار دعوةً لغيره. */
    const ownerVoid = wanted === null && voidIsFinal(request);
    if (ownerVoid) {
      trace.push({
        lobe: this.parietal.name, ar: row.ownerAr,
        note: `لا خزانةَ عنده لطلب «${row.ar}» — والفراغ جوابٌ نهائي`,
        where: 'none', ms: 0,
      });
    }

    /* والتعميم يمرّ على قانون النوع كما يمرّ المحفوظ.
     *
     * وهذا سدُّ ثغرةٍ كُشفت بالفحص لا بالنظر: الاستدعاء المحفوظ **مفهرسٌ
     * بالعلاقة**، فالبحث في خزانة الأفعال لا يُخرج جنساً أصلاً — أي أن قانون
     * النوع لم يكن يعمل في تلك الحالات، بل العمودُ وحده. لكنّ التعميم ليس
     * مفهرساً: يُخرج ما يُشبه الموضوعَ من أي خزانة. فهو **المنفذ الوحيد** الذي
     * يستطيع أن يُسلّم جواباً بوسمٍ غير وسم الطلب — وكان مفتوحاً. */
    let generalized = !fact && !ownerVoid && topic
      ? this.parietal.generalize(topic, this.lexicon) : null;
    if (generalized && parse.asks !== null) {
      const kind = this.syntax.answerKind(generalized.fact.object, wanted);
      if (!typeFits(request, kind)) {
        trace.push({
          lobe: this.syntax.name, ar: this.syntax.ar,
          note: `تعميمٌ وسمُه «${kind}» والطلب «${request}» — فلا يُقال`,
          where: 'cpu', ms: 0,
        });
        generalized = null;
      }
    }

    /* أنزل الدرس فعلاً؟ يُقاس بما حُفظ لا بما قيل: أبٌ يُعلّم جملةً لم يفهمها
     * ابنه لم يُعلّمه شيئاً بعد. وعليه وحده يُكبَح «علّمني» و«شو هذا؟». */
    const lessonLanded = this.lessons > lessonsBefore;

    /** أخٌ في جنس موضوع الحوار: به يمتحن قاعدته بدل أن يسأل عن لفظ */
    const akin = topic ? this.parietal.sibling(topic) : null;

    /** قسمُ كل كلمة في جملة أبيه — من النحو، ليصوغ بروكا سؤالاً غير ملحون */
    const wordForms = new Map<string, import('./lobes/broca.js').AskForm>();
    const wordGenders = new Map<string, import('./lobes/syntax.js').Gender>();
    for (const form of parse.words) {
      wordForms.set(form.word, this.syntax.describes(form.stem) ? 'صفة' : form.pos);
      wordGenders.set(form.word, form.gender);
    }

    /* ٩. اللوزة: هل هذا المعنى مقترن بمدح أم بخطأ في تجربتي؟ */
    const valence = timed(this.amygdala, 'وسم عاطفي للمعنى', this.compute_.unit,
      () => this.amygdala.valence(understanding.meaning, this.compute_));

    /* ١٠. الجزيرة والحزام: حالته الداخلية، وهل هو متأكّد أصلاً */
    const insulaVec = timed(this.insula, 'استبطن حاله', 'cpu', () => this.insula.encode(intero));
    const conflict = timed(this.cingulate, 'قاس تعارضه الداخلي', 'cpu', () => this.cingulate.conflict({
      intentProbs: understanding.intentProbs,
      recallScore: recall.bestScore,
      factConfidence: fact?.confidence ?? 0,
      valence,
    }));

    /* ١٠٫٥ المشاعر: من الوسم الواحد إلى حالة شعورية.
     *
     * موضعها بعد اللوزة والحزام لأنها تقرأ منهما، وقبل العُقد القاعدية لأنها
     * تُغيّر قراره. ولو وُضعت بعد القرار لصارت زينةً تُعرَض ولا تفعل شيئاً. */
    const feelings = timed(this.emotion, 'شعر بما جرى', 'cpu', () => this.emotion.perceive({
      valence,
      conflict: conflict.level,
      intero,
      novelty: percept.tokens.length > 0 ? unknownContent.length / percept.tokens.length : 0,
      othersHave: OTHER_OWNERS.has(this.syntax.possession(percept) ?? ''),
      awayMs: vitals.awayMs,
    }));
    if (feelings.dominant) {
      trace.push({
        lobe: this.emotion.name, ar: this.emotion.ar,
        note: `${feelings.dominant.name} ${Math.round(feelings.dominant.intensity * 100)}٪ — ${feelings.reasonAr}`,
        where: 'cpu', ms: 0,
      });
    }

    /* ١١. الفص الجبهي: الهدف والكبح */
    const goal = timed(this.prefrontal, 'حدّد هدفه', 'cpu', () => this.prefrontal.goal(intero, understanding));
    const allowed = timed(this.prefrontal, 'كبح ما لا يصلح الآن', 'cpu', () => this.prefrontal.inhibit(STRATEGIES, {
      intent: understanding.intent,
      askedRecently: this.askedWords.slice(-8),
      lastStrategies: this.prefrontal.recentStrategies,
      hasFact: fact !== null,
      hasGeneralization: generalized !== null,
      recallScore: recall.bestScore,
      vocab: this.lexicon.size,
      unknownCount: unknownContent.length,
      factConfidence: fact?.confidence ?? 0,
      generalizeStrength: generalized?.similarity ?? 0,
      lessonLanded,
      /* ولا يمتحن قاعدةً في وجه سؤال: مَن سُئل يُجيب. الامتحان يأتي بعد الدرس
       * أو في الكلام العادي، وهو موضعه عند الطفل أيضاً. */
      ruleToTest: akin !== null && understanding.intent !== 'ASK',
      asksKnowledge: parse.asks !== null && ASKS_KNOWLEDGE.has(request),
    }));

    /* ————— قانونا الفراغ والغريزة على المسموحات —————
     *
     * الكبح الجبهي يقول ما **يصلح الآن**، وهذان يقولان ما **يجوز أصلاً**. وهما
     * فوقه لا فيه: الجبهي يتعلّم ويُرجّح، والقانون لا يُرجَّح.
     *
     *   الفراغ: مالكٌ فارغ لا يُجاب عنه إلا إقراراً أو سؤالاً.
     *   الغريزة: لا تكون جواباً ما دام ثمّة طلبٌ مستخرَج. تُلوّن النبرة — وذاك
     *   يجري في بروكا — ولا تحتلّ مكان الجواب. */
    let lawful = allowed;
    /* والفراغ يُقرّ به إقراراً ولا يُلتفّ عليه بسؤال: «وين الكنكارو؟ ← كل شي
     * حيوان متل الكنكارو؟» سؤالٌ يُهرّب الجنسَ الذي رُدّ، فلا يُقال. */
    if (ownerVoid) lawful = ['ADMIT'];
    if (!instinctMaySpeak(request)) {
      const withoutInstinct = lawful.filter((s) => s !== 'GREET_BACK');
      /* ولو لم يبقَ غيرُها فالإقرار أولى: تحيّةٌ في وجه سؤالٍ أسوأ من «لا أعرف» */
      lawful = withoutInstinct.length > 0 ? withoutInstinct : ['ADMIT'];
    }
    if (lawful.length !== allowed.length) {
      trace.push({
        lobe: 'ownership', ar: 'جدول الملكية',
        note: `قانونُ ${ownerVoid ? 'الفراغ' : 'الغريزة'}: بقي ${lawful.join('، ')}`,
        where: 'none', ms: 0,
      });
    }

    /* ١٢. العُقد القاعدية: أي استجابة أختار؟
     * الحرارة ليست ثابتة: الملل والفضول يدفعانه للتجريب، واليقين يدفعه للالتزام
     * بما يعرف. هذا هو التوازن بين الاستكشاف والاستغلال، وبه يخرج من العادة. */
    /* التعارض هو محرّك الاستكشاف الأول: من لا يدري يجرّب، ومن يدري يلتزم بما
     * يعرف. الملل والفضول يزيدان التجريب، وثقته تنقصه. القيست: بحرارة لا تهبط
     * مع المعرفة ظلّ يُقرّ بجهله في أربعين بالمئة من أسئلة يعرف جوابها، لأن
     * الاختيار كان شبه موحَّد بين المسموحات. */
    /* والمشاعر تُزيح الحرارة أو تخفضها: الغاضب يعاند فيجرّب، والخائف يتجمّد على
     * المأمون، والفرِح يلتزم ما أرضى أباه. هذا هو أثر الشعور في الفعل — وبلا
     * إزاحةٍ كهذه تبقى المشاعر عرضاً على الشاشة لا حالةً في الدماغ. */
    const temperature = clamp(
      0.22 + 0.9 * conflict.level + 0.35 * intero.boredom + 0.25 * intero.curiosity
      - 0.5 * intero.confidence + this.emotion.temperatureShift
      // والمتعب لا يجرّب: من هدفه أن يستريح يلتزم أقصر ما يعرف
      + (goal === 'REST' ? -0.25 : 0),
      /* ومدى استكشافه ضيّق: مدىً واسعٌ عند من يعرف هو التشتّت بعينه — يُجيب
       * صواباً ثم يُقرّ بجهله في السؤال نفسه بلا سبب. وكان يتّسع كلما صغرت
       * «مرحلته»، فحُذف مع سُلّم الأطوار. */
      0.08,
      0.65,
    );
    const state = this.basalGanglia.encodeState({
      understanding, recallScore: recall.bestScore, hasFact: fact !== null,
      hasGeneralization: generalized !== null, valence, conflict: conflict.level,
      intero, insula: insulaVec, vocab: this.lexicon.size, unknownCount: unknownContent.length,
    });
    const decision = timed(this.basalGanglia, `اختار استجابته (حرارة ${temperature.toFixed(2)})`, this.compute_.unit,
      () => this.basalGanglia.select(state, lawful, temperature, this.rng, this.compute_,
        // ميل الهدف: يُرجّح ما يوافقه ولا يمنع ما يخالفه
        (strategy) => (GOAL_FITS[goal].has(strategy) ? GOAL_LEAN : 0)));

    /* ١٣. بروكا: الكلام */
    const speech = timed(this.broca, 'صاغ جملته', 'cpu', () => this.broca.speak({
      strategy: decision.strategy, percept, understanding, recall, fact, generalized,
      intero, unknownWords: unknownContent, contentWords: contentTokens,
      /* أقسام كلمات جملتك: بها يُصاغ سؤاله صحيحاً. وكان يسأل «علّمني أكثر عن
       * بيطير» لأنه لا يعرف أن ما بيده فعل. */
      wordForms, wordGenders, topic, akin,
      topicGender: topic ? this.syntax.classify(topic).gender : undefined,
      /* موضوع سؤالك يُضاف إلى ما سأل عنه في هذه النبضة وحدها: طفل يُسأل «شو
       * القطة؟» فيردّ «شو القطة؟» يبدو ساخراً لا جاهلاً. إن كان لا يعرف فليقل
       * «ما بعرف، علّمني» — وهذا ما تفعله استراتيجية الإقرار بالجهل. */
      askedBefore: topic ? [...this.askedWords, topic] : this.askedWords,
      lexicon: this.lexicon, selfName: this.name, rng: this.rng,
      /* نوع الكلام يُحسَب قبل صياغته كي لا يناقض الشعورُ المقال. وهو يُعرف من
       * الاستراتيجية وحدها: بروكا تختار الصيغة، والاستراتيجية تحدّد جنسها. */
      feelingAr: this.emotion.colorAr(this.broca.speaksShami, speechKind(decision.strategy)),
      /* جدول الملكية: نوع الطلب، وجوابُ مالكه إن كان المالك غير الجُداري */
      request,
      selfStateAr: request === 'حال' ? this.insula.howAmI(intero, this.broca.speaksShami) : null,
      ownerVoid,
    }));

    /* ١٤. المخيخ: الإتقان ومنع التكرار */
    const refined = timed(this.cerebellum, 'أتقن صياغته', 'cpu', () => this.cerebellum.refine(speech.text, {
      recentReplies: this.prefrontal.recent.map((t) => t.replied),
    }));

    /* ١٥. ما بعد الكلام: تخزين، وتعلّم أسلوب أبيه، وتعلّم من غريزته */
    this.hippocampus.store({
      said: percept.raw, tokens: percept.tokens, meaning: Array.from(understanding.meaning),
      intent: understanding.intent, subject: bound.subject, object: bound.object,
      replied: refined, reward: 0, tick: this.ticks,
    });

    // ما تحدّثنا عنه يبقى حاضراً للضمير التالي
    const rememberedTopic = bound.subject ?? resolvedSubject ?? parse.topic;
    if (rememberedTopic) {
      const form = this.syntax.classify(rememberedTopic);
      this.recentTopics.push({ stem: rememberedTopic, gender: form.gender });
      if (this.recentTopics.length > 6) this.recentTopics = this.recentTopics.slice(-6);
    }

    this.prefrontal.push({ said: percept.raw, replied: refined, meaning: understanding.meaning, tick: this.ticks, strategy: decision.strategy });
    this.broca.learnStyle(percept.raw);

    // التعلّم من الغريزة: حين يكون النمط السطحي صريحاً، تُدرَّب القشرة عليه.
    // هكذا يتعلّم الطفل الأول: غريزته معلّمه حتى يأتي معلّم أحسن — أبوه.
    if (reflex.strength >= 0.6) {
      this.temporal.teachIntent(percept, gated.bag, reflex.intent, 0.01);
    }

    if (speech.kind === 'question') {
      this.questionsAsked++;
      if (speech.about) this.askedWords.push(speech.about);
      if (this.askedWords.length > 64) this.askedWords = this.askedWords.slice(-64);
    }

    this.pending = {
      tick: this.ticks, said: percept.raw, replied: refined,
      meaning: understanding.meaning.slice(), state: state.slice(),
      strategy: decision.strategy, intent: understanding.intent,
      subject: bound.subject, object: bound.object, topic,
      sawFeatures: askingAboutSight && vision ? vision.features.slice() : null,
      namedFromSight: askingAboutSight ? (recognized?.name ?? null) : null,
      assertedObject: decision.strategy === 'ANSWER_MEMORY' ? (fact?.object ?? null)
        : decision.strategy === 'ANSWER_GENERAL' ? (generalized?.fact.object ?? null) : null,
    };
    this.lastSeenAt = at;

    trace.push({
      lobe: 'goal', ar: 'هدفه الآن', note: goalAr(goal), where: 'none', ms: 0,
    });

    return {
      text: refined, kind: speech.kind, strategy: decision.strategy,
      intent: understanding.intent,
      confidence: clamp(1 - conflict.level, 0, 1),
      usedEpisodes: recall.episodes.map((e) => e.id),
      trace,
    };
  }

  /** أعلى كلمة انتباهاً ليست أداة استفهام — عمّا يسألني أبي. */
  private salientTopic(percept: { tokens: readonly string[]; isQuestion: boolean }, weights: number[]): string | null {
    if (percept.tokens.length === 0) return null;
    let best: string | null = null;
    let bestWeight = -Infinity;
    for (let i = 0; i < percept.tokens.length; i++) {
      const token = percept.tokens[i]!;
      if (QUESTION_WORDS.has(token) || STOP_WORDS.has(token)) continue;
      /* والحرف لا يصلح موضوعاً بحال، ويُعرَف من النحو لا من قائمةٍ هنا: قِيسَ
       * فخرج «ماذا أيضاً عن هيك؟» — جُعلت «هيك» موضوع الحوار لأنها لم تكن في
       * القائمة. والقوائم تُنسى، وقسمُ الكلمة لا يُنسى. */
      if (this.syntax.classify(token).pos === 'حرف') continue;
      /* وإطارُ السؤال ليس موضوعَه: «شو تعمل الدرقاوة؟» موضوعُها «الدرقاوة»،
       * و«تعمل» أداةٌ استُهلكت في استخراج الطلب. */
      if (percept.isQuestion && this.syntax.framesQuestion(token)) continue;
      const w = weights[i] ?? 0;
      if (w > bestWeight) {
        bestWeight = w;
        best = token;
      }
    }
    return best;
  }

  /* ————— حكم الأب: هنا يقع أهم تعلّم في الدماغ كله ————— */

  async judge(feedback: Feedback): Promise<JudgeResult> {
    const pending = this.pending;
    if (!pending) return { dopamine: 0, learned: [] };

    const reward = feedback.verdict === 'praise' ? 1 : -1;
    const learned: string[] = [];

    this.hippocampus.annotate(pending.tick, pending.replied, reward);

    /* تصحيح التسمية البصرية: أخطر من تصحيح الكلام لأنه يُعدّل ما يراه لا ما
     * يحفظه. ويمرّ على نفس منطق الحقائق: لا يُمحى النموذج من مرة واحدة. */
    if (pending.sawFeatures && pending.namedFromSight) {
      if (reward > 0) {
        this.inferotemporal.confirm(pending.namedFromSight, pending.sawFeatures, this.ticks);
        learned.push(`ثبّت أن ما رآه هو «${pending.namedFromSight}»`);
      } else {
        const rightName = feedback.correction?.trim() ?? null;
        this.inferotemporal.correct(pending.namedFromSight, rightName, pending.sawFeatures, this.ticks);
        learned.push(rightName
          ? `تعلّم بعينه أن هذا «${rightName}» لا «${pending.namedFromSight}»`
          : `أضعف أن ما رآه «${pending.namedFromSight}»`);
      }
    }
    /* ما يُشعِر يُحفَر أعمق: شدّة شعوره تضاعف معدّل وسم اللوزة. وهذا ثابتٌ في
     * كل دماغ — تجربةٌ مشحونة تُوسَم من مرة، وباردةٌ تحتاج عشراً. */
    this.amygdala.condition(pending.meaning, reward, 0.05 * this.emotion.imprint);
    this.thalamus.reinforce(reward);
    const { dopamine } = this.basalGanglia.learn(pending.state, pending.strategy, reward);
    const feelings = this.emotion.judged({ reward, strategy: pending.strategy, dopamine });
    if (feelings.dominant) {
      learned.push(`شعر بـ«${feelings.dominant.name}» — ${feelings.reasonAr}`);
    }
    this.verdicts.push(reward);
    if (this.verdicts.length > 400) this.verdicts = this.verdicts.slice(-400);

    learned.push(reward > 0
      ? `عزّز أن «${strategyAr(pending.strategy)}» تُرضيك في مثل هذا الموضع`
      : `أضعف «${strategyAr(pending.strategy)}» في مثل هذا الموضع`);

    /* الحقيقة التي جزم بها تُهدَم بكلمة «خطأ» وحدها، ولا تنتظر أن يكتب الأب
     * الصواب.
     *
     * وكان الهدم داخل شرط «إن كتب التصحيح»، فكان زر «خطأ» في التطبيق — وهو
     * أكثر ما يضغطه الأب — لا يمسّ الحقيقة الخاطئة بشيء: يُصحَّح له عشر مرات
     * ويعيدها في الحادية عشرة بثقةٍ كما هي. وهذا أخطر منابع الإصرار على الخطأ:
     * تصحيحٌ لا يُغيّر ما صُحِّح.
     *
     * ولا يُمحى المحمول من مرة: تُخفَض ثقته، فإن أصرّ الأب سقط. */
    if (feedback.verdict === 'correct') {
      const asserted = pending.subject ?? pending.topic;
      if (asserted && pending.assertedObject) {
        this.parietal.contradict(asserted, pending.assertedObject);
        learned.push(`هدم ثقته في «${asserted} ← ${pending.assertedObject}»`);
      }
    }

    if (feedback.verdict === 'correct' && feedback.correction && feedback.correction.trim()) {
      const correction = feedback.correction.trim();

      // نمط الخطأ: ما قاله خطأً وما كان صحيحاً — يتعلّمه المخيخ لئلا يعيده
      this.cerebellum.learnFromCorrection(pending.replied, correction);

      // وتصحيحك درس كامل لا كلمة «خطأ»: يُقرأ ويُفهم ويُحفظ كما لو علّمته ابتداءً
      const cPercept = this.lexicon.perceive(correction, true);
      const cReflex = this.brainstem.reflexIntent(cPercept);
      const cGate = this.thalamus.gate(cPercept, this.hypothalamus.state, this.compute_);
      const cUnderstanding = this.temporal.understand(cPercept, cGate.bag, cReflex, this.compute_);
      const cBound = this.parietal.bind(cPercept, 'TEACH_FACT');
      const subject = cBound.subject ?? pending.subject;
      const object = cBound.object ?? (cPercept.tokens.length === 1 ? cPercept.tokens[0]! : null);

      if (subject && object) {
        this.parietal.learnFact(subject, object, this.ticks, 'أبوه');
        const a = this.lexicon.idOf(subject);
        const b = this.lexicon.idOf(object);
        if (a >= 0 && b >= 0) this.lexicon.embedding.associate(a, b, 0.05);
        learned.push(`تعلّم من تصحيحك: ${subject} ← ${object}`);
      }

      // ٤. الذكرى الصحيحة تُخزَّن بمكافأة موجبة كي يُعاد عليها في النوم
      this.hippocampus.store({
        said: correction, tokens: cPercept.tokens,
        meaning: Array.from(cUnderstanding.meaning), intent: 'TEACH_FACT',
        subject, object, replied: null, reward: 0.5, tick: this.ticks,
      });
      this.lessons++;
      this.lessonsSinceSleep++;
    }

    if (feedback.verdict === 'praise') {
      // المدح على جواب من ذاكرة صريحة يقوّي الحقيقة نفسها لا الاستراتيجية وحدها
      const asserted = pending.subject ?? pending.topic;
      if (asserted && pending.assertedObject) {
        this.parietal.learnFact(asserted, pending.assertedObject, this.ticks, 'أبوه');
      }
    }

    await this.save();
    return { dopamine, learned };
  }

  /* ————— النوم: هنا يتحوّل الحفظ إلى فهم —————
   *
   * الحفظ الفوري يجعل درساً واحداً كافياً ليعرف، لكنه لا يجعله يفهم. الفهم
   * يحتاج تكراراً، والأب لا يكرّر ألف مرة. فيُعيد زبير على نفسه دروسه أثناء
   * النوم — وهذا ما يفعله دماغك كل ليلة: يُشغّل ذكريات اليوم مراراً ليثبّتها. */
  async sleep(cycles = 3): Promise<SleepResult> {
    const vocabBefore = this.lexicon.size;
    const accuracyBefore = accuracyOf(this.verdicts).recent;
    let replayed = 0;
    let factsFormed = 0;

    for (let cycle = 0; cycle < cycles; cycle++) {
      const batch = this.hippocampus.replayBatch(24, this.rng);
      for (const episode of batch) {
        replayed++;
        const percept = this.lexicon.perceive(episode.said, false);
        const gate = this.thalamus.gate(percept, this.hypothalamus.state, this.compute_);

        // تثبيت القصد: نفس الدرس يُعاد على القشرة فتنتقل معرفته من الحُصين إليها
        this.temporal.teachIntent(percept, gate.bag, episode.intent, 0.02);

        if (episode.reward !== 0) {
          const meaning = Float32Array.from(episode.meaning);
          this.amygdala.condition(meaning, episode.reward, 0.02);
        }

        if (episode.subject && episode.object) {
          const before = this.parietal.lookup(episode.subject);
          this.parietal.learnFact(episode.subject, episode.object, this.ticks, episode.replays > 0 ? 'التثبيت' : 'أبوه');
          if (!before) factsFormed++;
          const a = this.lexicon.idOf(episode.subject);
          const b = this.lexicon.idOf(episode.object);
          if (a >= 0 && b >= 0) this.lexicon.embedding.associate(a, b, 0.01);
        }
      }
    }

    this.hypothalamus.onSleep();
    this.brainstem.onSleep();
    // النوم يهدّئ ما شُعِر به ولا يمحوه: يستيقظ أهدأ لا خالياً
    this.emotion.onSleep();
    this.sleeps++;
    this.lessonsSinceSleep = 0;
    await this.save();

    return { replayed, factsFormed, vocabBefore, vocabAfter: this.lexicon.size, accuracyBefore };
  }

  /** يبتدئ هو الكلام: عند أول لقاء، أو بعد غياب. */
  async greet(): Promise<TickOutput | null> {
    const away = this.lastSeenAt === 0 ? Infinity : Date.now() - this.lastSeenAt;
    // ساعة غياب تكفي ليشتاق. أقل من ذلك استكمال جلسة لا لقاء جديد.
    if (away < 60 * 60 * 1000) return null;
    return this.hear(this.ticks === 0 ? 'مرحبا' : 'رجعت');
  }

  /* ————— الحفظ: طفل لا يُحفظ دماغه ينسى أباه ————— */

  private snapshot(): BrainState {
    return {
      version: BRAIN_STATE_VERSION,
      name: this.name,
      bornAt: this.bornAt,
      lastSeenAt: this.lastSeenAt,
      ticks: this.ticks,
      sleeps: this.sleeps,
      questionsAsked: this.questionsAsked,
      verdicts: this.verdicts,
      lobes: {
        meta: {
          lessons: this.lessons, lessonsSinceSleep: this.lessonsSinceSleep,
          askedWords: this.askedWords, heritageVersion: this.heritageVersion,
        },
        brainstem: this.brainstem.save(),
        lexicon: this.lexicon.save(),
        thalamus: this.thalamus.save(),
        temporal: this.temporal.save(),
        hippocampus: this.hippocampus.save(),
        parietal: this.parietal.save(),
        amygdala: this.amygdala.save(),
        hypothalamus: this.hypothalamus.save(),
        insula: this.insula.save(),
        cingulate: this.cingulate.save(),
        emotion: this.emotion.save(),
        basalGanglia: this.basalGanglia.save(),
        prefrontal: this.prefrontal.save(),
        cerebellum: this.cerebellum.save(),
        syntax: this.syntax.save(),
        broca: this.broca.save(),
        visualCortex: this.visualCortex.save(),
        auditoryCortex: this.auditoryCortex.save(),
        somatosensory: this.somatosensory.save(),
        inferotemporal: this.inferotemporal.save(),
      },
    };
  }

  private restore(state: BrainState): void {
    if (!state || state.version !== BRAIN_STATE_VERSION) return;
    this.bornAt = state.bornAt ?? 0;
    this.lastSeenAt = state.lastSeenAt ?? 0;
    this.ticks = state.ticks ?? 0;
    this.sleeps = state.sleeps ?? 0;
    this.questionsAsked = state.questionsAsked ?? 0;
    this.verdicts = Array.from(state.verdicts ?? []);

    const lobes = state.lobes ?? {};
    const meta = lobes['meta'] as {
      lessons?: number; lessonsSinceSleep?: number; askedWords?: string[]; heritageVersion?: number;
    } | undefined;
    this.lessons = meta?.lessons ?? 0;
    this.lessonsSinceSleep = meta?.lessonsSinceSleep ?? 0;
    this.askedWords = Array.from(meta?.askedWords ?? []);
    this.heritageVersion = typeof meta?.heritageVersion === 'number' && Number.isFinite(meta.heritageVersion)
      ? Math.max(0, Math.floor(meta.heritageVersion))
      : 0;

    // كل فص يتولّى التحقّق من حالته: نمرّرها ولا نفحصها هنا، وأي فص يجدها
    // غير مطابقة يُبقي تهيئته. لهذا استعادة دماغ قديم لا تُسقط الجديد.
    this.brainstem.load(lobes['brainstem'] as never);
    this.lexicon.load(lobes['lexicon'] as never);
    this.thalamus.load(lobes['thalamus'] as never);
    this.temporal.load(lobes['temporal'] as never);
    this.hippocampus.load(lobes['hippocampus'] as never);
    this.parietal.load(lobes['parietal'] as never);
    this.amygdala.load(lobes['amygdala'] as never);
    this.hypothalamus.load(lobes['hypothalamus'] as never);
    this.insula.load(lobes['insula'] as never);
    this.cingulate.load(lobes['cingulate'] as never);
    this.emotion.load(lobes['emotion'] as never);
    this.basalGanglia.load(lobes['basalGanglia'] as never);
    this.prefrontal.load(lobes['prefrontal'] as never);
    this.cerebellum.load(lobes['cerebellum'] as never);
    this.syntax.load(lobes['syntax'] as never);
    this.broca.load(lobes['broca'] as never);
    this.visualCortex.load(lobes['visualCortex'] as never);
    this.auditoryCortex.load(lobes['auditoryCortex'] as never);
    this.somatosensory.load(lobes['somatosensory'] as never);
    this.inferotemporal.load(lobes['inferotemporal'] as never);
  }

  async save(): Promise<void> {
    try {
      await this.storage.write(STORAGE_KEY, JSON.stringify(this.snapshot()));
    } catch {
      // فشل الحفظ لا يجوز أن يُسقط الجلسة: يبقى زبير حاضراً في الذاكرة، وأسوأ
      // ما يحدث أن ينسى بعد الإغلاق. التطبيق يُنبّه الأب ليأخذ نسخة احتياطية.
    }
  }

  private async load(): Promise<void> {
    try {
      const raw = await this.storage.read(STORAGE_KEY);
      if (raw) this.restore(JSON.parse(raw) as BrainState);
    } catch {
      // دماغ محفوظ تالف: نبدأ من الميلاد بدل أن نرفض الإقلاع
    }
  }

  /** نسخة احتياطية كاملة لدماغه — ذاكرة الجوال تُمحى وزبير الوحيد لا نسخة له. */
  serialize(): string {
    return JSON.stringify(this.snapshot());
  }

  async adopt(json: string): Promise<void> {
    this.restore(JSON.parse(json) as BrainState);
    await this.save();
  }
}

/* ————— أدوات صغيرة ————— */

const QUESTION_WORDS = new Set([
  /* بصورتها المطبَّعة كما تصل من الحاسّة: الألف المقصورة تصير ياءً، فـ«متى»
   * تصل «متي». وكانت مكتوبةً هنا بألفها المقصورة فلم تطابق شيئاً أبداً. */
  'ما', 'ماذا', 'شو', 'مين', 'من', 'كيف', 'ليش', 'لماذا', 'هل', 'اين', 'وين', 'متي',
  'امتي', 'كم', 'ايش', 'شنو', 'شلون', 'قديش', 'ليه', 'اي', 'فين',
]);

/** أدنى ثقةٍ يجوز الجزم بها. دونها يُقرّ بجهله ولو كان يملك المحمول: حقيقةٌ
 *  هدمها تصحيحُ الأب لا يجوز أن تُقال كأنها يقين. */
const ASSERT_FLOOR = 0.35;

/** مقدار ما يُرجَّح به ما يوافق هدفه. صغيرٌ بقصد: ميلٌ يُزيح ولا يحسم، فتبقى
 *  تجربتُه مع أبيه هي الحاكمة. */
const GOAL_LEAN = 0.3;

/** مَن يُغار مما عنده: أبوه وكل ثالث. ولا يغار المرء مما عنده هو. */
const OTHER_OWNERS = new Set(['الأب', 'غيره']);

/** أسماء الإشارة بصورتها المطبَّعة: بها يُعرَف أن الأب يشير إلى ما تراه الكاميرا. */
const DEMONSTRATIVE_KEYS = new Set([
  'هذا', 'هذه', 'هذي', 'هاد', 'هادا', 'هاي', 'هيدا', 'هيدي', 'هاذا', 'ذا',
]);

const STOP_WORDS = new Set([
  'هذا', 'هذه', 'هاد', 'هاي', 'هو', 'هي', 'في', 'من', 'على', 'عن', 'الى', 'ال', 'و', 'يعني', 'انا', 'انت',
]);

/** أقوى صلةٍ في خريطة الانتباه: أي كلمةٍ نظرت إلى أيّها. */
function strongestLink(map: readonly number[][], tokens: readonly string[]):
  { from: string; to: string; weight: number } | null {
  let best: { from: string; to: string; weight: number } | null = null;
  for (let i = 0; i < map.length; i++) {
    const row = map[i]!;
    for (let j = 0; j < row.length; j++) {
      // الكلمة تنظر إلى نفسها دائماً، وذاك ليس صلةً تُعرَض
      if (i === j) continue;
      const weight = row[j]!;
      if (!best || weight > best.weight) {
        best = { from: tokens[i] ?? '؟', to: tokens[j] ?? '؟', weight };
      }
    }
  }
  return best && best.weight > 0.35 ? best : null;
}

function goalAr(goal: 'LEARN' | 'ANSWER' | 'BOND' | 'REST'): string {
  switch (goal) {
    case 'LEARN': return 'أن يتعلّم';
    case 'ANSWER': return 'أن يجيب';
    case 'BOND': return 'أن يقترب منك';
    case 'REST': return 'أن يستريح';
  }
}

/** جنس الكلام من الاستراتيجية — مرآةٌ لما تُخرجه بروكا، وتُختبر مطابقتها. */
function speechKind(strategy: Strategy): TickOutput['kind'] {
  switch (strategy) {
    case 'ANSWER_MEMORY':
    case 'ANSWER_GENERAL': return 'answer';
    case 'ASK_QUESTION': return 'question';
    case 'ADMIT': return 'admission';
    case 'ACKNOWLEDGE': return 'acknowledge';
    case 'GREET_BACK': return 'greeting';
  }
}

function strategyAr(strategy: Strategy): string {
  switch (strategy) {
    case 'ANSWER_MEMORY': return 'الجواب من ذاكرته';
    case 'ANSWER_GENERAL': return 'الجواب بالتعميم';
    case 'ASK_QUESTION': return 'السؤال';
    case 'ADMIT': return 'الإقرار بجهله';
    case 'ACKNOWLEDGE': return 'الإقرار بالتلقّي';
    case 'GREET_BACK': return 'ردّ التحية';
  }
}

function defaultStorage(): import('./core/types.js').StoragePort {
  // الدماغ لا يعرف المتصفّح: يسأل عن وجوده بحراسة صريحة ليعمل في الاختبارات
  const hasWindow = typeof globalThis === 'object' && 'indexedDB' in globalThis;
  return hasWindow ? browserStorage() : memoryStorage();
}

function now(): number {
  return typeof performance === 'object' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

/** يُستخدم في الاختبارات للتأكّد أن كل استراتيجية معروفة لبروكا. */
export const ALL_STRATEGIES = STRATEGIES;
export { DIMS, argmax };
export type { Episode, GrowthMetrics, TickOutput };
