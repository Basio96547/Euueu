import { Body, Controller, Get, Inject, Injectable, Param, Post } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service.js';
import { Errors } from '../common/errors.js';
import { publicId } from '../common/money.js';
import { Protect } from '../common/guards.js';

/**
 * المشتريات والتكلفة الشاملة (الفصل 16).
 * الملاحظة الحاكمة: التكلفة تُحسب بالدولار لا بالليرة، وإلا صار الربح
 * وهماً محاسبياً يصنعه سعر الصرف.
 */

interface PoLine { sku: string; qty: number; unitCostUsdCents: number }

@Injectable()
export class ProcurementService {
  constructor(@Inject(PrismaService) private prisma: PrismaService) {}

  /**
   * توزيع التكاليف الإضافية (شحن + جمارك + رسوم) على الوحدات بالقيمة.
   * مثال: بضاعة 14,360$ + تكاليف 2,000$ ⇒ معامل 0.139276
   */
  allocateLandedCost(lines: PoLine[], extraUsdCents: number) {
    const goods = lines.reduce((a, l) => a + l.unitCostUsdCents * l.qty, 0);
    if (goods === 0) throw Errors.badRequest('EMPTY_PO', 'أمر شراء بلا بنود', 'Empty purchase order');
    const factor = extraUsdCents / goods;
    return {
      goodsUsdCents: goods,
      extraUsdCents,
      factor: Math.round(factor * 1_000_000) / 1_000_000,
      lines: lines.map((l) => ({
        ...l,
        landedUnitCostUsdCents: Math.round(l.unitCostUsdCents * (1 + factor)),
      })),
      totalUsdCents: goods + extraUsdCents,
    };
  }

  async createPo(supplierName: string, lines: PoLine[], extraUsdCents = 0) {
    for (const l of lines) {
      const v = await this.prisma.productVariant.findUnique({ where: { sku: l.sku } });
      if (!v) throw Errors.notFound(`المتغيّر ${l.sku}`);
    }
    const alloc = this.allocateLandedCost(lines, extraUsdCents);
    const seq = (await this.prisma.auditLog.count({ where: { entityType: 'purchase_orders' } })) + 1;
    const now = new Date();
    const poNo = `PO-${String(now.getUTCFullYear()).slice(2)}${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(seq).padStart(4, '0')}`;

    await this.prisma.auditLog.create({
      data: {
        action: 'po.create', entityType: 'purchase_orders',
        diff: { poNo, supplierName, state: 'CONFIRMED', ...alloc },
      },
    });

    // زيادة incoming: البضاعة في الطريق ليست متاحة للبيع لكنها معلومة للتخطيط
    for (const l of alloc.lines) {
      const v = await this.prisma.productVariant.findUniqueOrThrow({ where: { sku: l.sku } });
      const level = await this.prisma.inventoryLevel.findFirst({ where: { variantId: v.id } });
      if (level) {
        await this.prisma.inventoryLevel.update({
          where: { id: level.id },
          data: { incoming: { increment: l.qty }, version: { increment: 1 } },
        });
      }
    }
    return { poNo, ...alloc };
  }

  /**
   * استلام البضاعة: معاملة ذرّية تنشئ وحدات الأجهزة وتزيد العدّاد وتكتب
   * دفتر الحركات معاً — والمحفِّز يرفض المعاملة كلها عند أي انحراف.
   */
  async receive(poNo: string, receipts: Array<{ sku: string; imeis: string[]; unitCostUsdCents: number }>) {
    const results: Array<{ sku: string; received: number; rejected: string[] }> = [];

    for (const r of receipts) {
      const variant = await this.prisma.productVariant.findUnique({
        where: { sku: r.sku }, include: { product: true },
      });
      if (!variant) throw Errors.notFound(`المتغيّر ${r.sku}`);

      /* لا يُستلَم مخزون حقيقي في منتج ما زال تجريبياً: كمية البذرة
         رقم عرضي لا يقابله وحدات، فخلطها ببضاعة حقيقية يكسر الثابت
         الذي يمنع البيع الزائد. التحويل أولاً (الفصل 7 §7.10). */
      if (variant.product.isDemo) {
        throw Errors.badRequest(
          'DEMO_PRODUCT_NOT_RECEIVABLE',
          `المنتج ${r.sku} ما زال تجريبياً — حوّله إلى منتج حقيقي قبل استلام بضاعة عليه`,
          'Convert the demo product before receiving real stock',
        );
      }
      const level = await this.prisma.inventoryLevel.findFirst({ where: { variantId: variant.id } });
      if (!level) throw Errors.notFound(`مستوى مخزون ${r.sku}`);

      const valid = r.imeis.filter((i) => luhn(i));
      const rejected = r.imeis.filter((i) => !luhn(i));

      try {
      await this.prisma.$transaction(async (tx) => {
        for (const imei of valid) {
          await tx.deviceUnit.create({
            data: {
              variantId: variant.id, warehouseId: level.warehouseId, imei,
              state: 'IN_STOCK', imeiCheckStatus: 'CLEAN',
              acquisitionCostUsdCents: BigInt(r.unitCostUsdCents),
            },
          });
        }
        /* للأجهزة المتتبَّعة بالوحدة، الوحدات هي مصدر الحقيقة:
           يُضبط العدّاد على عددها لا يُزاد عمياً — وإلا رفض المحفِّز المعاملة. */
        const unitCount = await tx.deviceUnit.count({
          where: { variantId: variant.id, warehouseId: level.warehouseId, state: 'IN_STOCK' },
        });
        await tx.inventoryLevel.update({
          where: { id: level.id },
          data: {
            onHand: unitCount,
            incoming: { decrement: Math.min(valid.length, level.incoming) },
            version: { increment: 1 },
          },
        });
        await tx.inventoryMovement.create({
          data: {
            variantId: variant.id, warehouseId: level.warehouseId,
            reason: 'RECEIPT', qtyDelta: valid.length, refType: 'purchase_order', note: poNo,
          },
        });
      });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('انحراف مخزون')) throw Errors.stockDrift(msg.split('ERROR:').pop()?.trim() ?? msg);
        throw e;
      }

      results.push({ sku: r.sku, received: valid.length, rejected });
    }

