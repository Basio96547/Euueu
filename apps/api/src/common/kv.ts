import { createClient, type RedisClientType } from 'redis';

/**
 * مخزن مفتاح ← قيمة بمهلة.
 *
 * سائقان بواجهة واحدة: الذاكرة حين لا يُضبط REDIS_URL، وRedis حين يُضبط.
 *
 * الذاكرة تكفي نسخة خادم واحدة وتكفي أغلب عمر هذا المتجر. لكنها تنكسر
 * بصمت لحظة تشغيل نسخة ثانية: رمز الدخول يُولَّد في نسخة ويُتحقَّق منه
 * في أخرى فيُرفض، ومفتاح التفرّد يُخزَّن هنا فيُحصَّل الطلب مرتين هناك،
 * وحدّ المعدل يصير ضِعف ما كُتب لأن لكل نسخة عدّادها.
 *
 * ولأن العطل صامت لا صاخب، يُطبع تحذير عند الإقلاع بدل انتظار اكتشافه
 * يوم التوسّع — وهو اليوم الذي يكون فيه المتجر مشغولاً بما يكفي.
 */
export interface Kv {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSec: number): Promise<void>;
  del(key: string): Promise<void>;
  /** زيادة ذرّية بمهلة تُضبط عند أول زيادة — لحدّ المعدل */
  incr(key: string, ttlSec: number): Promise<number>;
  readonly driver: 'redis' | 'memory';
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

class RedisKv implements Kv {
  readonly driver = 'redis' as const;
  constructor(private client: RedisClientType) {}

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
    const client: RedisClientType = createClient({ url });
    client.on('error', (e) => console.error('Redis:', e?.message ?? e));
    await client.connect();
    instance = new RedisKv(client);
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
