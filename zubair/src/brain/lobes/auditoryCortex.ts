/* ————— القشرة السمعية (الفص الصدغي العلوي) —————
 *
 * الخطوة الرابعة من الإدراك في مسارها السمعي: تترجم إشارة القوقعة إلى **أصوات
 * ونبرات**.
 *
 * وحدٌّ يجب أن يُقال أولاً بلا مواربة: هذه أذنٌ تسمع الصوت لا الكلام. تحويل
 * صوتك إلى حروف يحتاج نموذجاً مدرَّباً على آلاف الساعات من الكلام المسجَّل، ولا
 * سبيل إليه من الصفر بهذا الحجم. فزبير يسمع علوّ صوتك ونبرته وإيقاعه، ويميّز
 * تصفيقك من كلامك، ويعرف صوتك من صوت غيرك بنبرته — أما الحروف فتبقى بالكتابة.
 *
 * وهذا ليس نقصاً مخفيّاً بل هو حال الوليد نفسه: يعرف صوت أمه من الأسبوع الأول،
 * ولا يفهم كلمة واحدة منه قبل أشهر.
 *
 * ثلاث وظائف تُبنى هنا، وكلها موجودة في القشرة السمعية الحقيقية:
 *   • الخريطة التونوتوبية: تمثيل مرتّب بالتردّد — نطاقات القوقعة كما وصلت
 *   • كشف البدايات (onset): خلايا تستجيب لبَدء الصوت لا لاستمراره
 *   • تمييز النبرة: من تردّد الأساس، وبه يُعرف المتكلّم
 */

import { SENSE_DIMS, type CochlearSignal } from '../core/senses.js';
import { clamp, vec, type Vec } from '../core/tensor.js';
import type { Lobe } from '../core/types.js';

/**
 * طول الوصف السمعي بترتيب معلن ثابت:
 *   [0..23]  طاقة نطاقات القوقعة (تونوتوبية)
 *   [24]     علوّ الصوت
 *   [25]     حدّة البداية: كم ارتفع الصوت عن اللحظة السابقة
 *   [26]     النبرة مُسوّاة (٦٥–٤٠٠ هرتز → صفر إلى واحد)، وصفرٌ لغير النغمي
 *   [27]     أهو نغمي أصلاً؟
 *   [28]     خشونة الطيف: توزّع الطاقة — الكلام خشِن والصفير أملس
 *   [29]     مركز الثقل الطيفي: أهو صوت حادّ أم غليظ
 */
export const HEARING_FEATURES = SENSE_DIMS.cochlea + 6;

/** أدنى علوّ يُعدّ صوتاً. تحته سكونٌ لا يستحقّ معالجة ولا يُدرَّب عليه شيء. */
const SILENCE = 0.04;

/** نغمة الطفل والمرأة والرجل كلها بين هذين، والتسوية عليهما. */
const PITCH_MIN = 65;
const PITCH_MAX = 400;

export type SoundKind = 'صمت' | 'صوت بشري' | 'طرق' | 'ضجيج';

export interface AuditoryPercept {
  features: Vec;
  loudness: number;
  /** تصنيف خشن لنوع الصوت — لا تعرّف على الكلام */
  kind: SoundKind;
  /** النبرة بالهرتز إن كان نغمياً */
  pitchHz: number | null;
  /** بروز الصوت: به يفتح المهاد بوابته أو يُغلقها */
  salience: number;
}

export interface AuditoryCortexState {
  /** متوسط نبرة ما سمعه: به يعرف صوت أبيه من صوت غريب */
  familiarPitch: number | null;
  heard: number;
}

export class AuditoryCortex implements Lobe<AuditoryCortexState> {
  readonly name = 'auditoryCortex';
  readonly ar = 'القشرة السمعية';
  readonly role = 'يسمع الصوت ونبرته وإيقاعه — ويعرف صوتك من غيره، لا حروفه';

  private previousLoudness = 0;
  private familiarPitch: number | null = null;
  private heard = 0;

