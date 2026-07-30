/* ————— الفص الصدغي (منطقة فيرنيكه) —————
 *
 * هنا يصير كلام أبيه معنى. الفص يفعل شيئين: يُشفّر الجملة في متجه واحد
 * («المعنى»)، ويصنّف ما يريده أبوه منها («القصد»).
 *
 * وأهم ما فيه ليس الشبكة بل المزج: الوليد لا يملك قشرة مدرَّبة، فلو اعتمد على
 * تصنيفه وحده لكان قصده عشوائياً محضاً. فيبدأ معتمداً على غريزة جذع الدماغ،
 * ثم ينتقل تدريجياً إلى ما تعلّمه من أبيه حتى يتجاوز غريزته. هذا هو أصل
 * «الطفل يتجاوز فطرته بالتعليم»، وهو مكتوب في صيغة واحدة أدناه.
 */

import { Mlp, Dense, softmaxCrossEntropyGrad } from '../core/net.js';
import { Rng, normalizedEntropy, softmax, vec, type Vec } from '../core/tensor.js';
import type { Percept } from '../core/text.js';
import {
  DIMS, INTENTS,
  type ComputePort, type Intent, type Lobe,
} from '../core/types.js';

export interface Understanding {
  meaning: Vec;
  intent: Intent;
  intentProbs: Vec;
  uncertainty: number;
}

export interface TemporalState {
  encoder: ReturnType<Mlp['save']>;
  head: ReturnType<Dense['save']>;
  lessons: number;
}

/**
 * بُعد دخل المُشفّر: حصيلة الانتباه + ملامح حروف المجهول + غريزة الجذع +
 * بُعدٌ واحد لعلامة الاستفهام.
 *
 * وهذا البُعد الأخير أُضيف بعد قياس، وغيابه كان عطلاً حقيقياً: التدريب يُحيّد
 * الغريزة بقصد (كي تتعلّم الشبكة من الكلمات لا تنسخ فطرتها)، فكانت علامة
 * الاستفهام — وهي أقوى دليل سطحي على السؤال — لا تصل المصنِّف في التدريب ولا في
 * الاستنتاج: تدخل الغريزة وحدها ثم يتضاءل وزنها بالخبرة حتى تختفي. فصار
 * «شو التفاحة؟» يُصنَّف تعليمَ حقيقة لأن بنيته كلمتان اسميّتان.
 *
 * وعلامة الاستفهام ليست غريزة بل **إدراك**: الحاسّة تراها في النصّ كما ترى
 * الحروف، فحقّها أن تصل القشرة مباشرة لا عبر الجذع.
 */
const IN_DIM = DIMS.word + DIMS.word + INTENTS.length + 1;

/**
 * نصف عمر الغريزة بالدروس. عند صفر دروس تُسيطر الغريزة سيطرة تامة، وعند
 * عشرين درساً تتساوى مع ما تعلّمه، ثم تتضاءل. اخترت عشرين لأنها قريبة من عدد
 * الدروس التي يعطيها أب في جلسة واحدة: أي أن ابنه يبدأ بالاعتماد عليه من
 * الجلسة الثانية لا من الأولى.
 */
const INSTINCT_HALFLIFE = 20;

export class TemporalLobe implements Lobe<TemporalState> {
  readonly name = 'temporal';
  readonly ar = 'الفص الصدغي';
  readonly role = 'يفهم معنى جملتك وماذا تريد منه: تعليم؟ سؤال؟ مدح؟ تصحيح؟';

  private readonly encoder: Mlp;
  private readonly head: Dense;
  private lessons = 0;

  /** مخزن دخل ثابت: النبضة تتكرّر آلاف المرات فلا نخصّص ذاكرة في كل مرة. */
  private readonly input: Vec = vec(IN_DIM);
  private readonly gradBuffer: Vec = vec(INTENTS.length);

  constructor(rng?: Rng) {
    const generator = rng ?? new Rng(0x7e3a);
    // طبقة خفيّة واحدة تكفي: الدخل قليل والأمثلة أقلّ، وشبكة أعمق على عشرين
    // مثالاً تحفظ ولا تُعمّم
    this.encoder = new Mlp([IN_DIM, DIMS.meaning], ['tanh'], generator);
    this.head = new Dense(DIMS.meaning, INTENTS.length, 'none', generator);
  }

  private fillInput(percept: Percept, bag: Vec, reflex: { intent: Intent; strength: number }): void {
    this.input.fill(0);
    const w = DIMS.word;
    for (let i = 0; i < w; i++) this.input[i] = bag[i] ?? 0;
    for (let i = 0; i < w; i++) this.input[w + i] = percept.charBag[i] ?? 0;
    // الغريزة تدخل الشبكة أيضاً لا في المزج وحده: فتتعلّم القشرة متى تصدق
    // غريزتها ومتى تكذّبها، بدل أن تجهلها
    const index = INTENTS.indexOf(reflex.intent);
    if (index >= 0) this.input[2 * w + index] = clamp01(reflex.strength);
    // علامة الاستفهام: إدراكٌ مباشر يصل في التدريب والاستنتاج معاً
    this.input[2 * w + INTENTS.length] = percept.isQuestion ? 1 : 0;
  }

