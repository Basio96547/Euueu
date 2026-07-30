/* ————— منطقة بروكا: الكلام —————
 *
 * آخر فص في المسار وأول ما يراه الأب. غيره يفكّر، وهذا ينطق.
 *
 * وأهم ما فيه أنه **يتدرّج**: الوليد لا يُنتج جملة تامة، والطفل يسأل «ليش؟»،
 * واليافع يسأل «هل كل كذا كذا؟». لو أُعطي زبير من أول يوم لغةً كاملة لكان
 * برنامجاً يتنكّر في هيئة طفل، ولانكشف الكذب في أول جلسة. التدرّج هو الصدق.
 *
 * ويتعلّم لهجة أبيه: القوالب المدمجة نقطة بدء لا سقفاً. بعد شواهد كافية من
 * كلام الأب يقدّم ما تعلّمه على ما وُلد به.
 */

import type { Rng } from '../core/tensor.js';
import type { Lexicon } from '../core/text.js';
import type { Percept } from '../core/text.js';
import type { Recall } from './hippocampus.js';
import type { Understanding } from './temporal.js';
import type { Fact, Interoception, Lobe, Stage, Strategy, TickOutput } from '../core/types.js';

export interface SpeechRequest {
  strategy: Strategy;
  stage: Stage;
  percept: Percept;
  understanding: Understanding;
  recall: Recall;
  fact: Fact | null;
  generalized: { fact: Fact; similarity: number } | null;
  intero: Interoception;
  unknownWords: readonly string[];
  askedBefore: readonly string[];
  lexicon: Lexicon;
  selfName: string;
  rng: Rng;
}

export interface Speech {
  text: string;
  kind: TickOutput['kind'];
  /** الكلمة التي سأل عنها — يُسجّلها الجبهي فلا يعيد السؤال نفسه */
  about: string | null;
}

export interface BrocaState {
  shami: number;
  fusha: number;
  totalWords: number;
  sentences: number;
  openers: Array<{ word: string; count: number }>;
}

/* ————— شواهد اللهجة ————— */
const SHAMI_MARKERS: readonly string[] = ['شو', 'هيك', 'منيح', 'كيفك', 'ليش', 'هلق', 'كتير', 'بدي', 'مو', 'شلون', 'هاد', 'هاي', 'لك', 'يلا'];
const FUSHA_MARKERS: readonly string[] = ['ماذا', 'هكذا', 'جيد', 'كيف', 'لماذا', 'الآن', 'كثيرا', 'اريد', 'ليس', 'هذا', 'هذه', 'نعم'];

/** أدنى عدد شواهد قبل أن يُقدّم لهجة على أخرى. أقلّ من ذلك تخمين لا تعلّم. */
const DIALECT_MIN = 3;

/** مقاطع الثغثغة: صامت + صائت، وهي أول ما ينطقه أي طفل في أي لغة. */
const BABBLE_CONSONANTS: readonly string[] = ['ب', 'م', 'د', 'ت', 'ن', 'ل', 'ك', 'ج'];
const BABBLE_VOWELS: readonly string[] = ['ا', 'و', 'ي'];

export class Broca implements Lobe<BrocaState> {
  readonly name = 'broca';
  readonly ar = 'منطقة بروكا';
  readonly role = 'يصوغ جملته العربية، ويتعلّم أسلوبك ولهجتك فيصير كلامه كلامك';

  private shami = 0;
  private fusha = 0;
  private totalWords = 0;
  private sentences = 0;
  private openers = new Map<string, number>();

  /* بروكا لا تملك عشوائية خاصة بها بقصد: تستلمها في كل طلب من الدماغ (req.rng)
   * كي يبقى كلام زبير قابلاً للإعادة بنفس البذرة — وهو شرط إثبات تعلّمه في
   * الاختبارات. فصٌّ يخفي مولّده العشوائي داخله لا يمكن اختبار كلامه. */

  /** أيّهما لهجته الآن: الشامية أم الفصحى — بحسب ما سمع من أبيه. */
  private get isShami(): boolean {
    if (this.shami + this.fusha < DIALECT_MIN) return true; // البدء بالشامية: الأب سوري
    return this.shami >= this.fusha;
  }

  private pick(options: readonly string[], rng: Rng): string {
    if (options.length === 0) return '';
    return options[rng.int(options.length)] ?? options[0]!;
  }

