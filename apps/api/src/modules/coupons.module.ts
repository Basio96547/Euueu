import { PrismaService } from '../common/prisma.service.js';
import { randomUUID } from 'node:crypto';
import { Errors } from '../common/errors.js';
import { strList } from '../common/json-list.js';
import { runBatch } from '../common/batch.js';
import type { Prisma } from '@prisma/client';

/**
 * الكوبونات — الفصل 7 §7.7
 *
 * كل المبالغ بسنتات الدولار. خصمٌ محرَّر بالليرة يفقد معناه بعد أول
 * قفزة صرف: «خصم 50 ألف» كان ربع الجهاز فصار عُشره بلا أن يلمسه أحد.
 *
 * ولا يُحسب الخصم في العميل أبداً. الرقم القادم من المتصفح رأيٌ لا حقيقة.
 */
export class CouponsService {
  constructor(private prisma: PrismaService) {}

  /**
   * تقييم كوبون على سلة: يعيد الخصم بالسنتات أو يرمي سبباً مفهوماً.
   * لا يزيد العدّاد — الزيادة تقع في معاملة إنشاء الطلب وحدها،
   * وإلا استنفد فضوليٌّ كوبوناً بإدخال رمزه دون أن يشتري شيئاً.
   */
  async evaluate(code: string, args: {
    subtotalUsdCents: number; shippingUsdCents: number; phone?: string;
    categorySlugs?: string[];
  }) {
    const c = await this.prisma.coupon.findUnique({ where: { code: code.trim().toUpperCase() } });
    if (!c || !c.isActive) {
      throw Errors.badRequest('COUPON_INVALID', 'رمز الخصم غير صالح', 'Coupon invalid');
    }

    const now = new Date();
    if (now < c.startsAt) {
      throw Errors.badRequest('COUPON_NOT_STARTED',
        `يبدأ العمل بهذا الرمز في ${c.startsAt.toISOString().slice(0, 10)}`, 'Coupon not started');
    }
    if (now > c.endsAt) {
      throw Errors.badRequest('COUPON_EXPIRED', 'انتهت صلاحية رمز الخصم', 'Coupon expired');
    }
    if (c.usageLimitTotal !== null && c.usedCount >= c.usageLimitTotal) {
      throw Errors.badRequest('COUPON_EXHAUSTED', 'استُنفد هذا الرمز', 'Coupon exhausted');
    }
    if (args.subtotalUsdCents < c.minSubtotalUsdCents) {
      const need = ((c.minSubtotalUsdCents - args.subtotalUsdCents) / 100).toFixed(2);
      throw Errors.badRequest('COUPON_MIN_SUBTOTAL',
        `يلزم ${need}$ إضافية لتفعيل هذا الرمز`, 'Subtotal below minimum');
    }

    // الحد لكل عميل مربوط بالجوال الموثّق: الجلسة تُمحى بضغطة، والرقم لا
    if (args.phone) {
      const used = await this.prisma.couponRedemption.count({
        where: { couponId: c.id, phone: args.phone },
      });
      if (used >= c.usageLimitPerCustomer) {
        throw Errors.badRequest('COUPON_ALREADY_USED',
          'استُخدم هذا الرمز على رقمك من قبل', 'Coupon already used by this customer');
      }
      if (c.firstOrderOnly) {
        const prior = await this.prisma.order.count({
          where: { shippingAddress: { phone: args.phone }, status: { not: 'CANCELLED' } },
        });
        if (prior > 0) {
          throw Errors.badRequest('COUPON_FIRST_ORDER_ONLY',
            'هذا الرمز للطلب الأول فقط', 'First order only');
        }
      }
    }

    const couponCats = strList(c.categorySlugs);
    if (couponCats.length && args.categorySlugs?.length) {
      const overlap = args.categorySlugs.some((s) => couponCats.includes(s));
      if (!overlap) {
        throw Errors.badRequest('COUPON_NOT_APPLICABLE',
          `هذا الرمز يخصّ ${couponCats.join('، ')} فقط`, 'Coupon not applicable to cart');
      }
    }

    let discount = 0;
    if (c.type === 'PERCENTAGE') discount = Math.floor((args.subtotalUsdCents * c.value) / 100);
    else if (c.type === 'FIXED_AMOUNT') discount = c.value;
    else if (c.type === 'FREE_SHIPPING') discount = args.shippingUsdCents;

    if (c.maxDiscountUsdCents !== null) discount = Math.min(discount, c.maxDiscountUsdCents);
    // الخصم لا يتجاوز ما يُدفع: طلبٌ بمستحق سالب لا معنى له نقداً
    discount = Math.max(0, Math.min(discount, args.subtotalUsdCents + args.shippingUsdCents));

    return {
      code: c.code, type: c.type,
      discountUsdCents: discount,
      freeShipping: c.type === 'FREE_SHIPPING',
      couponId: c.id,
    };
  }

