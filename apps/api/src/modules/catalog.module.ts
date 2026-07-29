import { PrismaService } from '../common/prisma.service.js';
import { FxService } from './fx.module.js';
import { Errors } from '../common/errors.js';

const demoMode = () => (process.env.DEMO_MODE ?? 'true') === 'true';

export class CatalogService {
  constructor(
    private prisma: PrismaService,
  ) {}

  private where() {
    return { status: 'PUBLISHED' as const, deletedAt: null, ...(demoMode() ? {} : { isDemo: false }) };
  }

  async list(categorySlug?: string, limit = 24) {
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
    return this.prisma.product.findMany({
      where: { ...this.where(), ...(categoryIds ? { categoryId: { in: categoryIds } } : {}) },
      take: Math.min(limit, 100),
      include: {
        brand: true,
        variants: { where: { deletedAt: null }, include: { levels: true }, orderBy: { isDefault: 'desc' } },
      },
    });
  }

  async bySlug(slug: string) {
    const p = await this.prisma.product.findFirst({
      where: { slug, ...this.where() },
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
    publicId: v.publicId, sku: v.sku, colorName: v.colorName,
    storageGb: v.storageGb, ramGb: v.ramGb, networkGen: v.networkGen,
    dualSim: v.dualSim, esimOnly: v.esimOnly, partCode: v.partCode,
    condition: v.condition, batteryHealthPct: v.batteryHealthPct,
    deviceOrigin: v.deviceOrigin, warrantyType: v.warrantyType, warrantyMonths: v.warrantyMonths,
    priceUsdCents: Number(v.priceUsdCents),
    compareAtPriceUsdCents: v.compareAtPriceUsdCents == null ? null : Number(v.compareAtPriceUsdCents),
    available: v.levels.reduce((a: number, l: any) => a + (l.onHand - l.reserved), 0),
  })),
});