  speak(req: SpeechRequest): Speech {
    const speech = this.compose(req);
    // حدّ المرحلة حدٌّ فعليّ لا زينة: الوليد لا ينطق جملة مهما كان جوابه صحيحاً
    const trimmed = limitWords(speech.text, req.stage.maxWords);
    return { ...speech, text: trimmed.length > 0 ? trimmed : this.babble(req).text };
  }

  private compose(req: SpeechRequest): Speech {
    switch (req.strategy) {
      case 'BABBLE': return this.babble(req);
      case 'ASK_QUESTION': return this.ask(req);
      case 'ANSWER_MEMORY': return this.answerFromMemory(req);
      case 'ANSWER_GENERAL': return this.answerByGeneralizing(req);
      case 'ADMIT': return this.admit(req);
      case 'ACKNOWLEDGE': return this.acknowledge(req);
      case 'GREET_BACK': return this.greet(req);
    }
  }

  /* ————— الثغثغة —————
   * من حروف سمعها فعلاً في كلام أبيه لا من حروف عشوائية: الوليد يُثغثغ بما سمع.
   * وأحياناً يُعيد جزءاً من كلمة قالها أبوه، وهذا أول أثر للتقليد. */
  private babble(req: SpeechRequest): Speech {
    const heard = req.percept.tokens.filter((t) => /[ء-ي]/.test(t));
    const rng = req.rng;

    if (heard.length > 0 && rng.next() < 0.4) {
      const word = heard[rng.int(heard.length)]!;
      const piece = word.slice(0, Math.max(2, Math.min(3, word.length)));
      return { text: `${piece}${piece}`, kind: 'babble', about: null };
    }

    const letters: string[] = [];
    for (const token of heard) for (const ch of token) letters.push(ch);
    const consonants = letters.length > 0 ? letters : BABBLE_CONSONANTS;

    const syllable = (): string => {
      const c = consonants[rng.int(consonants.length)] ?? 'ب';
      const v = BABBLE_VOWELS[rng.int(BABBLE_VOWELS.length)] ?? 'ا';
      return `${c}${v}`;
    };

    const count = 1 + rng.int(2);
    let out = '';
    for (let i = 0; i < count; i++) out += syllable();
    return { text: out, kind: 'babble', about: null };
  }

  /* ————— السؤال: أسئلة أطفال متدرّجة —————
   * يسأل عمّا يجهله فعلاً: كلمة مجهولة حاضرة في كلام أبيه أولاً، فيكون جواب
   * الأب في موضع الحاجة لا في الفراغ. */
  private ask(req: SpeechRequest): Speech {
    const target = this.questionTarget(req);
    const rng = req.rng;

    if (!target) {
      const blind = this.isShami
        ? ['شو هذا؟', 'شو صار؟', 'وبعدين؟']
        : ['ما هذا؟', 'ماذا حدث؟', 'ثم ماذا؟'];
      return { text: this.pick(blind, rng), kind: 'question', about: null };
    }

    let options: readonly string[];
    switch (req.stage.id) {
      case 0:
        options = [`${target}؟`, 'شو؟'];
        break;
      case 1:
        options = this.isShami
          ? [`شو ${target}؟`, `${target}؟ شو هذا؟`, 'مين؟']
          : [`ما ${target}؟`, `${target}؟ ما هذا؟`, 'من؟'];
        break;
      case 2:
        options = this.isShami
          ? [`شو يعني ${target}؟`, `ليش ${target}؟`, `و${target} شو؟`]
          : [`ما معنى ${target}؟`, `لماذا ${target}؟`, `و${target} ماذا؟`];
        break;
      case 3:
        options = this.isShami
          ? [`${target} شو يعني بالزبط؟`, `هل ${target} مثل الشي اللي علّمتني؟`, `علّمني أكثر عن ${target}`]
          : [`ما معنى ${target} بالضبط؟`, `هل ${target} مثل ما علّمتني؟`, `علّمني أكثر عن ${target}`];
        break;
      default:
        options = this.isShami
          ? [`هل كل ${target} هيك؟`, `ليش ${target} هيك ومو غير هيك؟`, `شو الفرق بين ${target} وغيره؟`]
          : [`هل كل ${target} كذلك؟`, `لماذا ${target} هكذا لا غير ذلك؟`, `ما الفرق بين ${target} وغيره؟`];
        break;
    }

    return { text: this.pick(options, rng), kind: 'question', about: target };
  }

