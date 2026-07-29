/**
 * بذر الكتالوج التجريبي من seed/catalog.demo.json
 * جامد (idempotent): إعادة التشغيل تحدّث ولا تكرّر، بمطابقة slug و sku.
 * ممنوع في الإنتاج إلا بـ --allow-prod.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();
const here = dirname(fileURLToPath(import.meta.url));
const seedFile = resolve(here, '../../../seed/catalog.demo.json');

type Loc = { ar: string; en?: string };
type SeedVariant = {
  sku: string; storage_gb: number | null; ram_gb: number | null;
  color_code: string | null; color_name: Loc | null;
  network_gen: string | null; sim_type: string | null;
  dual_sim: boolean; esim_only: boolean; part_code: string | null;
  condition: string; battery_health_pct: number | null;
  device_origin: string; warranty_type: string; warranty_months: number;
  price_usd_cents: number; compare_at_price_usd_cents: number | null;
  cost_price_usd_cents: number | null; demo_stock: number;
};
type SeedProduct = {
  slug: string; brand: string; category: string; status: string; is_demo: boolean;
  name: Loc; short_desc: Loc | null; spec: Record<string, unknown>; variants: SeedVariant[];
};

const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** معرّف عام غير زمني — UUIDv7 يسرّب وقت الإنشاء فلا يخرج في رابط (الفصل 3) */
function publicId(): string {
  let out = '';
  for (let i = 0; i < 12; i++) out += B32[Math.floor(Math.random() * B32.length)];
  return out;
}

const netGen = (g: string | null) =>
  g === '5G' ? 'G5' : g === '4G' ? 'G4' : g === '3G' ? 'G3' : g === '2G' ? 'G2' : null;

