/**
 * بذرة الكتالوج — تُخرِج SQL.
 *
 * كانت سكربتاً يتصل بالقاعدة ويكتب فيها. وD1 لا يُتصل به من Node: هو ربطٌ
 * داخل الـWorker لا خادمٌ بمنفذ. فصار البذر توليدَ SQL يُطبَّق بأداة
 * واحدة على القاعدة المحلية وعلى الإنتاج:
 *
 *   node prisma/seed-d1.mjs > /tmp/seed.sql
 *   npx wrangler d1 execute talisham --local  --file=/tmp/seed.sql
 *   npx wrangler d1 execute talisham --remote --file=/tmp/seed.sql
 *
 * وكل الجُمل `INSERT OR REPLACE` بمعرّفات مشتقّة من المفاتيح الطبيعية،
 * فتشغيلها مرتين لا يُنتج صفوفاً مكرّرة ولا يُغيّر معرّفاً موجوداً.
 */
import { readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';

const seedFile = new URL('../../../seed/catalog.demo.json', import.meta.url);
const seed = JSON.parse(readFileSync(seedFile, 'utf8'));

/* المعرّف من المفتاح الطبيعي: إعادة البذر تُصيب الصف نفسه لا صفاً جديداً،
   ويبقى الناتج ثابتاً بين البيئات فيسهل تتبّعه. */
const idOf = (kind, key) => {
  const h = createHash('sha256').update(`${kind}:${key}`).digest('hex');
  return [h.slice(0, 8), h.slice(8, 12), `4${h.slice(13, 16)}`, `a${h.slice(17, 20)}`, h.slice(20, 32)].join('-');
};

const q = (v) => {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'object') return `'${JSON.stringify(v).replace(/'/g, "''")}'`;
  return `'${String(v).replace(/'/g, "''")}'`;
};

const pid = () => {
  const B32 = 'ABCDEFGHJKMNPQRSTVWXYZ0123456789';
  return Array.from({ length: 12 }, () => B32[Math.floor(Math.random() * B32.length)]).join('');
};

const netGen = (g) =>
  g === '5G' ? 'G5' : g === '4G' ? 'G4' : g === '3G' ? 'G3' : g === '2G' ? 'G2' : null;

const out = [];
const now = new Date().toISOString();
/* أعمدة كل جدول تُقرأ من الترحيل نفسه: عمودٌ يختفي من المخطَّط يجب أن
   يُوقف البذر بخطأ صريح لا أن يمرّ صامتاً ثم يفشل في القاعدة. */
const migration = readFileSync(new URL('../migrations/0001_d1_init.sql', import.meta.url), 'utf8');
const TABLE_COLS = new Map();
for (const m of migration.matchAll(/CREATE TABLE "(\w+)" \(([\s\S]*?)\n\);/g)) {
  TABLE_COLS.set(m[1], new Set([...m[2].matchAll(/^\s+"(\w+)"/gm)].map((x) => x[1])));
}

const ins = (table, row) => {
  const known = TABLE_COLS.get(table);
  if (!known) throw new Error(`جدول غير معروف في الترحيل: ${table}`);
  for (const c of Object.keys(row)) {
    if (!known.has(c)) throw new Error(`عمود غير موجود: ${table}.${c}`);
  }
  const cols = Object.keys(row).map((c) => `"${c}"`).join(', ');
  const vals = Object.values(row).map(q).join(', ');
  out.push(`INSERT OR REPLACE INTO "${table}" (${cols}) VALUES (${vals});`);
};

/* ——— المستودع الافتراضي ——— */
const warehouseId = idOf('warehouse', 'DMS-MAIN');
ins('warehouses', {
  id: warehouseId, code: 'DMS-MAIN',
  name: { ar: 'مستودع دمشق', en: 'Damascus Main' },
  governorate: 'DAMASCUS',
});

/* ——— سعر الصرف: صلاحية إلزامية، والتقادم ليس حالة مسموحة ——— */
const fx = seed.fx_rates[0];
const validUntil = new Date(Date.now() + (fx.valid_hours ?? 24) * 3_600_000).toISOString();
ins('fx_rates', {
  id: randomUUID(), base: fx.base, quote: fx.quote, rate: fx.rate,
  effective_from: now, valid_until: validUntil,
  safety_margin_bp: fx.safety_margin_bp ?? 300, note: fx.note ?? null,
  created_at: now,
});

/* ——— العلامات ——— */
for (const b of seed.brands) {
  ins('brands', {
    id: idOf('brand', b.slug), slug: b.slug, name: b.name,
    country_of_origin: b.country_of_origin ?? null,
    is_featured: Boolean(b.is_featured), sort_order: b.sort_order ?? 0,
  });
}

/* ——— الفئات: الأب قبل الابن ——— */
const cats = [...seed.categories].sort((a, b) => a.depth - b.depth);
for (const c of cats) {
  const parentPath = c.path.includes('.') ? c.path.slice(0, c.path.lastIndexOf('.')) : null;
  const parent = parentPath ? cats.find((x) => x.path === parentPath) : null;
  ins('categories', {
    id: idOf('category', c.slug), slug: c.slug, name: c.name,
    path: c.path, depth: c.depth, sort_order: c.sort_order ?? 0,
    parent_id: parent ? idOf('category', parent.slug) : null,
  });
}