    await this.prisma.auditLog.create({
      data: { action: 'po.receive', entityType: 'purchase_orders', diff: { poNo, results } },
    });
    return { poNo, results };
  }

  /** الربحية لكل موديل: بالدولار حصراً */
  async profitability() {
    const items = await this.prisma.orderItem.findMany({
      where: { order: { status: 'DELIVERED' } },
      include: { variant: { include: { product: true } } },
    });
    const byModel = new Map<string, { name: string; qty: number; revenue: number; cost: number }>();
    for (const it of items) {
      const key = it.variant.product.slug;
      const cur = byModel.get(key) ?? { name: (it.variant.product.name as any).ar, qty: 0, revenue: 0, cost: 0 };
      cur.qty += it.qty;
      cur.revenue += Number(it.lineTotalUsdCents);
      cur.cost += Number(it.variant.costPriceUsdCents ?? 0n) * it.qty;
      byModel.set(key, cur);
    }
    return [...byModel.entries()].map(([slug, v]) => ({
      slug, name: v.name, qty: v.qty,
      revenueUsdCents: v.revenue, cogsUsdCents: v.cost,
      marginUsdCents: v.revenue - v.cost,
      marginPct: v.revenue ? Math.round(((v.revenue - v.cost) / v.revenue) * 1000) / 10 : 0,
    })).sort((a, b) => b.marginUsdCents - a.marginUsdCents);
  }

  /** تنبيهات مالية آلية (الفصل 16) */
  async alerts() {
    const out: Array<{ code: string; ar: string; detail: unknown }> = [];

    const variants = await this.prisma.productVariant.findMany({
      where: { deletedAt: null, costPriceUsdCents: { not: null } },
      include: { product: true },
    });
    for (const v of variants) {
      if (Number(v.priceUsdCents) < Number(v.costPriceUsdCents)) {
        out.push({
          code: 'SELLING_BELOW_COST', ar: 'منتج يُباع تحت التكلفة',
          detail: { sku: v.sku, name: (v.product.name as any).ar,
                    price: Number(v.priceUsdCents), cost: Number(v.costPriceUsdCents) },
        });
      }
    }

    const low = await this.prisma.inventoryLevel.findMany({
      where: { onHand: { lte: 2 } }, include: { variant: { include: { product: true } } }, take: 20,
    });
    for (const l of low) {
      out.push({
        code: 'LOW_STOCK', ar: 'مخزون منخفض',
        detail: { sku: l.variant.sku, name: (l.variant.product.name as any).ar, onHand: l.onHand },
      });
    }
    return out;
  }
}

/** خوارزمية Luhn — كل IMEI صالح يمر بها */
function luhn(imei: string): boolean {
  if (!/^[0-9]{15}$/.test(imei)) return false;
  let sum = 0;
  for (let i = 0; i < 15; i++) {
    let d = Number(imei[14 - i]);
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}

@Controller('admin/procurement')
@Protect('ADMIN')
export class ProcurementController {
  constructor(@Inject(ProcurementService) private p: ProcurementService) {}

  @Post('purchase-orders')
  async create(@Body() b: { supplierName: string; lines: PoLine[]; extraUsdCents?: number }) {
    return { data: await this.p.createPo(b.supplierName, b.lines, b.extraUsdCents ?? 0) };
  }

  @Post('purchase-orders/:poNo/receive')
  async receive(@Param('poNo') poNo: string, @Body() b: { receipts: Array<{ sku: string; imeis: string[]; unitCostUsdCents: number }> }) {
    return { data: await this.p.receive(poNo, b.receipts) };
  }

  @Get('profitability')
  async profit() { return { data: await this.p.profitability() }; }

  @Get('alerts')
  async alerts() { return { data: await this.p.alerts() }; }
}
