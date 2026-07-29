import { Controller, Get, Inject, Injectable, Query } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service.js';
import { FxService } from './fx.module.js';
import { expandQuery, normalizeAr, buildSynonyms, categoriesForQuery } from '../common/arabic.js';

const MEILI = process.env.MEILI_HOST;
const MEILI_KEY = process.env.MEILI_MASTER_KEY ?? '';
const INDEX = 'products';

@Injectable()
export class SearchService {
  constructor(@Inject(PrismaService) private prisma: PrismaService) {}

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

  async reindex() {
    const docs = await this.documents();
    if (!MEILI) {
      return { engine: 'postgres' as const, indexed: docs.length, note: 'Meilisearch غير مهيّأ — يعمل مسار الاحتياط' };
    }
    const h = { 'content-type': 'application/json', authorization: `Bearer ${MEILI_KEY}` };
    await fetch(`${MEILI}/indexes`, { method: 'POST', headers: h, body: JSON.stringify({ uid: INDEX, primaryKey: 'id' }) });
    await fetch(`${MEILI}/indexes/${INDEX}/settings`, {
      method: 'PATCH', headers: h,
      body: JSON.stringify({
        searchableAttributes: ['name_ar', 'name_norm', 'brand', 'part_code'],
        filterableAttributes: ['brand', 'category', 'price_usd_cents', 'device_origin',
          'part_code', 'dual_sim', 'condition', 'storage_gb', 'in_stock', 'is_demo'],
        sortableAttributes: ['price_usd_cents'],
        synonyms: buildSynonyms(),
        /* العتبة تُقاس بالبايت لا بالحرف، والحرف العربي بايتان.
           فـ«ايفون» خمسة أحرف تُحسب عشرة بايتات، فتنال تسامحاً مصمَّماً
           لكلمة من عشرة أحرف — ولذلك كانت تطابق «إنفينكس».
           12 بايت ≈ ستة أحرف عربية: الحد الذي يمنع هذا الخلط.

           الثمن صريح: الاسم اللاتيني القصير يفقد تسامحه، فـ«Lightening»
           لم تعد تجد «Lightning». وهذا مقبول هنا — الأسماء اللاتينية
           تُنسخ أو تُختار من المرشّحات، والعربية تُكتب بالأصابع؛
           والنتيجة الكاذبة تُفقد الثقة بالبحث كله لا بنتيجة واحدة. */
        typoTolerance: { enabled: true, minWordSizeForTypos: { oneTypo: 12, twoTypos: 18 } },
      }),
    });
    await fetch(`${MEILI}/indexes/${INDEX}/documents`, { method: 'PUT', headers: h, body: JSON.stringify(docs) });
    return { engine: 'meilisearch' as const, indexed: docs.length };
  }

  async search(q: string, f: { origin?: string; condition?: string; maxUsd?: number }) {
    const demo = (process.env.DEMO_MODE ?? 'true') === 'true';

    if (MEILI) {
      const base: string[] = [];
      if (!demo) base.push('is_demo = false');
      if (f.origin) base.push(`device_origin = "${f.origin}"`);
      if (f.condition) base.push(`condition = "${f.condition}"`);
      if (f.maxUsd) base.push(`price_usd_cents <= ${f.maxUsd}`);

      const hit = async (qText: string, extra: string[] = []) => {
        const r = await fetch(`${MEILI}/indexes/${INDEX}/search`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${MEILI_KEY}` },
          body: JSON.stringify({ q: qText, filter: [...base, ...extra], limit: 24 }),
        });
        return (await r.json()) as { hits: Array<{ id: string }>; estimatedTotalHits: number };
      };

      const generic = categoriesForQuery(q);
      if (!generic.length) {
        const body = await hit(q);
        return { engine: 'meilisearch', hits: body.hits, total: body.estimatedTotalHits };
      }

      /* المصطلح العام يفتح فئةً كاملة، لكن تفريغ نص الاستعلام يفقد
         ما يحمل الكلمة في اسمه ويقع خارج تلك الفئة — «شاحن شمسي»
         مصنَّف تحت الطاقة لا الشواحن، ومن يكتب «شاحن» يريده أيضاً.
         فيُجمع المساران: الفئة ثم الاسم، بلا تكرار. */
      const [byCat, byName] = await Promise.all([
        hit('', [`category IN [${generic.map((c) => `"${c}"`).join(', ')}]`]),
        hit(q),
      ]);
      const seen = new Set(byCat.hits.map((h) => h.id));
      const merged = [...byCat.hits, ...byName.hits.filter((h) => !seen.has(h.id))];
      return { engine: 'meilisearch', hits: merged.slice(0, 24), total: merged.length };
    }

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
    return { engine: 'postgres', hits: hits.slice(0, 24), total: hits.length };
  }
}

@Controller('search')
export class SearchController {
  constructor(
    @Inject(SearchService) private search: SearchService,
    @Inject(FxService) private fx: FxService,
  ) {}

  @Get()
  async query(
    @Query('q') q = '',
    @Query('origin') origin?: string,
    @Query('condition') condition?: string,
    @Query('maxUsd') maxUsd?: string,
  ) {
    const [res, fx] = await Promise.all([
      this.search.search(q, { origin, condition, maxUsd: maxUsd ? Number(maxUsd) : undefined }),
      this.fx.current(),
    ]);
    return { data: res.hits, meta: { engine: res.engine, total: res.total, fx, query: q, normalized: normalizeAr(q) } };
  }

  @Get('reindex')
  async reindex() { return { data: await this.search.reindex() }; }
}
