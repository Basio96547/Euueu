import { PrismaService } from '../common/prisma.service.js';
import { randomUUID } from 'node:crypto';
import { Errors } from '../common/errors.js';
import { runBatch } from '../common/batch.js';
import { publicId } from '../common/money.js';
import { deleteImage, putImage, type R2Binding } from './storage.js';


/** المتغيّر لا يُنشأ ناقصاً: هذه الحقول تصف الجهاز لمن يشتريه بلا أن يراه */
interface VariantInput {
  sku: string;
  priceUsdCents: number;
  compareAtPriceUsdCents?: number | null;
  costPriceUsdCents?: number | null;
  storageGb?: number | null;
  ramGb?: number | null;
  colorCode?: string | null;
  colorName?: { ar: string; en?: string } | null;
  networkGen?: string | null;
  simType?: string | null;
  dualSim?: boolean;
  esimOnly?: boolean;
  partCode?: string | null;
  condition?: string;
  batteryHealthPct?: number | null;
  deviceOrigin?: string;
  warrantyType?: string;
  warrantyMonths?: number;
  isDefault?: boolean;
}

interface ProductInput {
  slug: string;
  brandSlug: string;
  categorySlug: string;
  name: { ar: string; en?: string };
  shortDesc?: { ar: string; en?: string } | null;
  description?: { ar: string; en?: string } | null;
  spec?: Record<string, unknown>;
  status?: string;
  variants: VariantInput[];
}

/**
 * إدارة الكتالوج — الفصل 7
 *
 * المتجر بلا هذه الشاشة ليس متجراً: صاحبه لا يستطيع إدخال بضاعته
 * إلا بأن يفتح قاعدة البيانات بيده، وهو ما لن يفعله ولا يجب أن يُطلب منه.
 */
export class ProductsAdminService {
  constructor(private prisma: PrismaService, private media?: R2Binding) {}