  listen(cochlea: CochlearSignal): AuditoryPercept {
    const features = vec(HEARING_FEATURES);
    const bands = cochlea.bands;
    const loudness = clamp(cochlea.loudness, 0, 1);

    for (let i = 0; i < SENSE_DIMS.cochlea && i < bands.length; i++) {
      features[i] = clamp(bands[i] ?? 0, 0, 1);
    }

    const base = SENSE_DIMS.cochlea;
    features[base] = loudness;

    /* حدّة البداية: الفرق الموجب عن اللحظة السابقة. خلايا البداية في القشرة
     * السمعية تستجيب لبَدء الصوت لا لاستمراره، ولهذا تلتفت إلى بابٍ يُطرق ولا
     * تشعر بهدير المكيّف بعد دقيقة. */
    const onset = clamp(loudness - this.previousLoudness, 0, 1);
    features[base + 1] = onset;
    this.previousLoudness = loudness;

    const tonal = cochlea.pitchHz !== null && loudness > SILENCE;
    features[base + 2] = tonal
      ? clamp((cochlea.pitchHz! - PITCH_MIN) / (PITCH_MAX - PITCH_MIN), 0, 1)
      : 0;
    features[base + 3] = tonal ? 1 : 0;

    const { roughness, centroid } = this.describeSpectrum(bands);
    features[base + 4] = roughness;
    features[base + 5] = centroid;

    if (loudness > SILENCE) this.heard++;

    /* نبرة مألوفة: متوسط متحرّك لنبرات ما سمع. أبوه هو من يكلّمه أكثر الوقت،
     * فمتوسط النبرات يقترب من نبرته، فيصير الشاذّ عنها صوتاً غريباً. */
    if (tonal) {
      const pitch = cochlea.pitchHz!;
      this.familiarPitch = this.familiarPitch === null
        ? pitch
        : this.familiarPitch * 0.95 + pitch * 0.05;
    }

    return {
      features,
      loudness,
      kind: this.classify(loudness, tonal, onset, roughness),
      pitchHz: tonal ? cochlea.pitchHz : null,
      // البداية أبرز من الاستمرار: صوتٌ يبدأ يستحقّ الانتباه أكثر من صوت قائم
      salience: clamp(loudness * 0.6 + onset * 1.4, 0, 1),
    };
  }

  /**
   * تصنيف خشن للصوت — ثلاثة أنواع لا أكثر، وكلها من خصائص فيزيائية صريحة:
   *   • صوت بشري: نغميّ (له تردّد أساس) وطيفه خشِن
   *   • طرق: بداية حادّة جداً بلا نغمة — تصفيق أو نقر على الطاولة
   *   • ضجيج: صوت مستمرّ بلا نغمة
   * ولا يُزعم أكثر من هذا: تمييز الكلمات ليس من شأن هذا الفص ولا هذا المشروع.
   */
  private classify(loudness: number, tonal: boolean, onset: number, roughness: number): SoundKind {
    if (loudness <= SILENCE) return 'صمت';
    if (tonal && roughness > 0.25) return 'صوت بشري';
    if (onset > 0.3) return 'طرق';
    return 'ضجيج';
  }

  /** خشونة الطيف ومركز ثقله: أهو صوت حادّ أم غليظ، أملس أم متعدّد القمم. */
  private describeSpectrum(bands: Float32Array): { roughness: number; centroid: number } {
    const n = bands.length;
    if (n === 0) return { roughness: 0, centroid: 0.5 };

    let total = 0;
    let weighted = 0;
    for (let i = 0; i < n; i++) {
      const energy = bands[i] ?? 0;
      total += energy;
      weighted += energy * i;
    }
    const centroid = total > 1e-6 ? weighted / total / Math.max(1, n - 1) : 0.5;

    // الخشونة: متوسط الفرق بين نطاق وجاره. طيفٌ أملس صفيرٌ، وطيفٌ متعرّج كلام
    let roughness = 0;
    for (let i = 1; i < n; i++) roughness += Math.abs((bands[i] ?? 0) - (bands[i - 1] ?? 0));
    roughness = clamp((roughness / Math.max(1, n - 1)) * 6, 0, 1);

    return { roughness, centroid };
  }

  /** أهذا الصوت مألوف؟ يُقاس ببعد نبرته عن النبرة المألوفة. */
  familiarity(pitchHz: number | null): number {
    if (pitchHz === null || this.familiarPitch === null) return 0;
    const distance = Math.abs(pitchHz - this.familiarPitch);
    // خمسون هرتزاً فرقٌ محسوس بين متكلّمين، فتكون نصف المسافة إلى الغرابة
    return clamp(1 - distance / 100, 0, 1);
  }

  get familiarPitchHz(): number | null {
    return this.familiarPitch;
  }

  save(): AuditoryCortexState {
    return { familiarPitch: this.familiarPitch, heard: this.heard };
  }

  load(state: AuditoryCortexState): void {
    try {
      if (!state || typeof state !== 'object') return;
      if (typeof state.familiarPitch === 'number' && Number.isFinite(state.familiarPitch)
        && state.familiarPitch > 0) {
        this.familiarPitch = state.familiarPitch;
      }
      if (typeof state.heard === 'number' && Number.isFinite(state.heard)) {
        this.heard = Math.max(0, Math.floor(state.heard));
      }
    } catch { /* أذنٌ تبدأ بلا مألوف: أسوأ ما يحدث أن يتعلّم نبرتك من جديد */ }
  }
}