  /** يُستدعى داخل معاملة إنشاء الطلب: الزيادة ذرية والاستخدام مقيَّد */
  /**
   * عمليتا الاستخدام تُعادان لتُضمّا إلى دفعة إنشاء الطلب لا لتُنفَّذا هنا:
   * الاستخدام يُسجَّل مع الطلب أو لا يُسجَّل. لو نُفِّذ على حدة لأمكن أن
   * يُستهلك الكوبون ثم يفشل إنشاء الطلب، فيخسر صاحبه رمزاً لم يشترِ به.
   */
  redeemOps(args: { couponId: string; orderId: string; phone: string; discountUsdCents: number }) {
    return [
      this.prisma.couponRedemption.create({
        data: {
          couponId: args.couponId, orderId: args.orderId,
          phone: args.phone, discountUsdCents: args.discountUsdCents,
        },
      }),
      this.prisma.coupon.update({
        where: { id: args.couponId },
        data: { usedCount: { increment: 1 } },
      }),
    ];
  }

  /**
   * عرض الكمية — الفصل 7 §7.7
   *
   * يُطبَّق على السطر لا على السلة: من اشترى ثلاث سماعات يستحق شريحتها،
   * ولا يستحقها من اشترى سماعة وجرابين. وأولويته قبل الكوبون في سلّم
   * التعارض، وهما لا يجتمعان إلا إن كان الكوبون قابلاً للتراكم.
   */
  async quantityBreakFor(sku: string, categorySlug: string | null, qty: number) {
    const rows = await this.prisma.quantityBreak.findMany({
      where: {
        isActive: true,
        minQty: { lte: qty },
        OR: [
          { variantSku: sku },
          ...(categorySlug ? [{ categorySlug }] : []),
        ],
      },
      orderBy: [{ minQty: 'desc' }],
    });
    // الأخصّ يفوز: شريحة الصنف قبل شريحة فئته مهما كانت النسبة
    const exact = rows.find((r) => r.variantSku === sku);
    const best = exact ?? rows[0];
    return best ? { minQty: best.minQty, discountBp: best.discountBp } : null;
  }

  async listBreaks() {
    const rows = await this.prisma.quantityBreak.findMany({
      orderBy: [{ categorySlug: 'asc' }, { minQty: 'asc' }],
    });
    return rows.map((r) => ({
      id: r.id, variantSku: r.variantSku, categorySlug: r.categorySlug,
      minQty: r.minQty, discountBp: r.discountBp,
      discountPct: r.discountBp / 100,
      isActive: r.isActive, note: r.note,
    }));
  }

