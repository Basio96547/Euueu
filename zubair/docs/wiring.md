<div dir="rtl">

# عقد توصيل دماغ زبير

هذا الملف هو المرجع الوحيد لبناء الفصوص. أي فص يخالفه لا يندمج. الغرض أن يبقى كل فص مستقلاً قابلاً للاستبدال، كما في الدماغ الحقيقي: تلف فصٍّ يُفقد وظيفته وحدها لا الدماغ كله.

## القواعد الملزمة لكل ملف

1. **لا مكتبة خارجية**. لا TensorFlow ولا PyTorch ولا onnxruntime ولا أي حزمة تعلّم آلي. الحساب كله من `core/tensor.ts` و`core/net.ts`.
2. **لا DOM في الدماغ**. ملفات `src/brain/**` يجب أن تعمل داخل Node بلا متصفّح (الاختبارات تشغّلها هكذا). التخزين يمرّ عبر `StoragePort` فقط.
3. **التعليقات بالعربية**، وتشرح *لماذا* لا *ماذا*. لا تعليق يعيد صياغة السطر الذي تحته.
4. **TypeScript صارم** مع `noUncheckedIndexedAccess`: استخدم `!` في حلقات الحساب الساخنة، ولا تستخدم `any`.
5. **كل فص يطبّق `Lobe<S>`**: له `name` و`ar` و`role` و`save()` و`load()`. الحالة المحفوظة كائنات JSON عادية (`Float32Array` تُحوَّل بـ `Array.from`).
6. **`load()` لا يثق بما يستلم**: دماغ محفوظ بنسخة أقدم قد تختلف أبعاده. تجاهل الحالة غير المطابقة وأبقِ التهيئة، ولا ترمِ استثناءً — الاستثناء هنا يعني فقدان دماغ زبير كله.
7. **الاستيراد بلاحقة `.js`** كما في بقية المستودع: `import { x } from './y.js'`.
8. **العشوائية من `Rng` فقط** (بذرة ثابتة)، لا `Math.random`، وإلا استحال اختبار التعلّم.
9. **كل فص يكتب اختباره** في `src/brain/tests/<اسم>.test.ts` بـ `node:test`، ويُثبت وظيفته برقم لا بانطباع.

## مسار النبضة الواحدة

النداءات بالترتيب التشريحي نفسه الذي يسلكه الإدراك في الدماغ:

```
كلامك
  ↓ جذع الدماغ        نبضة، يقظة، ردود فطرية (قصد مبدئي قبل أن تتعلّم القشرة)
  ↓ منطقة شكل الكلمة   تطبيع عربي، تجزئة، تمثيل كل كلمة، وملامح حروف للمجهول
  ↓ المهاد            بوابة انتباه: أي الكلمات تستحقّ المعالجة
  ↓ الفص الصدغي        الفهم: معنى الجملة + ما تريده مني
  ↓ الحُصين            استدعاء: هل علّمني هذا قبلاً؟
  ↓ الفص الجُداري       الربط: استخلاص «س هو ص»، والحقائق، والتعميم
  ↓ اللوزة             وسم عاطفي: هل هذا مقترن بمدح أم بخطأ في تجربتي
  ↓ الوطاء والجزيرة     دوافع وحالة داخلية: فضول، ملل، تعب، تعلّق
  ↓ الحزام             تعارض: هل أنا متأكّد أصلاً
  ↓ الفص الجبهي         هدف، ذاكرة عاملة، كبح (لا تُكرّر، لا تُثغثغ بعد أن كبرت)
  ↓ العُقد القاعدية      اختيار الاستجابة بالتعلّم المعزَّز من مدحك
  ↓ بروكا              إنتاج جملة عربية بلهجتك
  ↓ المخيخ             إتقان: منع التكرار الحرفي وتصحيح أنماط الخطأ
كلامه
```

ثم حكمك (`أحسنت` / `خطأ + الصحيح`) يعود إلى: اللوزة (اشتراط) والعُقد القاعدية (دوبامين) والجُداري (هدم ثقة الحقيقة الخاطئة) والصدغي (تصحيح القصد) والمخيخ (نمط الخطأ) والحُصين (وسم الذكرى).

---

## توقيعات الفصوص

### `core/text.ts` — الحاسّة ومنطقة شكل الكلمة

