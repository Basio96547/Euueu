/* ————— القشرة تحت الصدغية: التعرّف على الأشياء —————
 *
 * نهاية المسار البصري البطني («ما هذا؟»). القشرة البصرية تُخرج شكلاً ولوناً
 * وأبعاداً، وهذا الفص يجيب: **ما اسمه؟**
 *
 * وهو موضع الوصل بين حاسّتين: ما تراه العين وما تقوله أنت. تُوجّه الكاميرا إلى
 * تفاحة وتكتب «هذه تفاحة»، فيُقرن الشكل بالاسم. وهذا هو أصل تعلّم الأسماء عند
 * الطفل: لا يُلقَّن الكلمات، بل يُشار له إلى الشيء ويُسمّى.
 *
 * التعلّم بالنماذج لا بالانتشار الخلفي، وهذا قرار مقصود:
 *
 *   • الطفل يتعلّم اسم الشيء من **عرضة واحدة**. شبكة تُدرَّب بالانتشار الخلفي
 *     تحتاج عشرات الأمثلة لكل صنف قبل أن تُصيب، وأبٌ لا يُري ابنه التفاحة
 *     خمسين مرة. أما النموذج فيُحفظ من المرة الأولى ويُصيب بعدها.
 *   • والنموذج يتحسّن بالتكرار: كل عرضة جديدة تُقرّب النموذج المحفوظ إلى ما
 *     رآه، فيصير وسطاً لكل ما رآه من ذلك الشيء — لا صورةً واحدةً بزاويتها.
 *   • ويُحفظ لكل اسم أكثر من نموذج: التفاحة من فوق والتفاحة من الجانب شكلان
 *     مختلفان، وحصرهما في نموذج واحد يُنتج وسطاً لا يشبه أيّاً منهما.
 *
 * وعتبةٌ معلنة تمنعه من تسمية ما لا يعرف: من يسمّي كل ما يرى بأقرب اسم عنده
 * يُعلّم أباه أن يكذّبه.
 */

import { cosine, normalized, type Vec } from '../core/tensor.js';
import { clamp } from '../core/tensor.js';
import type { Lobe } from '../core/types.js';
import { VISION_FEATURES } from './visualCortex.js';

/** أقصى عدد نماذج لكل اسم: زوايا مختلفة للشيء نفسه. */
const VIEWS_PER_NAME = 4;

/** أقصى عدد أسماء مرئية يحملها — حدٌّ يحمي حجم دماغه على الجوال. */
const MAX_NAMES = 200;

/**
 * أقلّ تشابه يُبيح أن يُسمّي ما يراه.
 *
 * الرقم عالٍ بقصد: الوصف البصري مُسوّى الطول، والتشابه الجيبي بين منظرين
 * مختلفين تماماً يبلغ ٠٫٥ بسهولة لأن كليهما «منظر» فيه حدود وألوان. فالعتبة
 * يجب أن تكون فوق شبه المناظر العام لا فوق الصفر.
 */
const RECOGNIZE_THRESHOLD = 0.82;

/** وأقربُ اسم يجب أن يسبق الذي بعده بهذا الهامش، وإلا فالمنظر ملتبس بينهما. */
const RECOGNIZE_MARGIN = 0.03;

/** نصيب ما رآه الآن في تحديث النموذج: ثلاثةُ أعشار تُحسّن بلا أن تُمحي. */
const REFINE_RATE = 0.3;

interface Prototype {
  /** وصف بصري مُسوّى الطول */
  view: Float32Array;
  /** كم مرة أُكِّد هذا النموذج: مقياس رسوخه */
  hits: number;
  lastSeenTick: number;
}

interface ObjectRecord {
  name: string;
  prototypes: Prototype[];
  /** كم مرة سُمّي هذا الشيء لزبير */
  taught: number;
  /** كم مرة عرفه بعينه فأصاب */
  recognized: number;
  /** كم مرة سمّاه فصحّح له أبوه */
  corrected: number;
}

export interface Recognition {
  name: string;
  /** التشابه مع أقرب نموذج */
  similarity: number;
  /** ثقته: التشابه معزّزاً برسوخ النموذج ومنقوصاً بتصحيحات أبيه */
  confidence: number;
  /** الاسم الثاني الأقرب — به يعرف أنه ملتبس */
  runnerUp: string | null;
}

export interface InferotemporalState {
  objects: Array<{
    name: string;
    taught: number;
    recognized: number;
    corrected: number;
    prototypes: Array<{ view: number[]; hits: number; lastSeenTick: number }>;
  }>;
}