  async upsertBreak(b: any) {
    if (!b.variantSku && !b.categorySlug) {
      throw Errors.badRequest('TARGET_REQUIRED',
        'الشريحة تحتاج صنفاً أو فئة', 'Specify a SKU or a category');
    }
    if (b.variantSku && b.categorySlug) {
      throw Errors.badRequest('TARGET_AMBIGUOUS',
        'الشريحة على صنف أو على فئة، لا على الاثنين', 'Choose SKU or category, not both');
    }
    if (!Number.isInteger(b.minQty) || b.minQty < 2) {
      throw Errors.badRequest('MIN_QTY_INVALID',
        'أقل كمية للشريحة قطعتان', 'Minimum quantity must be 2 or more');
    }
    if (!Number.isInteger(b.discountBp) || b.discountBp < 1 || b.discountBp > 5000) {
      throw Errors.badRequest('DISCOUNT_INVALID',
        'الخصم بين 1 و5000 نقطة أساس (0.01% إلى 50%)', 'Discount must be 1..5000 bp');
    }
    const row = await this.prisma.quantityBreak.create({
      data: {
        variantSku: b.variantSku ?? null,
        categorySlug: b.categorySlug ?? null,
        minQty: b.minQty, discountBp: b.discountBp,
        note: b.note ?? null,
      },
    });
    return { id: row.id, minQty: row.minQty, discountBp: row.discountBp };
  }

  async deleteBreak(id: string) {
    await this.prisma.quantityBreak.deleteMany({ where: { id } });
    return { deleted: true };
  }

  /* ————— الحزم — الفصل 7 §7.7 ————— */