  /** ما يسأل عنه: مجهول حاضر لم يسأل عنه قبلاً، أو أقلّ كلماته سماعاً. */
  private questionTarget(req: SpeechRequest): string | null {
    for (const word of req.unknownWords) {
      if (!req.askedBefore.includes(word)) return word;
    }
    // كل المجهول سُئل عنه: يسأل عن كلمة معروفة لكن قليلة السماع — يعرف لفظها
    // ولا يعرف معناها، وهذا حال الطفل مع أكثر ما يسمع
    let rarest: string | null = null;
    let fewest = Infinity;
    for (const token of req.percept.tokens) {
      if (req.askedBefore.includes(token)) continue;
      const count = req.lexicon.countOf(token);
      if (count > 0 && count < fewest) {
        fewest = count;
        rarest = token;
      }
    }
    return rarest;
  }

  /* ————— الجواب من ذاكرة صريحة ————— */
  private answerFromMemory(req: SpeechRequest): Speech {
    const raw = req.fact;
    if (!raw) return this.admit(req);
    // يتكلّم بصورة أبيه لا بالصورة المطبَّعة: «فاكهة» لا «فاكهه»
    const fact = { ...raw, subject: req.lexicon.pretty(raw.subject), object: req.lexicon.pretty(raw.object) };

    // لا لفظ تحفّظ هنا: علّمه أبوه هذا بنفسه، فالتحفّظ في موضع اليقين كذب معكوس
    const options = req.stage.id <= 1
      ? [`${fact.object}`, `${fact.subject} ${fact.object}`]
      : this.isShami
        ? [`${fact.subject} ${fact.object}`, `${fact.subject} هو ${fact.object}، علّمتني هيك`]
        : [`${fact.subject} ${fact.object}`, `${fact.subject} هو ${fact.object}، هكذا علّمتني`];

    return { text: this.pick(options, req.rng), kind: 'answer', about: fact.subject };
  }

  /* ————— الجواب بالتعميم —————
   * لم يُعلَّم هذا، فاستنتجه من شبيه. ويجب أن يظهر في كلامه أنه يخمّن: طفل
   * يقول التخمين يقيناً يُضلّل أباه فلا يصحّح له. */
  private answerByGeneralizing(req: SpeechRequest): Speech {
    const guess = req.generalized;
    if (!guess) return this.admit(req);
    const { similarity } = guess;
    const fact = {
      subject: req.lexicon.pretty(guess.fact.subject),
      object: req.lexicon.pretty(guess.fact.object),
    };

    const options = this.isShami
      ? [
        `أظن ${fact.object}… مثل ${fact.subject}؟`,
        `يمكن ${fact.object}، لأنه يشبه ${fact.subject}`,
        `مو متأكّد… أظن ${fact.object}`,
      ]
      : [
        `أظن ${fact.object}… مثل ${fact.subject}؟`,
        `ربما ${fact.object}، لأنه يشبه ${fact.subject}`,
        `لست متأكّداً… أظن ${fact.object}`,
      ];

    // شبه ضعيف يستحقّ تحفّظاً أصرح: يقين مزعوم على شبه بعيد هو التخريف نفسه
    const text = similarity < 0.7 ? this.pick(options.slice(2), req.rng) : this.pick(options, req.rng);
    return { text, kind: 'answer', about: fact.subject };
  }

  /* ————— الإقرار بالجهل: يطلب التعليم لا يعتذر ————— */
  private admit(req: SpeechRequest): Speech {
    const options = this.isShami
      ? ['ما بعرف، علّمني', 'ما بعرف شو هذا، علّمني', 'علّمني، بدي أعرف']
      : ['لا أعرف، علّمني', 'لا أعرف هذا، علّمني', 'علّمني، أريد أن أعرف'];
    return { text: this.pick(options, req.rng), kind: 'admission', about: null };
  }

  /* ————— الإقرار بالتلقّي: وأحياناً يُعيد ما تعلّمه ليؤكّده ————— */
  private acknowledge(req: SpeechRequest): Speech {
    const fact = req.fact;
    if (fact && req.rng.next() < 0.5 && req.stage.id >= 1) {
      const subject = req.lexicon.pretty(fact.subject);
      const object = req.lexicon.pretty(fact.object);
      return {
        text: this.isShami ? `${subject} ${object}، صح؟` : `${subject} ${object}، صحيح؟`,
        kind: 'acknowledge',
        about: fact.subject,
      };
    }
    const options = this.isShami
      ? ['حفظت', 'طيب', 'تمام', 'عرفت']
      : ['حفظت', 'حسناً', 'تمام', 'عرفت'];
    return { text: this.pick(options, req.rng), kind: 'acknowledge', about: null };
  }