export class Inferotemporal implements Lobe<InferotemporalState> {
  readonly name = 'inferotemporal';
  readonly ar = 'القشرة تحت الصدغية';
  readonly role = 'يعرف الأشياء بعينه: تُريه شيئاً وتسمّيه له مرة، فيعرفه بعدها';

  private objects = new Map<string, ObjectRecord>();

  get knownCount(): number {
    return this.objects.size;
  }

  get names(): readonly string[] {
    return [...this.objects.keys()];
  }

  /**
   * التسمية: هذا الذي أراه اسمه كذا.
   *
   * إن كان الاسم معروفاً ورأى منظراً قريباً من نموذج محفوظ، حُسِّن النموذج بدل
   * أن يُضاف — فلا تتكرّر أربع نُسخ من الزاوية نفسها. وإن كان المنظر بعيداً عن
   * كل نماذجه فهو زاوية جديدة تستحقّ نموذجاً خاصاً بها.
   */
  teach(name: string, features: Vec, tick: number): void {
    const key = name.trim();
    if (key.length === 0 || features.length !== VISION_FEATURES) return;
    const view = Float32Array.from(normalized(features));

    let record = this.objects.get(key);
    if (!record) {
      if (this.objects.size >= MAX_NAMES) this.forgetWeakest();
      record = { name: key, prototypes: [], taught: 0, recognized: 0, corrected: 0 };
      this.objects.set(key, record);
    }
    record.taught++;

    let closest: Prototype | null = null;
    let closestSimilarity = -Infinity;
    for (const prototype of record.prototypes) {
      const similarity = cosine(view, prototype.view);
      if (similarity > closestSimilarity) {
        closestSimilarity = similarity;
        closest = prototype;
      }
    }

    /* عتبة «الزاوية الجديدة» أدنى من عتبة التعرّف: منظرٌ يشبه النموذج بنسبة
     * ٠٫٧ هو الشيء نفسه من زاوية قريبة فيُحسّنه، وما دونها منظرٌ آخر لنفس الشيء
     * فيُحفَظ بنموذج ثانٍ. */
    if (closest && closestSimilarity > 0.7) {
      for (let i = 0; i < closest.view.length; i++) {
        closest.view[i] = closest.view[i]! * (1 - REFINE_RATE) + view[i]! * REFINE_RATE;
      }
      closest.view.set(normalized(closest.view));
      closest.hits++;
      closest.lastSeenTick = tick;
      return;
    }

    if (record.prototypes.length >= VIEWS_PER_NAME) {
      // نُسقط أقلّ النماذج رسوخاً: زاوية رآها مرة واحدة أهون من زاوية رآها عشراً
      record.prototypes.sort((a, b) => a.hits - b.hits);
      record.prototypes.shift();
    }
    record.prototypes.push({ view, hits: 1, lastSeenTick: tick });
  }

  /** التعرّف: ما اسم هذا الذي أراه؟ وnull إن لم يبلغ يقينه العتبة. */
  recognize(features: Vec): Recognition | null {
    if (features.length !== VISION_FEATURES || this.objects.size === 0) return null;
    const view = normalized(features);

    let best: ObjectRecord | null = null;
    let bestSimilarity = -Infinity;
    let bestHits = 0;
    let secondName: string | null = null;
    let secondSimilarity = -Infinity;

    for (const record of this.objects.values()) {
      let similarity = -Infinity;
      let hits = 0;
      for (const prototype of record.prototypes) {
        const score = cosine(view, prototype.view);
        if (score > similarity) {
          similarity = score;
          hits = prototype.hits;
        }
      }
      if (similarity > bestSimilarity) {
        secondSimilarity = bestSimilarity;
        secondName = best?.name ?? null;
        bestSimilarity = similarity;
        bestHits = hits;
        best = record;
      } else if (similarity > secondSimilarity) {
        secondSimilarity = similarity;
        secondName = record.name;
      }
    }

    if (!best || !Number.isFinite(bestSimilarity) || bestSimilarity < RECOGNIZE_THRESHOLD) return null;

    /* الهامش يمنع التسمية الملتبسة: منظرٌ يشبه اسمين بنفس القدر ليس معروفاً بل
     * مشتبهاً، والصدق أن يقول «لا أعرف» لا أن يقترع بينهما. */
    if (secondSimilarity > -Infinity && bestSimilarity - secondSimilarity < RECOGNIZE_MARGIN) return null;

    /* الثقة ليست التشابه: نموذجٌ أُكِّد عشر مرات أوثق من نموذج رآه مرة، وشيءٌ
     * صُحّح فيه مراراً أقلّ ثقةً مهما تشابه المنظر. */
    const grounding = clamp(bestHits / 5, 0.4, 1);
    const doubt = clamp(best.corrected / (best.taught + best.corrected + 1), 0, 0.5);
    const confidence = clamp(bestSimilarity * grounding * (1 - doubt), 0, 1);

    return { name: best.name, similarity: bestSimilarity, confidence, runnerUp: secondName };
  }

