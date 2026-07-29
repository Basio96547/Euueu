/**
 * مخزن مفتاح ← قيمة بمهلة.
 *
 * ثلاثة سائقين بواجهة واحدة: ذاكرة العملية، وRedis، وCloudflare KV.
 *
 * الذاكرة تكفي نسخة خادم واحدة. لكنها تنكسر بصمت لحظة تشغيل نسخة ثانية:
 * رمز الدخول يُولَّد في نسخة ويُتحقَّق منه في أخرى فيُرفض، ومفتاح التفرّد
 * يُخزَّن هنا فيُحصَّل الطلب مرتين هناك، وحدّ المعدل يصير ضِعف ما كُتب.
 *
 * وعلى Worker هذا ليس احتمالاً بل يقين: كل عزلة عالمها الخاص وتُنشأ
 * وتُهدَم بلا إشعار. لذلك السائق هناك هو Cloudflare KV — واتساقه نهائي
 * لا فوري، فحدّ المعدل قد يمرّر طلباً زائداً بين موقعين متباعدين.
 * مقبولٌ لحاجزٍ يمنع الإساءة، وهو أفضل بكثير من عدّادٍ يُمحى مع العزلة.
 */
export interface Kv {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSec: number): Promise<void>;
  del(key: string): Promise<void>;
  /** زيادة ذرّية بمهلة تُضبط عند أول زيادة — لحدّ المعدل */
  incr(key: string, ttlSec: number): Promise<number>;
  readonly driver: 'redis' | 'memory' | 'cf-kv';
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

interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, opts: { EX: number }): Promise<unknown>;
  del(key: string): Promise<unknown>;
  incr(key: string): Promise<number>;
  expire(key: string, sec: number): Promise<unknown>;
}

class RedisKv implements Kv {
  readonly driver = 'redis' as const;
  constructor(private client: RedisLike) {}

  async get<T>(key: string): Promise<T | null> {
    const raw = await this.client.get(key);
    if (raw === null) return null;
    try { return JSON.parse(raw) as T; } catch { return raw as T; }
  }

  async set<T>(key: string, value: T, ttlSec: number) {
    await this.client.set(key, JSON.stringify(value), { EX: ttlSec });
  }

  async del(key: string) { await this.client.del(key); }

  async incr(key: string, ttlSec: number): Promise<number> {
    const n = await this.client.incr(key);
    // NX يمنع تمديد النافذة مع كل طلب — وإلا لم تنتهِ أبداً تحت ضغط
    if (n === 1) await this.client.expire(key, ttlSec);
    return n;
  }
}

let instance: Kv | null = null;
let warned = false;

/** يُستدعى من الـWorker: الربط يأتي من بيئة الطلب لا من متغيّر عملية */
export function useCloudflareKv(ns: CfKvNamespace | undefined): Kv {
  if (!ns) {
    if (!instance) instance = new MemoryKv();
    return instance;
  }
  if (instance?.driver !== 'cf-kv') instance = new CloudflareKv(ns);
  return instance;
}

export async function initKv(): Promise<Kv> {
  if (instance) return instance;

  const url = process.env.REDIS_URL;
  if (!url) {
    instance = new MemoryKv();
    console.warn('KV في الذاكرة — لنسخة خادم واحدة فقط.');
    console.warn('عند تشغيل أكثر من نسخة اضبط REDIS_URL، وإلا رُفضت رموز الدخول وتكرّر التحصيل.');
    return instance;
  }

  try {
    /* استراتيجية إعادة محاولة محدودة ومهلة اتصال صريحة.
       الافتراضي في node-redis إعادةُ محاولة بلا نهاية، فـRedis مضبوط
       لكنه متوقف يعلّق الإقلاع إلى الأبد — والمتجر يبقى مطفأً بانتظار
       خدمة مساعدة. المتجر أهمّ من مخزنه المؤقّت.

       والاستيراد كسول: حزمة redis لا مكان لها في حزمة الـWorker،
       وربطها ساكناً يجرّها إلى بناءٍ لا يستعملها. */
    const { createClient } = await import('redis');
    const client = createClient({
      url,
      socket: {
        connectTimeout: 3000,
        reconnectStrategy: (retries: number) => (retries > 5 ? false : Math.min(retries * 200, 1000)),
      },
    });
    // بلا مستمع للخطأ يرمي node-redis استثناءً غير ملتقَط يُسقط العملية
    client.on('error', (e: any) => {
      if (!warned) { console.error('Redis:', e?.message ?? e); warned = true; }
    });
    await Promise.race([
      client.connect(),
      new Promise((_, rej) => setTimeout(() => rej(new Error('مهلة الاتصال')), 4000)),
    ]);
    instance = new RedisKv(client as unknown as RedisLike);
    console.log(`KV على Redis: ${url.replace(/:\/\/.*@/, '://***@')}`);
  } catch (e) {
    /* الفشل لا يُسقط الخادم: متجرٌ يعمل بذاكرة محلية أفضل من متجر
       لا يعمل. لكن الرسالة صريحة لأن الصمت هنا خطر. */
    console.error(`تعذّر الاتصال بـRedis (${String(e)}) — التحويل إلى الذاكرة.`);
    instance = new MemoryKv();
  }
  return instance;
}

export function kv(): Kv {
  if (!instance) instance = new MemoryKv();
  return instance;
}
