import { PrismaService } from '../common/prisma.service.js';
import { FxService } from './fx.module.js';
import { Errors } from '../common/errors.js';

export class CatalogService {
  constructor(
    private prisma: PrismaService,
  ) {}

  /**
   * هل تُعرض البضاعة التجريبية؟
   *
   * كان الجواب متغيّر بيئة `DEMO_MODE` غير معرَّف في أي مكان، فيسقط دائماً
   * إلى `true`: متجرٌ يعرض بضاعته الحقيقية مختلطةً بالتجريبية إلى الأبد،
   * وينتظر أن يتذكّر أحدٌ إطفاء مفتاح لا يعرف بوجوده.
   *
   * والسؤال الصحيح ليس عن مفتاح بل عن الرفّ: ما دام خالياً من الحقيقي
   * تُعرض التجريبية ليكون في المتجر ما يُرى؛ وبمجرّد نشر أول منتجٍ حقيقي
   * تختفي التجريبية وحدها. لا خطوة يدوية، ولا لحظة يظهر فيها الاثنان معاً.
   *
   * ويبقى `DEMO_MODE=true` تجاوزاً صريحاً لمن أراد إبقاءها للعرض.
   */
  private async showDemo(): Promise<boolean> {
    if (process.env.DEMO_MODE === 'true') return true;
    const real = await this.prisma.product.findFirst({
      where: { isDemo: false, status: 'PUBLISHED', deletedAt: null },
      select: { id: true },
    });
    return !real;
  }

  private async where() {
    return {
      status: 'PUBLISHED' as const,
      deletedAt: null,
      ...((await this.showDemo()) ? {} : { isDemo: false }),
    };
  }

  /**
   * قائمة المنتجات، بصفحاتٍ لا بسقفٍ صامت.
   *
   * كان السقف `min(limit, 100)` بلا مؤشّرٍ للصفحة التالية وبلا إشارةٍ إلى
   * أن ثمّة بقيّة. والموقع يطلب 200 فيأخذ 100 ويبني نفسه عليها: كل منتجٍ
   * بعد المئة بلا صفحة ولا سطرٍ في خريطة الموقع ولا نتيجةِ بحث. ولا خطأ
   * في أي سجل — العطل يظهر يوم يتجاوز المتجر مئة صنف، ولا شيء يربطه
   * بسببه.
   *
   * `cursor` معرّف آخر صفٍّ في الصفحة السابقة، و`nextCursor` في الردّ
   * يقول «ثمّة بقيّة» — وغيابه يقول «انتهت». فمن يقرأ لا يخمّن.
   */
  async list(categorySlug?: string, limit = 24, cursor?: string) {
    let categoryIds: string[] | undefined;
    if (categorySlug) {
      const cat = await this.prisma.category.findUnique({ where: { slug: categorySlug } });
      if (!cat) throw Errors.notFound('الفئة');
      const subtree = await this.prisma.category.findMany({
        where: { OR: [{ path: cat.path }, { path: { startsWith: cat.path + '.' } }] },
        select: { id: true },
      });
      categoryIds = subtree.map((c) => c.id);
    }
    const take = Math.min(Math.max(1, limit), 100);
    /* يُطلب صفٌّ زائد لا عدٌّ كامل: وجودُه وحده يقول إن ثمّة بقيّة */
    const rows = await this.prisma.product.findMany({
      where: { ...(await this.where()), ...(categoryIds ? { categoryId: { in: categoryIds } } : {}) },
      orderBy: { id: 'asc' },
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: {
        brand: true,
        variants: { where: { deletedAt: null }, include: { levels: true }, orderBy: { isDefault: 'desc' } },
      },
    });
    const page = rows.slice(0, take);
    return { rows: page, nextCursor: rows.length > take ? page[page.length - 1]!.id : null };
  }

  async bySlug(slug: string) {
    const p = await this.prisma.product.findFirst({
      where: { slug, ...(await this.where()) },
      include: {
        brand: true,
        variants: { where: { deletedAt: null }, include: { levels: true }, orderBy: { isDefault: 'desc' } },
      },
    });
    if (!p) throw Errors.notFound('المنتج');
    return p;
  }
}

const shape = (p: any) => ({
  publicId: p.publicId, slug: p.slug, name: p.name, shortDesc: p.shortDesc,
  brand: { slug: p.brand.slug, name: p.brand.name }, spec: p.spec, isDemo: p.isDemo,
  variants: p.variants.map((v: any) => ({
    /* `colorCode` يخرج مع الاسم: الموقع يرسم به جسمَ الجهاز بلونه
       الحقيقي، وبلاه يُصيَّر كلُّ جهازٍ في المتجر رماديّاً واحداً. */
    publicId: v.publicId, sku: v.sku, colorName: v.colorName, colorCode: v.colorCode,
    storageGb: v.storageGb, ramGb: v.ramGb, networkGen: v.networkGen,
    dualSim: v.dualSim, esimOnly: v.esimOnly, partCode: v.partCode,
    condition: v.condition, batteryHealthPct: v.batteryHealthPct,
    deviceOrigin: v.deviceOrigin, warrantyType: v.warrantyType, warrantyMonths: v.warrantyMonths,
    priceUsdCents: Number(v.priceUsdCents),
    compareAtPriceUsdCents: v.compareAtPriceUsdCents == null ? null : Number(v.compareAtPriceUsdCents),
    available: v.levels.reduce((a: number, l: any) => a + (l.onHand - l.reserved), 0),
  })),
});

