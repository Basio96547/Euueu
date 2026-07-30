import { PrismaService } from '../common/prisma.service.js';
import { FxService } from './fx.module.js';
import { expandQuery, normalizeAr, categoriesForQuery } from '../common/arabic.js';

/**
 * البحث — الفصل 6.
 *
 * كان محركان: Meilisearch حين يُهيَّأ، ومسار احتياط على القاعدة. وحُذف
 * الأول: لا خادم بحث داخل Cloudflare، وإبقاء شيفرته يُوهم بخيارٍ لا وجود
 * له. والاحتياط لم يكن احتياطاً بل هو المحرك: أُثبت في الفحص أنه يعطي
 * النتائج نفسها في كل استعلام — «ايفون» و«آيفون» و«جوال» و`ZA/A`.
 *
 * التطبيع والمرادفات وترتيب النتائج كما هي: هي التي تصنع البحث العربي،
 * لا المحرك.
 */

export class SearchService {
  constructor(private prisma: PrismaService) {}

  /** المستند يحمل السعر بالدولار حصراً — لا ليرة في الفهرس (الفصل 6) */
  private async documents() {
    const rows = await this.prisma.product.findMany({
      where: { status: 'PUBLISHED', deletedAt: null },
      include: { brand: true, category: true, variants: { include: { levels: true } } },
    });
    return rows.map((p) => {
      const v = p.variants[0];
      const stock = p.variants.reduce(
        (a, x) => a + x.levels.reduce((b, l) => b + (l.onHand - l.reserved), 0), 0,
      );
      const nameAr = (p.name as any).ar as string;
      return {
        id: p.publicId, slug: p.slug, name_ar: nameAr,
        name_norm: normalizeAr(nameAr + ' ' + (p.brand.name as any).ar),
        brand: p.brand.slug, category: p.category.slug,
        price_usd_cents: v ? Number(v.priceUsdCents) : 0,
        device_origin: v?.deviceOrigin ?? null,
        part_code: v?.partCode ?? null,
        dual_sim: v?.dualSim ?? false,
        condition: v?.condition ?? null,
        battery_health_pct: v?.batteryHealthPct ?? null,
        warranty_months: v?.warrantyMonths ?? 0,
        storage_gb: v?.storageGb ?? null,
        in_stock: stock > 0, is_demo: p.isDemo,
      };
    });
  }

  /**
   * إعادة الفهرسة.
   * لا فهرس خارجياً يُبنى: البحث يقرأ الكتالوج مباشرة. والمسار باقٍ لأن
   * النشر ينادِيه، وردُّه يقول ما جرى بصدق بدل أن يدّعي عملاً لم يقع.
   */
  async reindex() {
    const docs = await this.documents();
    return { engine: 'd1' as const, indexed: docs.length, note: 'البحث يقرأ الكتالوج مباشرة — لا فهرس منفصل' };
  }

  async search(q: string, f: { origin?: string; condition?: string; maxUsd?: number }) {
    const demo = (process.env.DEMO_MODE ?? 'true') === 'true';

    const terms = expandQuery(q);
    const genericCats = categoriesForQuery(q);
    const docs = await this.documents();
    const hits = docs.filter((d) => {
      if (!demo && d.is_demo) return false;
      if (f.origin && d.device_origin !== f.origin) return false;
      if (f.condition && d.condition !== f.condition) return false;
      if (f.maxUsd && d.price_usd_cents > f.maxUsd) return false;
      if (!q) return true;
      if (genericCats.includes(d.category)) return true;
      return terms.some((t) => d.name_norm.includes(t) || d.brand.includes(t) ||
        (d.part_code ?? '').toLowerCase().includes(t));
    });
    /* الترتيب: المتوفر أولاً، ثم الأجهزة قبل الملحقات، ثم السعر.
       من يبحث «ايفون» يريد جهازاً لا جراباً — والسعر وحده يرفع الملحقات الرخيصة. */
    const weight = (c: string) =>
      c.startsWith('smartphones') || c === 'used-refurbished' || c === 'feature-phones' ? 0 : 1;
    hits.sort((a, b) =>
      Number(b.in_stock) - Number(a.in_stock) ||
      weight(a.category) - weight(b.category) ||
      a.price_usd_cents - b.price_usd_cents);
    return { engine: 'd1', hits: hits.slice(0, 24), total: hits.length };
  }
}

