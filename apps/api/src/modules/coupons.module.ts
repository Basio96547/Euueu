import { Body, Controller, Delete, Get, Inject, Injectable, Param, Post } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service.js';
import { Errors } from '../common/errors.js';
import { Protect } from '../common/guards.js';
import type { Prisma } from '@prisma/client';

/**
 * الكوبونات — الفصل 7 §7.7
 *
 * كل المبالغ بسنتات الدولار. خصمٌ محرَّر بالليرة يفقد معناه بعد أول
 * قفزة صرف: «خصم 50 ألف» كان ربع الجهاز فصار عُشره بلا أن يلمسه أحد.
 *
 * ولا يُحسب الخصم في العميل أبداً. الرقم القادم من المتصفح رأيٌ لا حقيقة.
 */
@Injectable()
export class CouponsService {
  constructor(@Inject(PrismaService) private prisma: PrismaService) {}

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

    if (c.categorySlugs.length && args.categorySlugs?.length) {
      const overlap = args.categorySlugs.some((s) => c.categorySlugs.includes(s));
      if (!overlap) {
        throw Errors.badRequest('COUPON_NOT_APPLICABLE',
          `هذا الرمز يخصّ ${c.categorySlugs.join('، ')} فقط`, 'Coupon not applicable to cart');
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
  async redeem(
    tx: Prisma.TransactionClient,
    args: { couponId: string; orderId: string; phone: string; discountUsdCents: number },
  ) {
    await tx.couponRedemption.create({
      data: {
        couponId: args.couponId, orderId: args.orderId,
        phone: args.phone, discountUsdCents: args.discountUsdCents,
      },
    });
    await tx.coupon.update({
      where: { id: args.couponId },
      data: { usedCount: { increment: 1 } },
    });
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

  async list() {
    const rows = await this.prisma.coupon.findMany({ orderBy: { createdAt: 'desc' }, take: 100 });
    const now = new Date();
    return rows.map((c) => ({
      code: c.code, type: c.type, value: c.value,
      maxDiscountUsdCents: c.maxDiscountUsdCents,
      minSubtotalUsdCents: c.minSubtotalUsdCents,
      categorySlugs: c.categorySlugs,
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

@Controller()
export class CouponsController {
  constructor(@Inject(CouponsService) private c: CouponsService) {}

  /** معاينة أثر الرمز على سلة قائمة قبل الطلب */
  @Post('coupons/preview')
  async preview(@Body() b: { code: string; subtotalUsdCents: number; shippingUsdCents?: number; phone?: string }) {
    return {
      data: await this.c.evaluate(b.code, {
        subtotalUsdCents: b.subtotalUsdCents,
        shippingUsdCents: b.shippingUsdCents ?? 0,
        phone: b.phone,
      }),
    };
  }

  @Get('admin/quantity-breaks')
  @Protect('OPS_MANAGER', 'ADMIN')
  async listBreaks() { return { data: await this.c.listBreaks() }; }

  @Post('admin/quantity-breaks')
  @Protect('ADMIN')
  async upsertBreak(@Body() b: any) { return { data: await this.c.upsertBreak(b) }; }

  @Delete('admin/quantity-breaks/:id')
  @Protect('ADMIN')
  async deleteBreak(@Param('id') id: string) { return { data: await this.c.deleteBreak(id) }; }

  @Get('admin/coupons')
  @Protect('OPS_MANAGER', 'ADMIN')
  async list() { return { data: await this.c.list() }; }

  @Post('admin/coupons')
  @Protect('ADMIN')
  async upsert(@Body() b: any) { return { data: await this.c.upsert(b) }; }

  @Post('admin/coupons/:code/toggle')
  @Protect('ADMIN')
  async toggle(@Param('code') code: string, @Body() b: { isActive: boolean }) {
    return { data: await this.c.toggle(code, b.isActive) };
  }
}
