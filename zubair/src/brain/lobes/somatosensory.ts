/* ————— القشرة الحسية الجسدية (الفص الجُداري الأمامي) —————
 *
 * الخطوة الرابعة من الإدراك في مسارها الجسدي: تترجم **الحرارة والضغط والألم**.
 *
 * وجوال زبير يملك من ذلك ثلاثة: اللمس على الشاشة، وحركة الجهاز، وضوء المحيط.
 * ولا يملك حرارةً ولا ألماً حقيقيين — فالألم هنا معنى لا إحساس: الهزّ العنيف
 * يُوسَم سلباً كما يُوسَم الألم، والمسح اللطيف يُوسَم إيجاباً كما تُوسَم الملامسة
 * الحنون. وهذا ليس تلفيقاً: اللوزة في الدماغ تسم ما يصلها من الحسّ الجسدي
 * بالقيمة العاطفية، وهذا بالضبط ما نصله بها.
 *
 * ولماذا يهمّ هذا الفص في طفل يتعلّم بالكتابة: لأن اللمس أول ما يعرفه الوليد
 * قبل أن يرى بوضوح وقبل أن يفهم كلمة. وهو أول ما يخلق التعلّق: طفل يُلمَس
 * برفق يتعلّق، وجهاز يُهَزّ يتعلّم النفور.
 */

import { SENSE_DIMS, type BodySignal } from '../core/senses.js';
import { clamp, vec, type Vec } from '../core/tensor.js';
import type { Lobe } from '../core/types.js';

/**
 * طول الوصف الجسدي بترتيب معلن ثابت:
 *   [0..7]  إشارة الجسد الخام (بترتيب BODY_ORDER)
 *   [8]     نوع الملامسة: نقرة أم ضغط طويل
 *   [9]     الحركة المُهدّأة زمنياً — لا اللحظية
 *   [10]    الاهتزاز: تبدّل الحركة سريعاً — هذا هو الهزّ
 *   [11]    الظلمة: كفّ اليد على الكاميرا أو غرفة مطفأة
 */
export const BODY_FEATURES = SENSE_DIMS.body + 4;

/** فوق هذا الحدّ تكون الحركة هزّاً لا حملاً. مقدَّر على تسارع الجاذبية. */
const SHAKE = 0.55;

/** لمسة أطول من هذا ضغطٌ لا نقرة. */
const PRESS_MS_RATIO = 0.35;

export type TouchKind = 'لا لمس' | 'نقرة' | 'ضغط' | 'مسح';

export interface SomaticPercept {
  features: Vec;
  kind: TouchKind;
  /** شدّة ما يحدث للجسد: صفر سكون، وواحد هزّ عنيف */
  intensity: number;
  /**
   * قيمة عاطفية فطرية للإحساس، تذهب إلى اللوزة كما يذهب الألم واللذّة.
   * موجب للملامسة اللطيفة، سالب للهزّ العنيف، صفر للسكون.
   */
  innateValence: number;
  salience: number;
}

export interface SomatosensoryState {
  touches: number;
  shakes: number;
  smoothedMotion: number;
}

export class Somatosensory implements Lobe<SomatosensoryState> {
  readonly name = 'somatosensory';
  readonly ar = 'القشرة الحسية الجسدية';
  readonly role = 'يحسّ لمسك على الشاشة وحركة جهازه وضوء مكانه — والهزّ عنده أذى';

  private smoothedMotion = 0;
  private previousMotion = 0;
  private lastTouch: { x: number; y: number } | null = null;
  private touches = 0;
  private shakes = 0;

