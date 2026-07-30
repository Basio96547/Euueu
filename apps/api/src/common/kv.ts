/**
 * مخزن مفتاح ← قيمة بمهلة: رموز الدخول، ومفاتيح التفرّد، وعدّادات الحدّ.
 *
 * سائقان: Cloudflare KV حين يكون الربط موجوداً، وذاكرة العزلة حين لا
 * يكون. وذاكرة العزلة ليست خياراً للإنتاج بل شبكةُ أمان: كل عزلة عالمها
 * الخاص وتُنشأ وتُهدَم بلا إشعار، فرمزٌ يُولَّد في واحدة يُرفض في أخرى،
 * ومفتاح تفرّد يُخزَّن هنا يُحصِّل الطلب مرتين هناك.
 *
 * واتساق KV نهائي لا فوري، فحدّ المعدل قد يمرّر طلباً زائداً بين موقعين
 * متباعدين. مقبولٌ لحاجزٍ يمنع الإساءة، وأفضل بكثير من عدّادٍ يُمحى مع
 * العزلة التي حملته.
 *
 * (كان هنا سائق Redis — وحُذف: لا Redis داخل Worker، وشيفرةٌ ميتة تُوهم
 * بخيارٍ غير موجود.)
 */
export interface Kv {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSec: number): Promise<void>;
  del(key: string): Promise<void>;
  /** زيادة ذرّية بمهلة تُضبط عند أول زيادة — لحدّ المعدل */
  incr(key: string, ttlSec: number): Promise<number>;
  readonly driver: 'memory' | 'cf-kv';
}

class MemoryKv implements Kv {
  readonly driver = 'memory' as const;
  private store = new Map<string, { v: unknown; exp: number }>();

  private sweep() {
    // كنس كسول عند القراءة: مؤقّت دوري لمخزن قد يبقى فارغاً هدرٌ
    const now = Date.now();
    if (this.store.size > 5000) {
      for (const [k, e] of this.store) if (e.exp < now) this.store.delete(k);
    }
  }

  async get<T>(key: string): Promise<T | null> {
    this.sweep();
    const e = this.store.get(key);
    if (!e) return null;
    if (e.exp < Date.now()) { this.store.delete(key); return null; }
    return e.v as T;
  }

  async set<T>(key: string, value: T, ttlSec: number) {
    this.store.set(key, { v: value, exp: Date.now() + ttlSec * 1000 });
  }

  async del(key: string) { this.store.delete(key); }

  async incr(key: string, ttlSec: number): Promise<number> {
    const cur = (await this.get<number>(key)) ?? 0;
    const next = cur + 1;
    // المهلة تُضبط عند أول زيادة فقط، وإلا لم تنتهِ النافذة أبداً
    const e = this.store.get(key);
    this.store.set(key, { v: next, exp: e && e.exp > Date.now() ? e.exp : Date.now() + ttlSec * 1000 });
    return next;
  }
}

/** الشكل الأدنى من واجهة KVNamespace — بلا استيراد أنواع Cloudflare */
export interface CfKvNamespace {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

class CloudflareKv implements Kv {
  readonly driver = 'cf-kv' as const;
  constructor(private ns: CfKvNamespace) {}

  async get<T>(key: string): Promise<T | null> {
    const raw = await this.ns.get(key);
    if (raw === null) return null;
    try { return JSON.parse(raw) as T; } catch { return raw as T; }
  }

  async set<T>(key: string, value: T, ttlSec: number) {
    // أدنى مهلة يقبلها KV ستون ثانية، وما دونها يُرفض بخطأ
    await this.ns.put(key, JSON.stringify(value), { expirationTtl: Math.max(60, Math.ceil(ttlSec)) });
  }

  async del(key: string) { await this.ns.delete(key); }

  async incr(key: string, ttlSec: number): Promise<number> {
    /* KV لا يملك زيادةً ذرّية. القراءة ثم الكتابة تسمحان لطلبين متزامنين
       بقراءة العدّاد نفسه فيمرّ واحدٌ زائد. الحدّ هنا حاجزُ إساءةٍ لا
       قفلُ محاسبة، وثمن الدقّة الكاملة كائنٌ دائم لكل مفتاح. */
    const cur = (await this.get<number>(key)) ?? 0;
    const next = cur + 1;
    await this.set(key, next, ttlSec);
    return next;
  }
}

let instance: Kv | null = null;

/** يُستدعى من الـWorker: الربط يأتي من بيئة الطلب لا من متغيّر عملية */
export function useCloudflareKv(ns: CfKvNamespace | undefined): Kv {
  if (!ns) {
    if (!instance) instance = new MemoryKv();
    return instance;
  }
  if (instance?.driver !== 'cf-kv') instance = new CloudflareKv(ns);
  return instance;
}

export function kv(): Kv {
  if (!instance) instance = new MemoryKv();
  return instance;
}
