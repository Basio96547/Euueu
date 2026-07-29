/**
 * طبقة البيانات وقت البناء.
 * المصدر الأول هو الواجهة البرمجية إن كان PUBLIC_API_URL مضبوطاً ومتاحاً،
 * وإلا تُقرأ بذرة الكتالوج مباشرة — فيبقى فحص الواجهة ممكناً بلا بنية تحتية،
 * ولا يفشل البناء لأن الخادم متوقف.
 */
import seed from '../../../../seed/catalog.demo.json';

const API = import.meta.env.PUBLIC_API_URL ?? process.env.PUBLIC_API_URL ?? '';

export type Loc = { ar: string; en?: string };

export interface Variant {
  sku: string;
  storageGb: number | null;
  ramGb: number | null;
  colorCode: string | null;
  colorName: Loc | null;
  networkGen: string | null;
  dualSim: boolean;
  esimOnly: boolean;
  partCode: string | null;
  condition: 'NEW' | 'OPEN_BOX' | 'REFURBISHED' | 'USED_A' | 'USED_B';
  batteryHealthPct: number | null;
  deviceOrigin: 'GULF' | 'EURO' | 'US' | 'ASIA' | 'OTHER';
  warrantyType: 'STORE' | 'AGENT' | 'IMPORTER' | 'NONE';
  warrantyMonths: number;
  priceUsdCents: number;
  compareAtPriceUsdCents: number | null;
  stock: number;
}

export interface Product {
  slug: string;
  brand: string;
  brandName: Loc;
  category: string;
  name: Loc;
  shortDesc: Loc | null;
  spec: Record<string, string | number | null>;
  variants: Variant[];
  isDemo: boolean;
}

const brands = new Map<string, Loc>(seed.brands.map((b: any) => [b.slug, b.name]));

export const categories = seed.categories as Array<{
  slug: string; path: string; depth: number; name: Loc; sort_order: number;
}>;

function mapVariant(v: any): Variant {
  return {
    sku: v.sku, storageGb: v.storage_gb, ramGb: v.ram_gb,
    colorCode: v.color_code, colorName: v.color_name,
    networkGen: v.network_gen, dualSim: v.dual_sim, esimOnly: v.esim_only,
    partCode: v.part_code, condition: v.condition,
    batteryHealthPct: v.battery_health_pct, deviceOrigin: v.device_origin,
    warrantyType: v.warranty_type, warrantyMonths: v.warranty_months,
    priceUsdCents: v.price_usd_cents,
    compareAtPriceUsdCents: v.compare_at_price_usd_cents,
    stock: v.demo_stock ?? 0,
  };
}

const fromSeed = (): Product[] => (seed.products as any[]).map((p) => ({
  slug: p.slug, brand: p.brand, brandName: brands.get(p.brand) ?? { ar: p.brand },
  category: p.category, name: p.name, shortDesc: p.short_desc,
  spec: p.spec ?? {}, variants: p.variants.map(mapVariant), isDemo: p.is_demo,
}));

function fromApi(rows: any[]): Product[] {
  return rows.map((p) => ({
    slug: p.slug, brand: p.brand.slug, brandName: p.brand.name,
    category: p.categorySlug ?? 'smartphones',
    name: p.name, shortDesc: p.shortDesc, spec: p.spec ?? {},
    isDemo: p.isDemo,
    variants: p.variants.map((v: any): Variant => ({
      sku: v.sku, storageGb: v.storageGb, ramGb: v.ramGb,
      colorCode: null, colorName: v.colorName,
      networkGen: v.networkGen, dualSim: v.dualSim, esimOnly: v.esimOnly,
      partCode: v.partCode, condition: v.condition,
      batteryHealthPct: v.batteryHealthPct, deviceOrigin: v.deviceOrigin,
      warrantyType: v.warrantyType, warrantyMonths: v.warrantyMonths,
      priceUsdCents: v.priceUsdCents, compareAtPriceUsdCents: v.compareAtPriceUsdCents,
      stock: v.available ?? 0,
    })),
  }));
}