  /* ————— ردّ التحية ————— */
  private greet(req: SpeechRequest): Speech {
    if (req.stage.id === 0) {
      return { text: this.isShami ? 'هلا' : 'مرحبا', kind: 'greeting', about: null };
    }
    const options = this.isShami
      ? ['هلا فيك', `هلا، أنا ${req.selfName}`, 'هلا، وينك؟']
      : ['مرحبا بك', `مرحبا، أنا ${req.selfName}`, 'مرحبا، أين كنت؟'];
    return { text: this.pick(options, req.rng), kind: 'greeting', about: null };
  }

  /* ————— تعلّم أسلوب الأب ————— */
  learnStyle(text: string): void {
    if (typeof text !== 'string' || text.trim().length === 0) return;
    const words = text.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return;

    this.sentences++;
    this.totalWords += words.length;

    const opener = words[0]!;
    this.openers.set(opener, (this.openers.get(opener) ?? 0) + 1);
    if (this.openers.size > 64) {
      const kept = [...this.openers.entries()].sort((a, b) => b[1] - a[1]).slice(0, 64);
      this.openers = new Map(kept);
    }

    for (const word of words) {
      if (SHAMI_MARKERS.includes(word)) this.shami++;
      else if (FUSHA_MARKERS.includes(word)) this.fusha++;
    }
  }

  /** متوسط طول جملة أبيه — يُستعمل مرجعاً للنمو لا حدّاً. */
  get averageFatherLength(): number {
    return this.sentences === 0 ? 0 : this.totalWords / this.sentences;
  }

  get dialectAr(): string {
    if (this.shami + this.fusha < DIALECT_MIN) return 'لم يتبيّن بعد';
    return this.shami >= this.fusha ? 'شامية' : 'فصحى';
  }

  save(): BrocaState {
    return {
      shami: this.shami,
      fusha: this.fusha,
      totalWords: this.totalWords,
      sentences: this.sentences,
      openers: [...this.openers.entries()].map(([word, count]) => ({ word, count })),
    };
  }

  load(state: BrocaState): void {
    try {
      if (!state || typeof state !== 'object') return;
      this.shami = intOr(state.shami, 0);
      this.fusha = intOr(state.fusha, 0);
      this.totalWords = intOr(state.totalWords, 0);
      this.sentences = intOr(state.sentences, 0);
      this.openers = new Map();
      if (Array.isArray(state.openers)) {
        for (const entry of state.openers) {
          if (entry && typeof entry.word === 'string') this.openers.set(entry.word, intOr(entry.count, 1));
        }
      }
    } catch { /* أسلوب عطب يُترك: يعود يتكلّم بقوالبه المدمجة */ }
  }
}

function limitWords(text: string, max: number): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= max) return words.join(' ');
  /* القصّ يقطع الجملة في وسطها فتبقى فاصلة أو واو معلّقة («ما بعرف،» و«علّمني،
   * بدي»)، وهي أظهر ما يجعل كلامه يبدو معطوباً لا طفولياً. فتُحذف علامات الوصل
   * من آخر المقصوص، وتُحذف كلمة الوصل الأخيرة إن كانت حرفاً معلّقاً. */
  let kept = words.slice(0, max);
  const dangling = new Set(['و', 'ثم', 'بدي', 'اريد', 'أريد', 'أن', 'ان', 'مثل', 'في', 'من', 'على']);
  while (kept.length > 1 && dangling.has(stripEdgePunctuation(kept[kept.length - 1]!))) kept = kept.slice(0, -1);
  let cut = kept.join(' ').replace(/[،؛:,\-–—]+$/u, '').trim();
  if (cut.length === 0) cut = words.slice(0, max).join(' ');
  // لو كانت جملة استفهام فالعلامة تُنقل: سؤال بلا علامة يصير خبراً
  return text.trim().endsWith('؟') && !cut.endsWith('؟') ? `${cut}؟` : cut;
}

function stripEdgePunctuation(word: string): string {
  return word.replace(/^[،؛:,\-–—]+|[،؛:,\-–—]+$/gu, '');
}

function intOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : fallback;
}
