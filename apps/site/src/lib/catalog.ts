/**
 * طبقة البيانات وقت البناء.
 * تقرأ بذرة الكتالوج مباشرة، فيعمل الموقع بلا قاعدة بيانات ولا واجهة برمجية —
 * وهو ما يجعل فحص الواجهة ممكناً قبل تشغيل أي بنية تحتية.
 * عند توفر الـ API تُستبدل الدوال الثلاث أدناه بنداءات إليه دون تغيير الصفحات.
 */
import seed from '../../../../seed/catalog.demo.json';

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

export const products: Product[] = (seed.products as any[]).map((p) => ({
  slug: p.slug, brand: p.brand, brandName: brands.get(p.brand) ?? { ar: p.brand },
  category: p.category, name: p.name, shortDesc: p.short_desc,
  spec: p.spec ?? {}, variants: p.variants.map(mapVariant), isDemo: p.is_demo,
}));

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
