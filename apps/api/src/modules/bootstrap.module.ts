import { Errors } from '../common/errors.js';
import type { D1Binding } from '../common/prisma.service.js';
import { MIGRATION_SQL, SEED_SQL } from '../generated/bootstrap-sql.js';

/**
 * تهيئة القاعدة من داخل الـWorker.
 *
 * الأصل أن يُهيَّأ D1 بأداته: `wrangler d1 migrations apply`. وهي تحتاج
 * مفتاحاً بصلاحية D1، ومفتاح النشر في هذا المستودع لا يملكها بعدُ
 * (`code: 7403`)، فكان الترحيل يُوقف كل نشرة قبل أن تبدأ.
 *
 * فبقي طريقٌ واحد لا يحتاج مفتاحاً: الـWorker يملك ربط القاعدة أصلاً.
 * وهذا المسار يستعمله مرة واحدة.
 *
 * حارسه أنه لا يعمل إلا على قاعدة فارغة: وجود جدول `products` يعني أن
 * التهيئة تمّت، فيُرفض الطلب. لا يُسقط بيانات، ولا يُعيد بذر متجرٍ يعمل،
 * ولا يصير باباً خلفياً — أسوأ ما يفعله من يجده أن يُهيّئ قاعدةً فارغة.
 *
 * ويُحذف حين يملك مفتاح النشر صلاحية D1: الأداة أولى بهذا العمل، وشيفرةٌ
 * لغرضٍ انقضى تُحذف لا تُترك «لعلّها تنفع».
 */
export class BootstrapService {
  constructor(private db: D1Binding) {}

  private async tables(): Promise<string[]> {
    const rs: any = await (this.db as any)
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all();
    return (rs?.results ?? []).map((r: any) => r.name as string);
  }

  async status() {
    const t = await this.tables();
    return {
      initialized: t.includes('products'),
      tables: t.filter((n) => !n.startsWith('_')).length,
    };
  }

  /** يُنفَّذ على قاعدة فارغة فقط، والجُمل واحدةً واحدةً ليُعرف أين تعثّرت */
  async run(withSeed = true) {
    const before = await this.tables();
    if (before.includes('products')) {
      throw Errors.badRequest('ALREADY_INITIALIZED',
        'القاعدة مهيّأة أصلاً — التهيئة لا تُعاد على قاعدة تحمل بيانات',
        'Database already initialized');
    }

    const applied = { schema: 0, seed: 0, errors: [] as string[] };

    for (const stmt of split(MIGRATION_SQL)) {
      try {
        await (this.db as any).prepare(stmt).run();
        applied.schema++;
      } catch (e) {
        applied.errors.push(`[مخطَّط] ${short(stmt)} ← ${msg(e)}`);
      }
    }

    if (withSeed && !applied.errors.length) {
      for (const stmt of split(SEED_SQL)) {
        try {
          await (this.db as any).prepare(stmt).run();
          applied.seed++;
        } catch (e) {
          applied.errors.push(`[بذرة] ${short(stmt)} ← ${msg(e)}`);
        }
      }
    }

    const after = await this.tables();
    return {
      ...applied,
      tables: after.filter((n) => !n.startsWith('_')).length,
      ok: applied.errors.length === 0,
    };
  }
}

/** فصل الجُمل: المحفِّز يحوي فاصلة منقوطة داخله فيُعامَل ككتلة واحدة */
function split(sql: string): string[] {
  const out: string[] = [];
  let buf: string[] = [];
  let depth = 0;
  let inTrigger = false;

  for (const line of sql.split('\n')) {
    const st = line.trim();
    if (!st || st.startsWith('--')) { if (!buf.length) continue; }
    buf.push(line);

    if (/^CREATE TRIGGER/i.test(st)) inTrigger = true;
    if (inTrigger) {
      if (st === 'END;') { out.push(buf.join('\n').trim()); buf = []; inTrigger = false; }
      continue;
    }
    depth += (line.match(/\(/g)?.length ?? 0) - (line.match(/\)/g)?.length ?? 0);
    if (st.endsWith(';') && depth <= 0) {
      out.push(buf.join('\n').trim());
      buf = [];
      depth = 0;
    }
  }
  return out.filter((s) => s && !s.startsWith('--'));
}

const short = (s: string) => s.replace(/\s+/g, ' ').slice(0, 70);
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 160);