  feel(body: BodySignal): SomaticPercept {
    const features = vec(BODY_FEATURES);
    for (let i = 0; i < SENSE_DIMS.body && i < body.values.length; i++) {
      features[i] = body.values[i] ?? 0;
    }

    const base = SENSE_DIMS.body;
    const duration = body.values[3] ?? 0;
    const force = body.values[2] ?? 0;

    /* نوع الملامسة يُفرَّق بالمدّة والانتقال لا بالضغط وحده: الشاشات لا تُخبر
     * بالضغط الحقيقي في أكثر الأجهزة، فتكون المدّة والحركة هما ما نملكه. */
    let kind: TouchKind = 'لا لمس';
    if (body.touched) {
      const x = body.values[0] ?? 0;
      const y = body.values[1] ?? 0;
      const moved = this.lastTouch ? Math.hypot(x - this.lastTouch.x, y - this.lastTouch.y) : 0;
      kind = moved > 0.06 ? 'مسح' : duration > PRESS_MS_RATIO ? 'ضغط' : 'نقرة';
      this.lastTouch = { x, y };
      this.touches++;
    } else {
      this.lastTouch = null;
    }

    features[base] = kind === 'ضغط' ? 1 : kind === 'مسح' ? 0.5 : 0;

    /* تهدئة الحركة زمنياً: القراءة اللحظية من مقياس التسارع مليئة بالضجيج،
     * ويدٌ ثابتة تُعطي قيماً متذبذبة. المتوسط المتحرّك يفرّق الحمل من الهزّ. */
    this.smoothedMotion = this.smoothedMotion * 0.7 + body.motion * 0.3;
    features[base + 1] = clamp(this.smoothedMotion, 0, 1);

    // الاهتزاز: تبدّل الحركة نفسها. جهاز يُحمل تتغيّر حركته ببطء، والمهزوز بسرعة
    const jerk = clamp(Math.abs(body.motion - this.previousMotion) * 3, 0, 1);
    this.previousMotion = body.motion;
    features[base + 2] = jerk;

    const light = body.values[7] ?? 0.5;
    features[base + 3] = clamp(1 - light * 2, 0, 1);

    const shaking = this.smoothedMotion > SHAKE || jerk > 0.6;
    if (shaking) this.shakes++;

    /* القيمة الفطرية: هذه هي «الألم واللذّة» في حدود ما يملكه الجهاز.
     * المسح اللطيف موجب، والنقرة محايدة قليلة الإيجاب، والهزّ سالب بقدره.
     * والوسم فطري لا متعلَّم: الوليد ينفر من الهزّ قبل أن يتعلّم شيئاً. */
    let innateValence = 0;
    if (kind === 'مسح') innateValence = 0.5;
    else if (kind === 'ضغط') innateValence = 0.2;
    else if (kind === 'نقرة') innateValence = 0.15;
    if (shaking) innateValence -= clamp(this.smoothedMotion + jerk, 0, 1);

    const intensity = clamp(Math.max(this.smoothedMotion, force, body.touched ? 0.3 : 0), 0, 1);

    return {
      features,
      kind,
      intensity,
      innateValence: clamp(innateValence, -1, 1),
      // اللمس بارز دائماً: لا يُلمَس الطفل فيتجاهل. والحركة تبرز بقدرها
      salience: clamp((body.touched ? 0.7 : 0) + this.smoothedMotion * 0.6 + jerk * 0.5, 0, 1),
    };
  }

  get touchCount(): number {
    return this.touches;
  }

  get shakeCount(): number {
    return this.shakes;
  }

  save(): SomatosensoryState {
    return { touches: this.touches, shakes: this.shakes, smoothedMotion: this.smoothedMotion };
  }

  load(state: SomatosensoryState): void {
    try {
      if (!state || typeof state !== 'object') return;
      if (typeof state.touches === 'number' && Number.isFinite(state.touches)) {
        this.touches = Math.max(0, Math.floor(state.touches));
      }
      if (typeof state.shakes === 'number' && Number.isFinite(state.shakes)) {
        this.shakes = Math.max(0, Math.floor(state.shakes));
      }
      if (typeof state.smoothedMotion === 'number' && Number.isFinite(state.smoothedMotion)) {
        this.smoothedMotion = clamp(state.smoothedMotion, 0, 1);
      }
    } catch { /* حسٌّ يبدأ من سكون: لا معرفة تُفقَد */ }
  }
}