  /** أصاب في تسميته: يُقوّى النموذج الذي أعطاه الجواب. */
  confirm(name: string, features: Vec, tick: number): void {
    const record = this.objects.get(name.trim());
    if (!record) return;
    record.recognized++;
    this.teach(name, features, tick);
  }

  /**
   * أخطأ في تسميته: يُضعَف الخطأ ويُعلَّم الصواب.
   *
   * لا يُمحى النموذج الخاطئ من مرة واحدة — قد يكون أبوه هو من أخطأ في الفهم،
   * أو المنظر كان ملتبساً حقاً. لكن الإصرار يُسقطه: هذا هو نفس منطق الحقائق في
   * الفص الجُداري، وسببه واحد.
   */
  correct(wrongName: string, rightName: string | null, features: Vec, tick: number): void {
    const wrong = this.objects.get(wrongName.trim());
    if (wrong) {
      wrong.corrected++;
      // نُبعد النموذج الأقرب عمّا رآه: تعلّمٌ سالب على مستوى النموذج
      let closest: Prototype | null = null;
      let closestSimilarity = -Infinity;
      const view = normalized(features);
      for (const prototype of wrong.prototypes) {
        const similarity = cosine(view, prototype.view);
        if (similarity > closestSimilarity) {
          closestSimilarity = similarity;
          closest = prototype;
        }
      }
      if (closest) {
        for (let i = 0; i < closest.view.length; i++) {
          closest.view[i] = closest.view[i]! - (view[i] ?? 0) * 0.15;
        }
        closest.view.set(normalized(closest.view));
      }
      // نموذجٌ صُحّح أكثر مما أُكِّد لا يستحقّ البقاء: خير له أن يجهل الشيء
      if (wrong.corrected > wrong.taught + wrong.recognized) this.objects.delete(wrong.name);
    }

    if (rightName && rightName.trim().length > 0) this.teach(rightName, features, tick);
  }

  /** كم مرة سُمّي هذا الشيء وكم مرة عرفه — يُعرض للأب في سجل النمو. */
  statsOf(name: string): { taught: number; recognized: number; corrected: number; views: number } | null {
    const record = this.objects.get(name.trim());
    if (!record) return null;
    return {
      taught: record.taught,
      recognized: record.recognized,
      corrected: record.corrected,
      views: record.prototypes.length,
    };
  }

  private forgetWeakest(): void {
    let weakest: ObjectRecord | null = null;
    let weakestScore = Infinity;
    for (const record of this.objects.values()) {
      const hits = record.prototypes.reduce((sum, p) => sum + p.hits, 0);
      const score = hits + record.taught + record.recognized;
      if (score < weakestScore) {
        weakestScore = score;
        weakest = record;
      }
    }
    if (weakest) this.objects.delete(weakest.name);
  }

  save(): InferotemporalState {
    return {
      objects: [...this.objects.values()].map((record) => ({
        name: record.name,
        taught: record.taught,
        recognized: record.recognized,
        corrected: record.corrected,
        prototypes: record.prototypes.map((p) => ({
          view: Array.from(p.view), hits: p.hits, lastSeenTick: p.lastSeenTick,
        })),
      })),
    };
  }

  load(state: InferotemporalState): void {
    try {
      if (!Array.isArray(state?.objects)) return;
      const restored = new Map<string, ObjectRecord>();
      for (const entry of state.objects) {
        if (!entry || typeof entry.name !== 'string' || entry.name.length === 0) continue;
        if (!Array.isArray(entry.prototypes)) continue;
        const prototypes: Prototype[] = [];
        for (const p of entry.prototypes) {
          if (!p || !Array.isArray(p.view) || p.view.length !== VISION_FEATURES) continue;
          const view = Float32Array.from(p.view, (value) => (Number.isFinite(value) ? value : 0));
          prototypes.push({
            view,
            hits: intOr(p.hits, 1),
            lastSeenTick: intOr(p.lastSeenTick, 0),
          });
        }
        if (prototypes.length === 0) continue;
        restored.set(entry.name, {
          name: entry.name,
          prototypes,
          taught: intOr(entry.taught, 1),
          recognized: intOr(entry.recognized, 0),
          corrected: intOr(entry.corrected, 0),
        });
      }
      this.objects = restored;
    } catch { /* ذاكرة أشياء عطبة تُترك: يعود يتعلّم ما يرى من جديد */ }
  }
}

function intOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : fallback;
}