/** جلب وقت البناء: نجاحه يعني كتالوجاً حياً، وفشله يعني بذرة — لا انهيار */
async function load(): Promise<{ items: Product[]; source: 'api' | 'seed' }> {
  if (!API) return { items: fromSeed(), source: 'seed' };
  try {
    const r = await fetch(`${API}/catalog/products?limit=200`, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const body = (await r.json()) as { data: any[] };
    if (!body.data?.length) throw new Error('كتالوج فارغ');
    return { items: fromApi(body.data), source: 'api' };
  } catch (e) {
    console.warn(`[catalog] تعذّر جلب الكتالوج من الـAPI (${String(e)}) — البناء من البذرة.`);
    return { items: fromSeed(), source: 'seed' };
  }
}

const loaded = await load();
export const products: Product[] = loaded.items;
export const catalogSource = loaded.source;

export const getProduct = (slug: string) => products.find((p) => p.slug === slug);

/** أبناء الفئة عبر المسار المُجسَّد — مطابق لسلوك ltree في الفصل 3 */
export function productsInCategory(slug: string): Product[] {
  const cat = categories.find((c) => c.slug === slug);
  if (!cat) return [];
  const descendants = new Set(
    categories.filter((c) => c.path === cat.path || c.path.startsWith(cat.path + '.')).map((c) => c.slug),
  );
  return products.filter((p) => descendants.has(p.category));
}

export const compatibleAccessories = (phoneSlug: string): Product[] =>
  (seed.product_compatibility ?? [])
    .filter((c: any) => c.phone === phoneSlug)
    .map((c: any) => getProduct(c.accessory))
    .filter(Boolean) as Product[];

/** سعر الصرف الساري مع صلاحيته — التقادم ليس حالة مسموحة (الفصل 3) */
export function currentFx() {
  const fx = (seed.fx_rates as any[])[0];
  const from = new Date();
  const until = new Date(from.getTime() + (fx.valid_hours ?? 24) * 3_600_000);
  return { rate: fx.rate as number, validUntil: until.toISOString(), safetyMarginBp: fx.safety_margin_bp ?? 300 };
}

export const isDemoMode = () => (process.env.DEMO_MODE ?? 'true') === 'true';

/* ——— تسميات عربية للقيم المعدودة ——— */
export const CONDITION_AR: Record<Variant['condition'], string> = {
  NEW: 'جديد', OPEN_BOX: 'مفتوح العلبة', REFURBISHED: 'مجدَّد',
  USED_A: 'مستعمل ممتاز', USED_B: 'مستعمل جيد',
};
export const ORIGIN_AR: Record<Variant['deviceOrigin'], string> = {
  GULF: 'خليجي', EURO: 'أوروبي', US: 'أمريكي', ASIA: 'آسيوي', OTHER: 'أخرى',
};
export const WARRANTY_AR: Record<Variant['warrantyType'], string> = {
  STORE: 'كفالة محل', AGENT: 'كفالة وكيل', IMPORTER: 'كفالة مستورد', NONE: 'بلا كفالة',
};


/* ——— التقييمات والأسئلة ———
 *
 * تُجلب وقت البناء وتُدرَج في الصفحة الساكنة، فلا تُحمَّل عبر جافاسكربت
 * على شبكة بطيئة ولا تُخفى عن محركات البحث. غيابُ الواجهة البرمجية
 * لا يمنع البناء: صفحةٌ بلا مراجعات أفضل من بناء فاشل.
 */
export interface ReviewSummary {
  count: number;
  average: number;
  distribution: Record<string, number>;
  items: Array<{
    rating: number; title: string | null; body: string | null;
    author: string; createdAt: string;
    merchantReply: string | null; merchantReplyAt: string | null;
  }>;
}

export interface QuestionItem {
  body: string; answer: string | null; answerSource: string | null; answeredAt: string | null;
}

const EMPTY_REVIEWS: ReviewSummary = {
  count: 0, average: 0, distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }, items: [],
};

async function apiJson<T>(path: string, fallback: T): Promise<T> {
  if (!API) return fallback;
  try {
    const r = await fetch(`${API}${path}`, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) return fallback;
    return ((await r.json()).data as T) ?? fallback;
  } catch {
    return fallback;
  }
}

export const reviewsFor = (slug: string) =>
  apiJson<ReviewSummary>(`/catalog/products/${slug}/reviews`, EMPTY_REVIEWS);

export const questionsFor = (slug: string) =>
  apiJson<QuestionItem[]>(`/catalog/products/${slug}/questions`, []);