/* ——— المنتجات والمتغيّرات والمخزون ——— */
let variants = 0;
for (const p of seed.products) {
  const productId = idOf('product', p.slug);
  ins('products', {
    id: productId, public_id: pid(), slug: p.slug,
    brand_id: idOf('brand', p.brand), category_id: idOf('category', p.category),
    name: p.name, short_desc: p.short_desc ?? null, description: null,
    spec: p.spec ?? {}, status: p.status, is_demo: Boolean(p.is_demo),
    rating_count: 0, created_at: now, updated_at: now,
  });

  for (const [i, v] of p.variants.entries()) {
    const variantId = idOf('variant', v.sku);
    ins('product_variants', {
      id: variantId, public_id: pid(), product_id: productId, sku: v.sku,
      color_code: v.color_code ?? null, color_name: v.color_name ?? null,
      storage_gb: v.storage_gb ?? null, ram_gb: v.ram_gb ?? null,
      network_gen: netGen(v.network_gen), dual_sim: Boolean(v.dual_sim),
      esim_only: Boolean(v.esim_only), part_code: v.part_code ?? null,
      condition: v.condition, battery_health_pct: v.battery_health_pct ?? null,
      // هذان الحقلان بلا @map في المخطَّط، فاسم العمود كما كُتب
      deviceOrigin: v.device_origin,
      warrantyType: v.warranty_type, warranty_months: v.warranty_months,
      price_usd_cents: v.price_usd_cents,
      compare_at_price_usd_cents: v.compare_at_price_usd_cents ?? null,
      cost_price_usd_cents: v.cost_price_usd_cents ?? null,
      is_default: i === 0,
    });

    // demo_stock كمية عرضية: لا تمرّ بدفتر الحركات ولا تنشئ وحدات أجهزة
    ins('inventory_levels', {
      id: idOf('level', v.sku), variant_id: variantId, warehouse_id: warehouseId,
      on_hand: v.demo_stock ?? 0, reserved: 0, incoming: 0,
      reorder_point: 2, version: 0,
    });
    variants++;
  }
}

/* ——— التوافق: الملحق والجهاز ——— */
for (const c of seed.product_compatibility ?? []) {
  ins('product_compatibility', {
    id: idOf('compat', `${c.accessory}:${c.phone}`),
    accessory_product_id: idOf('product', c.accessory),
    phone_product_id: idOf('product', c.phone),
    note: c.note ?? null,
  });
}

/* ——— تعريفة الشحن ——— */
const rates = [
  ['DAMASCUS', 200, 1, 2], ['RIF_DIMASHQ', 250, 1, 2], ['ALEPPO', 400, 2, 4],
  ['HOMS', 350, 2, 3], ['HAMA', 350, 2, 3], ['LATAKIA', 400, 2, 4], ['TARTUS', 400, 2, 4],
];
for (const [gov, fee, min, max] of rates) {
  const method = gov === 'DAMASCUS' || gov === 'RIF_DIMASHQ' ? 'COURIER_INTRACITY' : 'INTERCITY_OFFICE';
  ins('shipping_rates', {
    id: idOf('rate', `${gov}:${method}`), governorate: gov, method,
    base_fee_usd_cents: fee, per_kg_fee_usd_cents: 0,
    eta_min_days: min, eta_max_days: max,
  });
}

/* ——— إعدادات المتجر (الفصل 18) ——— */
const settings = [
  ['cod_max_order_usd_cents', 150000],
  ['open_orders_per_phone_max', 2],
  ['cash_rounding_step_syp', 1000],
  ['confirmation_window_hours', 48],
  ['order_hold_hours', 2],
  ['order_hold_ext_hours', 48],
  ['rare_stock_threshold', 2],
  ['rare_hold_ext_hours', 12],
  ['free_shipping_above_usd_cents', 50000],
  ['served_governorates', ['DAMASCUS', 'RIF_DIMASHQ', 'ALEPPO', 'HOMS', 'HAMA', 'LATAKIA', 'TARTUS']],
  ['store_paused', false],
  ['demo_mode', true],
];
for (const [key, value] of settings) {
  ins('store_settings', { key, value, updated_at: now });
}

/* ——— حساب إداري أوّلي ———
   بدونه لا يستطيع أحد دخول لوحة التحكم: رمز الدخول يُنشئ زبوناً فقط. */
/* رقم صاحب المتجر. كان رقماً وهمياً (‎+963900000001‎) — أي أن أحداً لا
   يستطيع الدخول إلى اللوحة إلا بتغييره أولاً، وهو أوّل ما يُنسى. */
const adminPhone = process.env.ADMIN_PHONE ?? '+963958436703';
if (/^\+9639[0-9]{8}$/.test(adminPhone)) {
  ins('users', {
    id: idOf('user', adminPhone), public_id: pid(), phone_e164: adminPhone,
    role: 'ADMIN', full_name: 'مدير المتجر', locale: 'ar', display_currency: 'SYP',
    token_version: 0, failed_logins: 0, notify_prefs: {},
    created_at: now, updated_at: now,
  });
}

console.log(out.join('\n'));
console.error(`بذرة: ${seed.products.length} منتجاً · ${variants} متغيّراً · ${rates.length} تعريفة شحن · ${out.length} جملة`);