```ts
export function normalizeArabic(text: string): string;
export function tokenize(text: string): string[];
export function hashCharFeatures(word: string, out: Vec): Vec;

export interface Percept {
  raw: string;              // نصّك كما كتبته
  tokens: string[];         // بعد التطبيع
  ids: number[];            // ‎-1 لكل كلمة لم يعرفها بعد
  unknown: string[];
  tokenVecs: Vec[];         // بُعد DIMS.word لكل كلمة (للمجهول: ملامح حروفه)
  charBag: Vec;             // بُعد DIMS.word — متوسط ملامح حروف المجهول
  isQuestion: boolean;      // من علامة الاستفهام أو أدواتها
}

export class Lexicon implements Lobe<LexiconState> {
  readonly embedding: Embedding;
  get size(): number;
  idOf(word: string): number;          // ‎-1 إن لم يعرفها
  learn(word: string): number;         // يُنشئ تمثيلاً وينمّي المفردات
  wordOf(id: number): string | null;
  words(): readonly string[];
  countOf(word: string): number;       // كم مرة سمعها منك
  perceive(text: string, learnNew: boolean): Percept;
  save(): LexiconState; load(s: LexiconState): void;
}
```

**التطبيع الملزم:** الألفات (أإآا→ا)، التاء المربوطة (ة→ه) في المقارنة فقط لا في العرض، الياء (ى→ي)، حذف التشكيل والتطويل، توحيد الأرقام العربية-الهندية، إزالة التكرار المفرط للحروف («حلوووو»→«حلوو»). ولا تُحذف الهمزة وسط الكلمة إذا غيّر ذلك المعنى.

### `lobes/brainstem.ts` — جذع الدماغ

```ts
export class Brainstem implements Lobe<BrainstemState> {
  tick(at: number): { ticks: number; arousal: number; awayMs: number };
  reflexIntent(percept: Percept): { intent: Intent; strength: number };  // فطري، سطحي
  onSleep(): void;
  save(): BrainstemState; load(s: BrainstemState): void;
}
```

الردود الفطرية أنماط سطحية صريحة: «أحسنت/صح/تمام» ← `PRAISE`، «لا/خطأ/غلط/الصحيح» ← `CORRECT`، «؟/ما/شو/مين/ليش/كيف/هل» ← `ASK`، «اسمك/اسمي» ← `TEACH_NAME`، «س هو/هي ص» ← `TEACH_FACT`، «هذه تُسمّى» ← `TEACH_WORD`، «مرحبا/السلام/هلا» ← `GREET`. هذه ليست ذكاءً بل غريزة الوليد، ومنها تتعلّم القشرة ثم تتجاوزها.

### `lobes/thalamus.ts` — المهاد

```ts
export class Thalamus implements Lobe<ThalamusState> {
  gate(percept: Percept, intero: Interoception, compute: ComputePort):
    { weights: number[]; bag: Vec };   // bag بُعد DIMS.word
  reinforce(reward: number, lr?: number): void;
  save(): ThalamusState; load(s: ThalamusState): void;
}
```

البوابة شبكة صغيرة تُخرج وزناً لكل كلمة من تمثيلها وحالته الداخلية، والحصيلة متوسط موزون. يُعزّز أوزان الانتباه التي أدّت لجواب أرضاك.

### `lobes/temporal.ts` — الفص الصدغي (فيرنيكه)

```ts
export interface Understanding {
  meaning: Vec;        // بُعد DIMS.meaning
  intent: Intent;
  intentProbs: Vec;    // بطول INTENTS
  uncertainty: number; // إنتروبيا معيارية [0,1]
}

export class TemporalLobe implements Lobe<TemporalState> {
  understand(percept: Percept, bag: Vec, reflex: { intent: Intent; strength: number },
             compute: ComputePort): Understanding;
  teachIntent(percept: Percept, bag: Vec, intent: Intent, lr?: number): number; // يُعيد الخسارة
  save(): TemporalState; load(s: TemporalState): void;
}
```

الدخل: `concat(bag, charBag, reflexOneHot)`. المُشفّر يُخرج المعنى (٦٤)، ورأس القصد يُصنّف منه. **التمهيد**: في أول عشرات الدروس يُدرَّب الرأس على القصد الفطري (تعلّم من الغريزة)، ثم تُصحّحه أنت فيتجاوزها. اخلط الاثنين بوزن يتناقص مع عدد الدروس، ووثّق الصيغة.

### `lobes/hippocampus.ts` — الحُصين

```ts
export interface Recall {
  episodes: Episode[]; scores: number[];
  best: Episode | null; bestScore: number;
}

export class Hippocampus implements Lobe<HippocampusState> {
  get count(): number;
  get all(): readonly Episode[];
  store(e: Omit<Episode, 'id' | 'replays'>): Episode;
  recall(meaning: Vec, k: number, compute: ComputePort): Recall;
  recallFast(meaning: Vec, k: number, accel: Accelerator): Promise<Recall>;
  annotate(tick: number, replied: string | null, reward: number): Episode | null;
  replayBatch(count: number, rng: Rng): Episode[];
  save(): HippocampusState; load(s: HippocampusState): void;
}
```