  private slugOk(s: string) {
    return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s) && s.length >= 3 && s.length <= 80;
  }

  async brands() {
    const rows = await this.prisma.brand.findMany({ orderBy: { sortOrder: 'asc' } });
    return rows.map((b) => ({ slug: b.slug, name: b.name }));
  }

  async categories() {
    const rows = await this.prisma.category.findMany({ orderBy: [{ depth: 'asc' }, { sortOrder: 'asc' }] });
    return rows.map((c) => ({ slug: c.slug, name: c.name, path: c.path, depth: c.depth }));
  }

  async one(slug: string) {
    const p = await this.prisma.product.findFirst({
      where: { slug, deletedAt: null },
      include: {
        brand: true, category: true,
        variants: { include: { levels: true }, orderBy: { sku: 'asc' } },
        media: { orderBy: { sortOrder: 'asc' } },
      },
    });
    if (!p) throw Errors.notFound('المنتج');
    return {
      slug: p.slug, name: p.name, shortDesc: p.shortDesc, description: p.description,
      spec: p.spec ?? {}, status: p.status, isDemo: p.isDemo,
      brandSlug: p.brand.slug, categorySlug: p.category.slug,
      ratingAvg: p.ratingAvg ? Number(p.ratingAvg) : null, ratingCount: p.ratingCount,
      media: p.media.map((m) => ({ id: m.id, url: m.url, alt: m.alt, sortOrder: m.sortOrder })),
      variants: p.variants.map((v) => ({
        sku: v.sku,
        priceUsdCents: Number(v.priceUsdCents),
        compareAtPriceUsdCents: v.compareAtPriceUsdCents ? Number(v.compareAtPriceUsdCents) : null,
        costPriceUsdCents: v.costPriceUsdCents ? Number(v.costPriceUsdCents) : null,
        storageGb: v.storageGb, ramGb: v.ramGb,
        colorCode: v.colorCode, colorName: v.colorName,
        networkGen: v.networkGen, dualSim: v.dualSim, esimOnly: v.esimOnly,
        partCode: v.partCode, condition: v.condition,
        batteryHealthPct: v.batteryHealthPct,
        deviceOrigin: v.deviceOrigin, warrantyType: v.warrantyType, warrantyMonths: v.warrantyMonths,
        isDefault: v.isDefault,
        onHand: v.levels.reduce((a, l) => a + l.onHand, 0),
        reserved: v.levels.reduce((a, l) => a + l.reserved, 0),
      })),
    };
  }

  /**
   * إنشاء أو تعديل منتج بمتغيّراته.
   *
   * السعر يُقبل بالسنتات وحدها. لو قُبل بالليرة لاحتاج كل تغيير في سعر
   * الصرف مرورَ إنسان على آلاف الأسعار — وهو ما لن يقع، فتتقادم الأسعار
   * صامتةً ويبيع المتجر بخسارة لا يراها.
   */
  async upsert(input: ProductInput, actorPublicId: string) {
    if (!this.slugOk(input.slug)) {
      throw Errors.badRequest('SLUG_INVALID',
        'المُعرِّف: حروف لاتينية صغيرة وأرقام وشرطات، من ثلاثة إلى ثمانين حرفاً',
        'Invalid slug');
    }
    if (!input.name?.ar?.trim()) {
      throw Errors.badRequest('NAME_REQUIRED', 'الاسم العربي إلزامي', 'Arabic name required');
    }
    if (!input.variants?.length) {
      throw Errors.badRequest('VARIANTS_REQUIRED',
        'كل منتج يحتاج متغيّراً واحداً على الأقل (اللون/السعة/السعر)',
        'At least one variant required');
    }

    const [brand, category] = await Promise.all([
      this.prisma.brand.findUnique({ where: { slug: input.brandSlug } }),
      this.prisma.category.findUnique({ where: { slug: input.categorySlug } }),
    ]);
    if (!brand) throw Errors.notFound(`العلامة ${input.brandSlug}`);
    if (!category) throw Errors.notFound(`الفئة ${input.categorySlug}`);

    for (const v of input.variants) {
      if (!/^[A-Z0-9-]{3,40}$/.test(v.sku)) {
        throw Errors.badRequest('SKU_INVALID',
          `رمز التخزين ${v.sku}: حروف لاتينية كبيرة وأرقام وشرطات`, 'Invalid SKU');
      }
      if (!Number.isInteger(v.priceUsdCents) || v.priceUsdCents <= 0) {
        throw Errors.badRequest('PRICE_INVALID',
          `سعر ${v.sku} يجب أن يكون عدداً موجباً بالسنتات`, 'Invalid price');
      }
      // شطب سعر أقل من السعر الحالي خداعٌ لا عرض
      if (v.compareAtPriceUsdCents && v.compareAtPriceUsdCents <= v.priceUsdCents) {
        throw Errors.badRequest('COMPARE_PRICE_INVALID',
          `السعر المشطوب لـ${v.sku} يجب أن يفوق السعر الحالي`, 'Compare-at must exceed price');
      }
      // رمز تخزين مأخوذ لمنتج آخر يخلط بضاعتين في مستودع واحد
      const taken = await this.prisma.productVariant.findUnique({
        where: { sku: v.sku }, include: { product: true },
      });
      if (taken && taken.product.slug !== input.slug) {
        throw Errors.badRequest('SKU_TAKEN',
          `رمز التخزين ${v.sku} مستعمل في ${taken.product.slug}`, 'SKU already used');
      }
    }

    const existing = await this.prisma.product.findFirst({ where: { slug: input.slug } });
    const actor = await this.prisma.user.findUnique({ where: { publicId: actorPublicId } });

    /* المعرّفات تُولَّد هنا لا في القاعدة: الدفعة تحتاجها قبل التنفيذ،
       والمتغيّرات تُربط بالمنتج بمعرّفه لا بما يعيده إنشاؤه. */
    const productId = existing?.id ?? randomUUID();
    const data = {
      brandId: brand.id, categoryId: category.id,
      name: input.name as any,
      shortDesc: (input.shortDesc ?? null) as any,
      description: (input.description ?? null) as any,
      spec: (input.spec ?? {}) as any,
      status: (input.status ?? 'DRAFT') as any,
      deletedAt: null,
    };

    const warehouse = await this.prisma.warehouse.findFirst();
    const existingVariants = new Map(
      (await this.prisma.productVariant.findMany({
        where: { sku: { in: input.variants.map((v) => v.sku) } },
        include: { levels: true },
      })).map((v) => [v.sku, v]),
    );

    const writes: any[] = [
      existing
        ? this.prisma.product.update({ where: { id: productId }, data })
        : this.prisma.product.create({
            data: { ...data, id: productId, publicId: publicId(), slug: input.slug, isDemo: false },
          }),
    ];

    for (const [i, v] of input.variants.entries()) {
      const vd = {
        productId,
        priceUsdCents: BigInt(v.priceUsdCents),
        compareAtPriceUsdCents: v.compareAtPriceUsdCents ? BigInt(v.compareAtPriceUsdCents) : null,
        costPriceUsdCents: v.costPriceUsdCents ? BigInt(v.costPriceUsdCents) : null,
        storageGb: v.storageGb ?? null,
        ramGb: v.ramGb ?? null,
        colorCode: v.colorCode ?? null,
        colorName: (v.colorName ?? null) as any,
        networkGen: (v.networkGen ?? null) as any,
        dualSim: v.dualSim ?? false,
        esimOnly: v.esimOnly ?? false,
        partCode: v.partCode ?? null,
        condition: (v.condition ?? 'NEW') as any,
        batteryHealthPct: v.batteryHealthPct ?? null,
        deviceOrigin: (v.deviceOrigin ?? 'GULF') as any,
        warrantyType: (v.warrantyType ?? 'STORE') as any,
        warrantyMonths: v.warrantyMonths ?? 12,
        isDefault: v.isDefault ?? i === 0,
      };
      const prior = existingVariants.get(v.sku);
      const variantId = prior?.id ?? randomUUID();

      writes.push(this.prisma.productVariant.upsert({
        where: { sku: v.sku },
        update: vd,
        create: { ...vd, id: variantId, publicId: publicId(), sku: v.sku },
      }));

      /* صف مخزون بكمية صفر لكل متغيّر جديد.
         غيابه يجعل المتغيّر غير قابل للاستلام ولا للحجز، فيظهر
         في الكتالوج ولا يُباع أبداً — وهو أسوأ من ألا يظهر. */
      if (warehouse && !prior?.levels.some((l) => l.warehouseId === warehouse.id)) {
        writes.push(this.prisma.inventoryLevel.create({
          data: { variantId, warehouseId: warehouse.id, onHand: 0, reorderPoint: 2 },
        }));
      }
    }

    writes.push(this.prisma.auditLog.create({
      data: {
        actorId: actor?.id,
        action: existing ? 'catalog.product.update' : 'catalog.product.create',
        entityType: 'products', entityId: productId,
        diff: { slug: input.slug, variants: input.variants.map((v) => v.sku) },
      },
    }));

    await runBatch(this.prisma, writes);
    const product = { id: productId, slug: input.slug, status: data.status };

    return { slug: product.slug, status: product.status, created: !existing };
  }

  /** النشر والسحب: تغيير حالة لا حذف — المنتج المسحوب يبقى في الطلبات القديمة */
  async setStatus(slug: string, status: string, actorPublicId: string) {
    const ok = ['DRAFT', 'IN_REVIEW', 'PUBLISHED', 'ARCHIVED'];
    if (!ok.includes(status)) {
      throw Errors.badRequest('STATUS_INVALID', `الحالة من: ${ok.join('، ')}`, 'Invalid status');
    }
    const p = await this.prisma.product.findFirst({ where: { slug, deletedAt: null } });
    if (!p) throw Errors.notFound('المنتج');

    if (status === 'PUBLISHED' && p.isDemo) {
      throw Errors.badRequest('DEMO_NOT_PUBLISHABLE',
        'حوّل المنتج إلى حقيقي قبل نشره', 'Convert demo product first');
    }

    const actor = await this.prisma.user.findUnique({ where: { publicId: actorPublicId } });
    await this.prisma.product.update({ where: { id: p.id }, data: { status: status as any } });
    await this.prisma.auditLog.create({
      data: {
        actorId: actor?.id, action: 'catalog.product.status',
        entityType: 'products', entityId: p.id, diff: { slug, from: p.status, to: status },
      },
    });
    return { slug, status };
  }

  /**
   * الحذف الناعم: المنتج يختفي من المتجر ويبقى في الطلبات.
   * الحذف الصلب يكسر تاريخ البيع كله — من اشترى جهازاً قبل سنة
   * يفتح طلبه فيجد سطراً بلا اسم.
   */
  async softDelete(slug: string, actorPublicId: string) {
    const p = await this.prisma.product.findFirst({
      where: { slug, deletedAt: null }, include: { variants: { include: { levels: true } } },
    });
    if (!p) throw Errors.notFound('المنتج');

    const onHand = p.variants.flatMap((v) => v.levels).reduce((a, l) => a + l.onHand, 0);
    if (onHand > 0 && !p.isDemo) {
      throw Errors.badRequest('PRODUCT_HAS_STOCK',
        `على المنتج ${onHand} قطعة في المستودع — اسحبه بـARCHIVED بدل حذفه`,
        'Product still has stock');
    }

    const actor = await this.prisma.user.findUnique({ where: { publicId: actorPublicId } });
    await this.prisma.product.update({
      where: { id: p.id }, data: { deletedAt: new Date(), status: 'ARCHIVED' },
    });
    await this.prisma.auditLog.create({
      data: {
        actorId: actor?.id, action: 'catalog.product.delete',
        entityType: 'products', entityId: p.id, diff: { slug },
      },
    });
    return { slug, deleted: true };
  }

  /** تعديل سعر متغيّر وحده — أكثر عملية تتكرر يومياً */
  async setPrice(sku: string, priceUsdCents: number, actorPublicId: string) {
    if (!Number.isInteger(priceUsdCents) || priceUsdCents <= 0) {
      throw Errors.badRequest('PRICE_INVALID', 'السعر عدد موجب بالسنتات', 'Invalid price');
    }
    const v = await this.prisma.productVariant.findUnique({ where: { sku } });
    if (!v) throw Errors.notFound('المتغيّر');
    const actor = await this.prisma.user.findUnique({ where: { publicId: actorPublicId } });

    await this.prisma.productVariant.update({
      where: { id: v.id }, data: { priceUsdCents: BigInt(priceUsdCents) },
    });
    await this.prisma.auditLog.create({
      data: {
        actorId: actor?.id, action: 'catalog.variant.price',
        entityType: 'product_variants', entityId: v.id,
        diff: { sku, from: Number(v.priceUsdCents), to: priceUsdCents },
      },
    });
    return { sku, priceUsdCents };
  }

  /* ————— الوسائط ————— */

  /**
   * إضافة صورة: إمّا رفعٌ مباشر (data URL) أو رابط خارجي.
   * الرفع هو الحالة الغالبة — صاحب المتجر يصوّر الجهاز بجواله.
   */
  async addMedia(slug: string, b: { url?: string; dataUrl?: string; alt?: { ar: string }; colorCode?: string }) {
    const p = await this.prisma.product.findFirst({ where: { slug, deletedAt: null } });
    if (!p) throw Errors.notFound('المنتج');

    let url = b.url ?? '';
    if (b.dataUrl) {
      const stored = await putImage(this.media, b.dataUrl, `products/${p.slug}`);
      url = stored.url;
    }
    if (!/^(https?:\/\/|\/)/.test(url)) {
      throw Errors.badRequest('URL_INVALID',
        'أرفق صورة أو ضع رابطاً يبدأ بـ http أو /', 'Provide an upload or a valid URL');
    }
    b = { ...b, url };
    const count = await this.prisma.media.count({ where: { ownerType: 'product', ownerId: p.id } });
    const m = await this.prisma.media.create({
      data: {
        ownerType: 'product', ownerId: p.id, url: url,
        alt: (b.alt ?? { ar: (p.name as any).ar }) as any,
        colorCode: b.colorCode ?? null, sortOrder: count,
      },
    });
    return { id: m.id, url: m.url, sortOrder: m.sortOrder };
  }

  async removeMedia(id: string) {
    const m = await this.prisma.media.findUnique({ where: { id } });
    if (!m) throw Errors.notFound('الصورة');
    await this.prisma.media.delete({ where: { id } });
    // الصف يُحذف أولاً: ملفٌ بلا صف مساحةٌ ضائعة، وصفٌّ بلا ملف صورةٌ مكسورة
    await deleteImage(this.media, m.url);
    return { deleted: true };
  }

  async reorderMedia(slug: string, ids: string[]) {
    const p = await this.prisma.product.findFirst({ where: { slug, deletedAt: null } });
    if (!p) throw Errors.notFound('المنتج');
    await this.prisma.$transaction(
      ids.map((id, i) =>
        this.prisma.media.updateMany({
          where: { id, ownerType: 'product', ownerId: p.id }, data: { sortOrder: i },
        })),
    );
    return { reordered: ids.length };
  }
}