async function main() {
  if (process.env.NODE_ENV === 'production' && !process.argv.includes('--allow-prod')) {
    throw new Error('البذر ممنوع في الإنتاج. مرّر --allow-prod إن كنت متأكداً.');
  }

  const seed = JSON.parse(readFileSync(seedFile, 'utf8'));
  console.log(`قراءة البذرة: ${seed.products.length} منتجاً`);

  // ——— المستودع الافتراضي ———
  const warehouse = await prisma.warehouse.upsert({
    where: { code: 'DMS-MAIN' },
    update: {},
    create: { code: 'DMS-MAIN', name: { ar: 'مستودع دمشق', en: 'Damascus Main' }, governorate: 'DAMASCUS' },
  });

  // ——— سعر الصرف: صلاحية إلزامية ———
  const fx = seed.fx_rates[0];
  const now = new Date();
  const validUntil = new Date(now.getTime() + (fx.valid_hours ?? 24) * 3_600_000);
  await prisma.fxRate.upsert({
    where: { quote_effectiveFrom: { quote: 'SYP', effectiveFrom: now } },
    update: {},
    create: {
      base: fx.base, quote: fx.quote, rate: new Prisma.Decimal(fx.rate),
      effectiveFrom: now, validUntil, safetyMarginBp: fx.safety_margin_bp ?? 300, note: fx.note,
    },
  });
  console.log(`سعر الصرف: ${fx.rate} — صالح حتى ${validUntil.toISOString()}`);

  // ——— العلامات ———
  for (const b of seed.brands) {
    await prisma.brand.upsert({
      where: { slug: b.slug },
      update: { name: b.name, isFeatured: b.is_featured, sortOrder: b.sort_order },
      create: {
        slug: b.slug, name: b.name, countryOfOrigin: b.country_of_origin,
        isFeatured: b.is_featured, sortOrder: b.sort_order,
      },
    });
  }

  // ——— الفئات (بترتيب العمق حتى يوجد الأب قبل الابن) ———
  const cats = [...seed.categories].sort((a: any, b: any) => a.depth - b.depth);
  for (const c of cats) {
    const parentPath = c.path.includes('.') ? c.path.slice(0, c.path.lastIndexOf('.')) : null;
    const parent = parentPath
      ? await prisma.category.findFirst({ where: { path: parentPath } })
      : null;
    await prisma.category.upsert({
      where: { slug: c.slug },
      update: { name: c.name, path: c.path, depth: c.depth, sortOrder: c.sort_order, parentId: parent?.id ?? null },
      create: {
        slug: c.slug, name: c.name, path: c.path, depth: c.depth,
        sortOrder: c.sort_order, parentId: parent?.id ?? null,
      },
    });
  }

  // ——— المنتجات والمتغيرات والمخزون ———
  let variantCount = 0;
  for (const p of seed.products as SeedProduct[]) {
    const brand = await prisma.brand.findUniqueOrThrow({ where: { slug: p.brand } });
    const category = await prisma.category.findUniqueOrThrow({ where: { slug: p.category } });

    const product = await prisma.product.upsert({
      where: { slug: p.slug },
      update: {
        name: p.name, shortDesc: p.short_desc ?? undefined, spec: p.spec as any,
        status: p.status as any, isDemo: p.is_demo, brandId: brand.id, categoryId: category.id,
      },
      create: {
        publicId: publicId(), slug: p.slug, brandId: brand.id, categoryId: category.id,
        name: p.name, shortDesc: p.short_desc ?? undefined, spec: p.spec as any,
        status: p.status as any, isDemo: p.is_demo,
      },
    });

    for (const [i, v] of p.variants.entries()) {
      const variant = await prisma.productVariant.upsert({
        where: { sku: v.sku },
        update: {
          priceUsdCents: BigInt(v.price_usd_cents),
          compareAtPriceUsdCents: v.compare_at_price_usd_cents != null ? BigInt(v.compare_at_price_usd_cents) : null,
          costPriceUsdCents: v.cost_price_usd_cents != null ? BigInt(v.cost_price_usd_cents) : null,
        },
        create: {
          publicId: publicId(), productId: product.id, sku: v.sku,
          colorCode: v.color_code, colorName: v.color_name ?? undefined,
          storageGb: v.storage_gb, ramGb: v.ram_gb,
          networkGen: netGen(v.network_gen) as any,
          dualSim: v.dual_sim, esimOnly: v.esim_only, partCode: v.part_code,
          condition: v.condition as any, batteryHealthPct: v.battery_health_pct,
          deviceOrigin: v.device_origin as any,
          warrantyType: v.warranty_type as any, warrantyMonths: v.warranty_months,
          priceUsdCents: BigInt(v.price_usd_cents),
          compareAtPriceUsdCents: v.compare_at_price_usd_cents != null ? BigInt(v.compare_at_price_usd_cents) : null,
          costPriceUsdCents: v.cost_price_usd_cents != null ? BigInt(v.cost_price_usd_cents) : null,
          isDefault: i === 0,
        },
      });

      // demo_stock كمية عرضية: لا تمر بدفتر الحركات ولا تنشئ وحدات أجهزة
      await prisma.inventoryLevel.upsert({
        where: { variantId_warehouseId: { variantId: variant.id, warehouseId: warehouse.id } },
        update: { onHand: v.demo_stock },
        create: { variantId: variant.id, warehouseId: warehouse.id, onHand: v.demo_stock, reorderPoint: 2 },
      });
      variantCount++;
    }
  }

  // ——— التوافق ———
  for (const c of seed.product_compatibility ?? []) {
    const acc = await prisma.product.findUnique({ where: { slug: c.accessory } });
    const phone = await prisma.product.findUnique({ where: { slug: c.phone } });
    if (!acc || !phone) continue;
    await prisma.productCompatibility.upsert({
      where: { accessoryProductId_phoneProductId: { accessoryProductId: acc.id, phoneProductId: phone.id } },
      update: { note: c.note },
      create: { accessoryProductId: acc.id, phoneProductId: phone.id, note: c.note },
    });
  }

  // ——— تعريفة الشحن ———
  const rates: Array<[string, number, number, number]> = [
    ['DAMASCUS', 200, 1, 2], ['RIF_DIMASHQ', 250, 1, 2], ['ALEPPO', 400, 2, 4],
    ['HOMS', 350, 2, 3], ['HAMA', 350, 2, 3], ['LATAKIA', 400, 2, 4], ['TARTUS', 400, 2, 4],
  ];
  for (const [gov, fee, min, max] of rates) {
    const method = gov === 'DAMASCUS' || gov === 'RIF_DIMASHQ' ? 'COURIER_INTRACITY' : 'INTERCITY_OFFICE';
    await prisma.shippingRate.upsert({
      where: { governorate_method: { governorate: gov as any, method: method as any } },
      update: { baseFeeUsdCents: BigInt(fee), etaMinDays: min, etaMaxDays: max },
      create: {
        governorate: gov as any, method: method as any,
        baseFeeUsdCents: BigInt(fee), etaMinDays: min, etaMaxDays: max,
      },
    });
  }

  // ——— إعدادات المتجر (الفصل 18) ———
  const settings: Array<[string, unknown]> = [
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
    await prisma.storeSetting.upsert({ where: { key }, update: { value: value as any }, create: { key, value: value as any } });
  }

  // ——— حساب إداري أولي ———
  // بدونه لا يستطيع أحد دخول لوحة التحكم: رمز OTP يُنشئ زبوناً فقط.
  // يُضبط الرقم بـ ADMIN_PHONE؛ وللترقية لاحقاً استخدم prisma/grant-role.ts
  const adminPhone = process.env.ADMIN_PHONE ?? '+963900000001';
  if (/^\+9639[0-9]{8}$/.test(adminPhone)) {
    const admin = await prisma.user.upsert({
      where: { phoneE164: adminPhone },
      update: { role: 'ADMIN' },
      create: {
        publicId: publicId(), phoneE164: adminPhone,
        role: 'ADMIN', fullName: 'مدير المتجر',
      },
    });
    console.log(`حساب الإدارة: ${admin.phoneE164} — ادخل به إلى لوحة التحكم برمز OTP.`);
  } else {
    console.warn(`ADMIN_PHONE غير صالح (${adminPhone}) — لم يُنشأ حساب إداري.`);
  }

  console.log(`تم: ${seed.products.length} منتجاً · ${variantCount} متغيّراً · ${rates.length} تعريفة شحن`);
  console.log('تنبيه: كل المنتجات is_demo=true — لن تظهر في الإنتاج قبل تحويلها من لوحة التحكم.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