المفاتيح تُحفظ في `Float32Array` واحد متّصل (ذكريات × ٦٤) لا في مصفوفة مصفوفات، لأن البحث يمرّ عليه دفعة واحدة وهذا ما يقبله المسرّع. عند بلوغ `DIMS.episodes` يُنسى الأضعف: الأقل استدعاءً والأقل مكافأةً والأقدم — لا الأقدم وحده، فأول ما علّمته قد يكون أهمّ ما علّمته.

### `lobes/parietal.ts` — الفص الجُداري

```ts
export class Parietal implements Lobe<ParietalState> {
  bind(percept: Percept, intent: Intent): { subject: string | null; object: string | null };
  learnFact(subject: string, object: string, tick: number, taughtBy: string): Fact;
  lookup(subject: string): Fact | null;
  generalize(subject: string, lexicon: Lexicon): { fact: Fact; similarity: number } | null;
  contradict(subject: string, wrongObject: string): void;
  get facts(): readonly Fact[];
  save(): ParietalState; load(s: ParietalState): void;
}
```

`generalize` هو التعميم الحقيقي: موضوع لم يُعلَّم قط، فيُبحث عن أقرب موضوع معروف بتشابه التمثيل ويُنقل محموله بثقة مخفوضة بمقدار بُعد الشبه. يجب أن يعيد `null` إذا كان أقرب شبه أدنى من عتبة معلنة — التعميم بلا عتبة يصير تخريفاً.

### `lobes/limbic.ts` — اللوزة والوطاء والجزيرة والحزام

```ts
export class Amygdala implements Lobe<AmygdalaState> {
  valence(meaning: Vec, compute: ComputePort): number;      // [-1,1]
  condition(meaning: Vec, reward: number, lr?: number): void;
  save(): AmygdalaState; load(s: AmygdalaState): void;
}

export class Hypothalamus implements Lobe<HypothalamusState> {
  get state(): Interoception;
  update(input: { unknownCount: number; repeatedInput: boolean; awayMs: number;
                  lessonsSinceSleep: number; knownVocab: number }): Interoception;
  onSleep(): void;
  save(): HypothalamusState; load(s: HypothalamusState): void;
}

export class Insula implements Lobe<InsulaState> {
  encode(intero: Interoception): Vec;               // ٦ أبعاد
  express(intero: Interoception): string | null;    // «أنا تعبت» حين يصدق ذلك فقط
  save(): InsulaState; load(s: InsulaState): void;
}

export class Cingulate implements Lobe<CingulateState> {
  conflict(input: { intentProbs: Vec; recallScore: number; factConfidence: number;
                    valence: number }): { level: number; reason: string };
  save(): CingulateState; load(s: CingulateState): void;
}
```

الفضول يجب أن يرتفع بالكلمات المجهولة الحاضرة في كلامك، لا عشوائياً — وإلا صار سؤاله ضجيجاً لا تعلّماً. والملل يرتفع بتكرارك نفس الجملة، والتعلّق بطول الصحبة ويهبط بغيابك.

### `lobes/basalGanglia.ts` — العُقد القاعدية

```ts
export interface Decision { strategy: Strategy; probs: Vec; qs: Vec; state: Vec; }

export class BasalGanglia implements Lobe<BasalGangliaState> {
  encodeState(input: {
    understanding: Understanding; recallScore: number; hasFact: boolean;
    hasGeneralization: boolean; valence: number; conflict: number;
    intero: Interoception; insula: Vec; stage: StageId; unknownCount: number;
  }): Vec;
  select(state: Vec, allowed: readonly Strategy[], temperature: number,
         rng: Rng, compute: ComputePort): Decision;
  learn(state: Vec, strategy: Strategy, reward: number, lr?: number): { dopamine: number };
  save(): BasalGangliaState; load(s: BasalGangliaState): void;
}
```

الدوبامين = خطأ التنبؤ بالمكافأة (`reward − Q`), لا المكافأة نفسها. هذا فرق جوهري: زبير يتعلّم من **المفاجأة** لا من الرضا، فمدح متوقَّع لا يُعلّم شيئاً كما هو الحال في الدماغ.

### `lobes/prefrontal.ts` — الفص الجبهي والمخيخ