  understand(
    percept: Percept,
    bag: Vec,
    reflex: { intent: Intent; strength: number },
    compute: ComputePort,
  ): Understanding {
    this.fillInput(percept, bag, reflex);
    const meaning = this.encoder.forward(this.input, compute).slice();
    const logits = this.head.forward(meaning, compute);
    const learned = softmax(logits);

    /* المزج: وزن الغريزة يتبع أمرين لا أمراً واحداً.
     *
     * الأول خبرته: w = 1 / (1 + الدروس ÷ نصف العمر). فعند صفر دروس يصير القصد
     * غريزياً محضاً، وبعد التعليم يغلب المتعلَّم حتى لو خالف الغريزة.
     *
     * والثاني **يقين قشرته**، وهو إصلاح عطل حقيقي كشفه الميراث: بعد ٧٨٠ خطوة
     * تدريب صار وزن الخبرة ٠٫٠٢٥، فإذا قال الأب جملةً كلماتها كلها جديدة
     * («الطائرة مركبة») لم تعرفها قشرته ولم تنقذه فطرته — فضاع درس أبيه وهو
     * أثمن ما عنده. والقشرة في تلك الحال احتمالاتها موزّعة أي أنها **لا تدري**،
     * فحقّ الغريزة أن تعود.
     *
     * وهذا موافق للإنسان: من عجز عن فهم جملة رجع إلى قرائنها السطحية، مهما بلغ
     * علمه. والتربيع يمنع أن يعود الشكّ اليسير بالغريزة كلها. */
    const byExperience = 1 / (1 + this.lessons / INSTINCT_HALFLIFE);
    const cortexDoubt = normalizedEntropy(learned) ** 2;

    /* والثالث أهمّها، وهو ما كشفه القياس بعد الأول والثاني: القشرة قد تكون
     * **واثقةً وهي مخطئة**. تعلّمت من كلمات تعرفها، فإذا جاءت جملة كل كلماتها
     * جديدة أعطت جواباً واثقاً بلا أساس — لأن حصيلة الانتباه التي تدخلها تكون
     * فارغة من المعنى. قِسته على أب يعلّم أربع حقائق جديدة، فصُنّفت واحدة
     * تصحيحاً وأخرى كلاماً عادياً، وضاع درسان من أربعة.
     *
     * فحين لا يعرف زبير كلمات الجملة أصلاً، لا رأي لقشرته فيها مهما بدت واثقة،
     * والبنية السطحية (كلمتان اسميّتان بلا استفهام = تعليم) أصدق دليل بقي. وهذا
     * هو الحال الذي يجب أن يعمل فيه الدماغ أحسن ما يكون: أبٌ يعلّم ابنه شيئاً
     * جديداً — وهو كل غرض المشروع. */
    const known = percept.tokens.length - percept.unknown.length;
    const unknownRatio = percept.tokens.length > 0
      ? 1 - known / percept.tokens.length
      : 0;

    const w = Math.max(byExperience, cortexDoubt, unknownRatio);
    const mixed = vec(INTENTS.length);
    const reflexIndex = INTENTS.indexOf(reflex.intent);
    let total = 0;
    for (let i = 0; i < INTENTS.length; i++) {
      let value = (1 - w) * (learned[i] ?? 0);
      if (i === reflexIndex) value += w * clamp01(reflex.strength);
      mixed[i] = value;
      total += value;
    }

    // غريزة بلا قوّة ومتعلَّم بلا وزن: نرجع إلى المتعلَّم بدل أن نقسم على صفر
    const probs = total > 1e-6 ? scaleTo(mixed, 1 / total) : learned.slice();

    let best = 0;
    for (let i = 1; i < probs.length; i++) if (probs[i]! > probs[best]!) best = i;

    return {
      meaning,
      intent: INTENTS[best] ?? 'UNKNOWN',
      intentProbs: probs,
      uncertainty: normalizedEntropy(probs),
    };
  }

  /** تعلّم مُوجَّه: هذا القصد هو الصحيح لهذه الجملة. من هنا يتعلّم من أبيه. */
  teachIntent(percept: Percept, bag: Vec, intent: Intent, lr = 0.02): number {
    const target = INTENTS.indexOf(intent);
    if (target < 0) return 0;

    // غريزة محيَّدة في التدريب: لو مرّرنا الغريزة الصحيحة لصار أسهل على الشبكة
    // أن تنسخها من أن تفهم الجملة، فلا تتعلّم شيئاً يفيد حين تخطئ الغريزة
    this.fillInput(percept, bag, { intent: 'UNKNOWN', strength: 0 });
    const meaning = this.encoder.forward(this.input);
    const logits = this.head.forward(meaning);
    const probs = softmax(logits);

    const loss = softmaxCrossEntropyGrad(probs, target, this.gradBuffer);
    const dMeaning = this.head.backward(this.gradBuffer);
    this.encoder.backward(dMeaning);
    this.head.step(lr);
    this.encoder.step(lr);

    this.lessons++;
    return loss;
  }

  get lessonCount(): number {
    return this.lessons;
  }

  save(): TemporalState {
    return { encoder: this.encoder.save(), head: this.head.save(), lessons: this.lessons };
  }

  load(state: TemporalState): void {
    try {
      if (!state || typeof state !== 'object') return;
      if (state.encoder) this.encoder.load(state.encoder);
      if (state.head) this.head.load(state.head);
      if (typeof state.lessons === 'number' && Number.isFinite(state.lessons)) {
        this.lessons = Math.max(0, Math.floor(state.lessons));
      }
    } catch {
      // حالة عطبة تُترك: قشرة نصف محمَّلة أسوأ من قشرة وليد
    }
  }
}

function clamp01(x: number): number {
  return Number.isFinite(x) ? (x < 0 ? 0 : x > 1 ? 1 : x) : 0;
}

function scaleTo(v: Vec, k: number): Vec {
  for (let i = 0; i < v.length; i++) v[i]! *= k;
  return v;
}