  /**
   * الحزم المنطبقة على سلة.
   *
   * الحزمة تُطبَّق حين تحتوي السلة كل مفرداتها بالكميات المطلوبة.
   * ولا تُطبَّق مرتين على المفردات نفسها: زبونٌ اشترى جوالين وشاحناً
   * واحداً يستحق حزمة واحدة لا اثنتين — وحسابُها بالقسمة على الحد
   * الأدنى يعطي خصماً على بضاعة لم تُشترَ.
   *
   * والسعر معلن كاملاً لا نسبةً: «الحزمة بـ٢٩٩$» أوضح للزبون من
   * «خصم ١٧٪» يحتاج آلة حاسبة ليعرف ماذا سيدفع.
   */
  async bundlesFor(lines: Array<{ sku: string; qty: number; unitPriceUsdCents: number }>) {
    const now = new Date();
    const active = await this.prisma.bundle.findMany({
      where: {
        isActive: true,
        AND: [
          { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
          { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
        ],
      },
      include: { items: true },
    });

    const have = new Map(lines.map((l) => [l.sku, l]));
    const applied: Array<{
      code: string; name: unknown; times: number;
      bundlePriceUsdCents: number; listPriceUsdCents: number; savedUsdCents: number;
      items: Array<{ sku: string; qty: number }>;
    }> = [];

    for (const b of active) {
      if (!b.items.length) continue;
      // كم مرة تتكرر الحزمة كاملةً في السلة — الأقل بين مفرداتها
      let times = Infinity;
      for (const it of b.items) {
        const line = have.get(it.variantSku);
        if (!line) { times = 0; break; }
        times = Math.min(times, Math.floor(line.qty / it.qty));
      }
      if (!Number.isFinite(times) || times < 1) continue;

      const list = b.items.reduce(
        (a, it) => a + (have.get(it.variantSku)!.unitPriceUsdCents * it.qty), 0,
      );
      // حزمة أغلى من مفرداتها ليست عرضاً — تُتجاهَل بلا ضجيج
      if (b.priceUsdCents >= list) continue;

      applied.push({
        code: b.code, name: b.name, times,
        bundlePriceUsdCents: b.priceUsdCents * times,
        listPriceUsdCents: list * times,
        savedUsdCents: (list - b.priceUsdCents) * times,
        items: b.items.map((it) => ({ sku: it.variantSku, qty: it.qty * times })),
      });
    }

    return applied;
  }

  async listBundles() {
    const rows = await this.prisma.bundle.findMany({
      orderBy: { createdAt: 'desc' }, include: { items: true }, take: 100,
    });
    const skus = [...new Set(rows.flatMap((b) => b.items.map((i) => i.variantSku)))];
    const variants = await this.prisma.productVariant.findMany({
      where: { sku: { in: skus } }, include: { product: true },
    });
    const byS = new Map(variants.map((v) => [v.sku, v]));

    return rows.map((b) => {
      const list = b.items.reduce(
        (a, i) => a + Number(byS.get(i.variantSku)?.priceUsdCents ?? 0) * i.qty, 0,
      );
      return {
        code: b.code, name: b.name,
        priceUsdCents: b.priceUsdCents,
        listPriceUsdCents: list,
        savedUsdCents: Math.max(0, list - b.priceUsdCents),
        isActive: b.isActive,
        startsAt: b.startsAt, endsAt: b.endsAt,
        items: b.items.map((i) => ({
          sku: i.variantSku, qty: i.qty,
          name: (byS.get(i.variantSku)?.product.name as any)?.ar ?? i.variantSku,
          unitPriceUsdCents: Number(byS.get(i.variantSku)?.priceUsdCents ?? 0),
        })),
      };
    });
  }

  async upsertBundle(b: any) {
    if (!/^[A-Z0-9_-]{3,32}$/.test(b.code ?? '')) {
      throw Errors.badRequest('BUNDLE_CODE_INVALID',
        'رمز الحزمة: حروف لاتينية كبيرة وأرقام', 'Invalid bundle code');
    }
    if (!b.name?.ar?.trim()) {
      throw Errors.badRequest('NAME_REQUIRED', 'اسم الحزمة بالعربية إلزامي', 'Arabic name required');
    }
    const items: Array<{ sku: string; qty: number }> = (b.items ?? [])
      .map((i: any) => ({ sku: String(i.sku ?? '').toUpperCase(), qty: Number(i.qty) || 1 }))
      .filter((i: any) => i.sku);
    if (items.length < 2) {
      throw Errors.badRequest('BUNDLE_NEEDS_TWO',
        'الحزمة صنفان على الأقل — صنفٌ واحد سعرٌ لا حزمة',
        'A bundle needs at least two items');
    }
    if (!Number.isInteger(b.priceUsdCents) || b.priceUsdCents <= 0) {
      throw Errors.badRequest('PRICE_INVALID', 'سعر الحزمة عدد موجب بالسنتات', 'Invalid price');
    }

    const found = await this.prisma.productVariant.findMany({
      where: { sku: { in: items.map((i) => i.sku) } },
    });
    if (found.length !== items.length) {
      const missing = items.map((i) => i.sku).filter((s) => !found.some((v) => v.sku === s));
      throw Errors.notFound(`المتغيّرات ${missing.join('، ')}`);
    }

    // حزمة أغلى من مفرداتها تُرفض عند الإنشاء لا تُتجاهَل بصمت:
    // الخطأ في لوحة التحكم يُصحَّح، والتجاهل الصامت يُترك سنة
    const list = items.reduce(
      (a, i) => a + Number(found.find((v) => v.sku === i.sku)!.priceUsdCents) * i.qty, 0,
    );
    if (b.priceUsdCents >= list) {
      throw Errors.badRequest('BUNDLE_NOT_CHEAPER',
        `سعر الحزمة (${(b.priceUsdCents / 100).toFixed(2)}$) يجب أن يقلّ عن مجموع مفرداتها (${(list / 100).toFixed(2)}$)`,
        'Bundle must be cheaper than its parts');
    }

    const data = {
      name: b.name as any,
      description: (b.description ?? null) as any,
      priceUsdCents: b.priceUsdCents,
      startsAt: b.startsAt ? new Date(b.startsAt) : null,
      endsAt: b.endsAt ? new Date(b.endsAt) : null,
      isActive: b.isActive ?? true,
    };

    const existing = await this.prisma.bundle.findUnique({ where: { code: b.code } });
    // المعرّف يُولَّد هنا لا في القاعدة: الدفعة تحتاجه قبل أن تُنفَّذ
    const bundleId = existing?.id ?? randomUUID();
    await runBatch(this.prisma, [
      existing
        ? this.prisma.bundle.update({ where: { id: bundleId }, data })
        : this.prisma.bundle.create({ data: { ...data, id: bundleId, code: b.code } }),
      this.prisma.bundleItem.deleteMany({ where: { bundleId } }),
      this.prisma.bundleItem.createMany({
        data: items.map((i) => ({ bundleId, variantSku: i.sku, qty: i.qty })),
      }),
    ]);
    const row = { code: b.code, priceUsdCents: data.priceUsdCents };

    return { code: row.code, savedUsdCents: list - row.priceUsdCents, created: !existing };
  }

  async toggleBundle(code: string, isActive: boolean) {
    const row = await this.prisma.bundle.update({ where: { code }, data: { isActive } });
    return { code: row.code, isActive: row.isActive };
  }

  async list() {
    const rows = await this.prisma.coupon.findMany({ orderBy: { createdAt: 'desc' }, take: 100 });
    const now = new Date();
    return rows.map((c) => ({
      code: c.code, type: c.type, value: c.value,
      maxDiscountUsdCents: c.maxDiscountUsdCents,
      minSubtotalUsdCents: c.minSubtotalUsdCents,
      categorySlugs: strList(c.categorySlugs),
      startsAt: c.startsAt, endsAt: c.endsAt,
      usedCount: c.usedCount, usageLimitTotal: c.usageLimitTotal,
      usageLimitPerCustomer: c.usageLimitPerCustomer,
      firstOrderOnly: c.firstOrderOnly,
      isActive: c.isActive,
      live: c.isActive && now >= c.startsAt && now <= c.endsAt
        && (c.usageLimitTotal === null || c.usedCount < c.usageLimitTotal),
    }));
  }

  async upsert(b: any) {
    const code = String(b.code ?? '').trim().toUpperCase();
    if (!/^[A-Z0-9_-]{3,32}$/.test(code)) {
      throw Errors.badRequest('COUPON_CODE_INVALID',
        'الرمز: حروف لاتينية وأرقام و«-» و«_» بين ثلاثة واثنين وثلاثين حرفاً',
        'Invalid coupon code');
    }
    if (b.type === 'PERCENTAGE' && (b.value < 1 || b.value > 100)) {
      throw Errors.badRequest('COUPON_VALUE_INVALID',
        'النسبة بين 1 و100', 'Percentage must be 1..100');
    }
    const startsAt = new Date(b.startsAt ?? Date.now());
    const endsAt = new Date(b.endsAt ?? Date.now() + 30 * 86_400_000);
    if (endsAt <= startsAt) {
      throw Errors.badRequest('COUPON_DATES_INVALID',
        'تاريخ الانتهاء يجب أن يلي البداية', 'endsAt must follow startsAt');
    }

    const data = {
      type: b.type, value: Number(b.value),
      maxDiscountUsdCents: b.maxDiscountUsdCents ?? null,
      minSubtotalUsdCents: b.minSubtotalUsdCents ?? 0,
      categorySlugs: b.categorySlugs ?? [],
      startsAt, endsAt,
      usageLimitTotal: b.usageLimitTotal ?? null,
      usageLimitPerCustomer: b.usageLimitPerCustomer ?? 1,
      firstOrderOnly: Boolean(b.firstOrderOnly),
      stackable: Boolean(b.stackable),
      isActive: b.isActive ?? true,
      note: b.note ?? null,
    };
    const row = await this.prisma.coupon.upsert({ where: { code }, update: data, create: { code, ...data } });
    return { code: row.code, isActive: row.isActive };
  }

  async toggle(code: string, isActive: boolean) {
    const row = await this.prisma.coupon.update({
      where: { code: code.toUpperCase() }, data: { isActive },
    });
    return { code: row.code, isActive: row.isActive };
  }
}