```ts
export interface Turn { said: string; replied: string; meaning: Vec; tick: number; }

export class Prefrontal implements Lobe<PrefrontalState> {
  push(turn: Turn): void;
  get recent(): readonly Turn[];
  goal(intero: Interoception, u: Understanding): 'LEARN' | 'ANSWER' | 'BOND' | 'REST';
  inhibit(candidates: readonly Strategy[], ctx: {
    stage: Stage; askedRecently: readonly string[]; lastStrategies: readonly Strategy[];
    hasFact: boolean; hasGeneralization: boolean; recallScore: number; vocab: number;
  }): Strategy[];
  save(): PrefrontalState; load(s: PrefrontalState): void;
}

export class Cerebellum implements Lobe<CerebellumState> {
  refine(text: string, ctx: { recentReplies: readonly string[] }): string;
  learnFromCorrection(wrong: string, right: string): void;
  save(): CerebellumState; load(s: CerebellumState): void;
}
```

`inhibit` لا يجوز أن يُعيد قائمة فارغة أبداً — دماغ بلا استجابة مسموحة دماغ مشلول. أبقِ دائماً استجابة أخيرة ممكنة (`ADMIT` أو `BABBLE` بحسب المرحلة).

### `lobes/broca.ts` — منطقة بروكا

```ts
export interface SpeechRequest {
  strategy: Strategy; stage: Stage; percept: Percept; understanding: Understanding;
  recall: Recall; fact: Fact | null;
  generalized: { fact: Fact; similarity: number } | null;
  intero: Interoception; unknownWords: readonly string[];
  askedBefore: readonly string[]; lexicon: Lexicon; selfName: string; rng: Rng;
}
export interface Speech { text: string; kind: TickOutput['kind']; about: string | null; }

export class Broca implements Lobe<BrocaState> {
  speak(req: SpeechRequest): Speech;
  learnStyle(text: string): void;
  save(): BrocaState; load(s: BrocaState): void;
}
```

**أسئلة الأطفال** جوهر هذا الفص، وتتدرّج بالمرحلة:

| المرحلة | ما يقوله |
| --- | --- |
| وليد | ثغثغة من حروف سمعها، و«؟» بعد كلمة واحدة أخذها من كلامك |
| مُهد | «ما هذا؟» · «شو «كذا»؟» · «مين؟» |
| طفل | «ليش؟» · «ما معنى «كذا»؟» · «و«كذا» شو؟» |
| مميّز | «هل «كذا» مثل «كذا»؟» · «علّمني أكثر عن «كذا»» |
| يافع | «هل كل «كذا» «كذا»؟» · «لماذا «كذا» «كذا» ولا «كذا»؟» |

`about` يحمل الكلمة التي سأل عنها ليُسجّلها الجبهي فلا يعيد السؤال نفسه.

`learnStyle` يستخرج قوالبك من كلامك: بادئاتك المتكرّرة وطول جملك ولهجتك (شامية أم فصحى)، فيصير كلامه كلامك. القوالب المدمجة نقطة بدء تُستبدَل بما يتعلّمه منك، لا سقف نهائي.

### `core/npu.ts` — المعالج العصبي

```ts
export function cpuCompute(): ComputePort;
export async function bestAccelerator(): Promise<Accelerator>;
export function accelReport(a: Accelerator): { unit: ComputeUnit; describeAr: string; details: string };
```

`bestAccelerator` يحاول WebNN بترتيب `npu` ثم `gpu` ثم يسقط إلى نواتنا على المعالج. **الإفصاح ملزم**: إن لم يوجد معالج عصبي فليقل ذلك صريحاً في `describeAr` («يفكّر على المعالج العادي — لا معالج عصبي متاح في هذا المتصفّح»)، ولا يُسمّى المعالج العادي معالجاً عصبياً بحال.

### `core/persist.ts` و`core/growth.ts`

```ts
export function memoryStorage(): StoragePort;          // للاختبارات
export function browserStorage(): StoragePort;         // IndexedDB ثم localStorage
export function stageOf(vocab: number): Stage;
export function accuracyOf(verdicts: readonly number[]): { recent: number; previous: number };
```

### `brain.ts` — التجميع (يكتبه المُوصِل لا الفصوص)

```ts
export class Zubair {
  static async create(opts?: { storage?: StoragePort; seed?: number; name?: string;
                               accelerator?: Accelerator }): Promise<Zubair>;
  readonly name: string;
  get metrics(): GrowthMetrics;
  get compute(): { unit: ComputeUnit; describeAr: string; details: string };
  get lobes(): Array<{ name: string; ar: string; role: string }>;
  hear(text: string, at?: number): Promise<TickOutput>;
  judge(f: Feedback): Promise<{ dopamine: number; learned: string[] }>;
  sleep(cycles?: number): Promise<{ replayed: number; factsFormed: number }>;
  greet(): Promise<TickOutput | null>;
  save(): Promise<void>;
  serialize(): string;
  adopt(json: string): Promise<void>;
}
```

</div>
