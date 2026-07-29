import { PrismaService } from '../common/prisma.service.js';
import { Errors } from '../common/errors.js';

/**
 * المشتريات والتكلفة الشاملة (الفصل 16).
 * الملاحظة الحاكمة: التكلفة تُحسب بالدولار لا بالليرة، وإلا صار الربح
 * وهماً محاسبياً يصنعه سعر الصرف.
 *
 * أوامر الشراء كانت تُخزَّن في `audit_logs`: لا استعلام عليها، ولا حالة
 * إلا مستنتَجة من آخر سطر، وتضيع لو نُظّف السجل. وهو العيب نفسه الذي
 * أُصلح في مطالبات الكفالة — فأُصلح هنا بالطريقة نفسها: جداولٌ للحالة،
 * والسجل للتدقيق وحده.
 */

interface PoLine { sku: string; qty: number; unitCostUsdCents: number }

export class ProcurementService {
  constructor(private prisma: PrismaService) {}

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

  /* ————————————————— الموردون ————————————————— */

  async listSuppliers() {
    const rows = await this.prisma.supplier.findMany({
      where: { deletedAt: null },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      include: { _count: { select: { purchaseOrders: true } } },
    });
    return rows.map((s) => ({
      code: s.code, name: s.name, contactName: s.contactName, contactPhone: s.contactPhone,
      country: s.country, leadTimeDays: s.leadTimeDays, isActive: s.isActive,
      poCount: s._count.purchaseOrders, notes: s.notes,
    }));
  }

  async createSupplier(b: {
    code: string; name: string; contactName?: string; contactPhone?: string;
    country?: string; leadTimeDays?: number; notes?: string;
  }) {
    const code = (b.code ?? '').trim().toUpperCase();
    if (!/^[A-Z0-9-]{2,24}$/.test(code)) {
      throw Errors.badRequest('SUPPLIER_CODE_INVALID',
        'رمز المورد أحرف لاتينية وأرقام وشرطات، 2 إلى 24 خانة', 'Invalid supplier code');
    }
    if (!b.name?.trim()) {
      throw Errors.badRequest('SUPPLIER_NAME_REQUIRED', 'اسم المورد مطلوب', 'Supplier name required');
    }
    const exists = await this.prisma.supplier.findUnique({ where: { code } });
    if (exists) {
      throw Errors.badRequest('SUPPLIER_CODE_TAKEN', `الرمز ${code} مستعمل`, 'Supplier code taken');
    }
    const s = await this.prisma.supplier.create({
      data: {
        code, name: b.name.trim(), contactName: b.contactName, contactPhone: b.contactPhone,
        country: b.country?.toUpperCase().slice(0, 2), leadTimeDays: b.leadTimeDays ?? 14, notes: b.notes,
      },
    });
    await this.prisma.auditLog.create({
      data: { action: 'supplier.create', entityType: 'suppliers', entityId: s.id, diff: { code, name: s.name } },
    });
    return { code: s.code, name: s.name };
  }

  async setSupplierActive(code: string, isActive: boolean) {
    const s = await this.prisma.supplier.findUnique({ where: { code } });
    if (!s) throw Errors.notFound('المورد');
    await this.prisma.supplier.update({ where: { id: s.id }, data: { isActive } });
    await this.prisma.auditLog.create({
      data: { action: 'supplier.set_active', entityType: 'suppliers', entityId: s.id, diff: { isActive } },
    });
    return { code, isActive };
  }

  /* ————————————————— أوامر الشراء ————————————————— */

  async createPo(supplierCode: string, lines: PoLine[], extraUsdCents = 0, expectedAt?: string, note?: string) {
    const supplier = await this.prisma.supplier.findUnique({ where: { code: supplierCode } });
    if (!supplier) throw Errors.notFound(`المورد ${supplierCode}`);
    if (!supplier.isActive) {
      throw Errors.badRequest('SUPPLIER_INACTIVE',
        'المورد موقوف — فعّله قبل إصدار أمر شراء له', 'Supplier is inactive');
    }

    const variants = new Map<string, string>();
    for (const l of lines) {
      const v = await this.prisma.productVariant.findUnique({ where: { sku: l.sku } });
      if (!v) throw Errors.notFound(`المتغيّر ${l.sku}`);
      if (l.qty <= 0) {
        throw Errors.badRequest('PO_QTY_INVALID', `كمية غير صالحة على ${l.sku}`, 'Invalid quantity');
      }
      variants.set(l.sku, v.id);
    }

    const alloc = this.allocateLandedCost(lines, extraUsdCents);
    const now = new Date();
    const yy = String(now.getUTCFullYear()).slice(2);
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    const seq = (await this.prisma.purchaseOrder.count()) + 1;
    const poNo = `PO-${yy}${mm}-${String(seq).padStart(4, '0')}`;

    const po = await this.prisma.$transaction(async (tx) => {
      const created = await tx.purchaseOrder.create({
        data: {
          poNo, supplierId: supplier.id, state: 'CONFIRMED',
          goodsUsdCents: BigInt(alloc.goodsUsdCents),
          extraUsdCents: BigInt(alloc.extraUsdCents),
          totalUsdCents: BigInt(alloc.totalUsdCents),
          landedFactorPpm: Math.round(alloc.factor * 1_000_000),
          expectedAt: expectedAt ? new Date(expectedAt) : null,
          note,
          lines: {
            create: alloc.lines.map((l) => ({
              variantId: variants.get(l.sku)!,
              qty: l.qty,
              unitCostUsdCents: BigInt(l.unitCostUsdCents),
              landedUnitCostUsdCents: BigInt(l.landedUnitCostUsdCents),
            })),
          },
        },
      });

      // زيادة incoming: البضاعة في الطريق ليست متاحة للبيع لكنها معلومة للتخطيط
      for (const l of alloc.lines) {
        const level = await tx.inventoryLevel.findFirst({ where: { variantId: variants.get(l.sku)! } });
        if (level) {
          await tx.inventoryLevel.update({
            where: { id: level.id },
            data: { incoming: { increment: l.qty }, version: { increment: 1 } },
          });
        }
      }

      await tx.auditLog.create({
        data: {
          action: 'po.create', entityType: 'purchase_orders', entityId: created.id,
          diff: { poNo, supplier: supplier.code, ...alloc },
        },
      });
      return created;
    });

    return { poNo: po.poNo, supplier: supplier.code, state: po.state, ...alloc };
  }

  async listPos(state?: string) {
    const rows = await this.prisma.purchaseOrder.findMany({
      where: state ? { state: state as any } : {},
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { supplier: true, lines: { include: { variant: { include: { product: true } } } } },
    });
    return rows.map((po) => ({
      poNo: po.poNo,
      supplier: { code: po.supplier.code, name: po.supplier.name },
      state: po.state,
      goodsUsdCents: Number(po.goodsUsdCents),
      extraUsdCents: Number(po.extraUsdCents),
      totalUsdCents: Number(po.totalUsdCents),
      landedFactor: po.landedFactorPpm / 1_000_000,
      expectedAt: po.expectedAt,
      receivedAt: po.receivedAt,
      createdAt: po.createdAt,
      lines: po.lines.map((l) => ({
        sku: l.variant.sku,
        name: (l.variant.product.name as any).ar,
        qty: l.qty,
        qtyReceived: l.qtyReceived,
        unitCostUsdCents: Number(l.unitCostUsdCents),
        landedUnitCostUsdCents: Number(l.landedUnitCostUsdCents),
      })),
    }));
  }

  /**
   * استلام البضاعة: معاملة ذرّية تنشئ وحدات الأجهزة وتزيد العدّاد وتكتب
   * دفتر الحركات معاً — والمحفِّز يرفض المعاملة كلها عند أي انحراف.
   */
  async receive(poNo: string, receipts: Array<{ sku: string; imeis: string[]; unitCostUsdCents?: number }>) {
    const po = await this.prisma.purchaseOrder.findUnique({
      where: { poNo }, include: { lines: { include: { variant: true } } },
    });
    if (!po) throw Errors.notFound(`أمر الشراء ${poNo}`);
    if (po.state === 'CANCELLED') {
      throw Errors.badRequest('PO_CANCELLED', 'أمر شراء ملغى لا يُستلَم', 'Cancelled PO cannot be received');
    }
    if (po.state === 'RECEIVED') {
      throw Errors.badRequest('PO_ALREADY_RECEIVED',
        'اكتمل استلام هذا الأمر', 'Purchase order already fully received');
    }

    const results: Array<{ sku: string; received: number; rejected: string[] }> = [];

    for (const r of receipts) {
      const variant = await this.prisma.productVariant.findUnique({
        where: { sku: r.sku }, include: { product: true },
      });
      if (!variant) throw Errors.notFound(`المتغيّر ${r.sku}`);

      const line = po.lines.find((l) => l.variantId === variant.id);
      if (!line) {
        throw Errors.badRequest('PO_LINE_NOT_FOUND',
          `${r.sku} ليس في أمر الشراء ${poNo}`, 'SKU is not on this purchase order');
      }

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

      /* الاستلام الزائد عن المطلوب يُرفض: بضاعةٌ لم تُطلَب وصلت مسألةُ
         مورد لا سطرُ مخزون، وتمريرها صامتاً يفسد مطابقة الأمر بفاتورته. */
      if (line.qtyReceived + valid.length > line.qty) {
        throw Errors.badRequest('PO_OVER_RECEIPT',
          `الكمية المستلمة على ${r.sku} تتجاوز المطلوب (${line.qty})`,
          'Received quantity exceeds ordered quantity',
          { ordered: line.qty, alreadyReceived: line.qtyReceived, now: valid.length });
      }

      const unitCost = r.unitCostUsdCents ?? Number(line.landedUnitCostUsdCents);

      try {
        await this.prisma.$transaction(async (tx) => {
          for (const imei of valid) {
            await tx.deviceUnit.create({
              data: {
                variantId: variant.id, warehouseId: level.warehouseId, imei,
                state: 'IN_STOCK', imeiCheckStatus: 'CLEAN',
                acquisitionCostUsdCents: BigInt(unitCost),
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
          await tx.purchaseOrderLine.update({
            where: { id: line.id }, data: { qtyReceived: { increment: valid.length } },
          });
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('انحراف مخزون')) throw Errors.stockDrift(msg.split('ERROR:').pop()?.trim() ?? msg);
        throw e;
      }

      results.push({ sku: r.sku, received: valid.length, rejected });
    }

    const fresh = await this.prisma.purchaseOrder.findUniqueOrThrow({
      where: { poNo }, include: { lines: true },
    });
    const done = fresh.lines.every((l) => l.qtyReceived >= l.qty);
    const partial = fresh.lines.some((l) => l.qtyReceived > 0);
    const state = done ? 'RECEIVED' : partial ? 'PARTIALLY_RECEIVED' : fresh.state;

    await this.prisma.purchaseOrder.update({
      where: { poNo },
      data: { state: state as any, receivedAt: done ? new Date() : null },
    });
    await this.prisma.auditLog.create({
      data: {
        action: 'po.receive', entityType: 'purchase_orders', entityId: fresh.id,
        diff: { poNo, results, state },
      },
    });
    return { poNo, state, results };
  }

  async cancelPo(poNo: string, reason: string) {
    if (!reason?.trim()) {
      throw Errors.badRequest('CANCEL_REASON_REQUIRED',
        'إلغاء أمر شراء بلا سبب لا يُقبل', 'Cancellation reason required');
    }
    const po = await this.prisma.purchaseOrder.findUnique({ where: { poNo }, include: { lines: true } });
    if (!po) throw Errors.notFound(`أمر الشراء ${poNo}`);
    if (po.state === 'RECEIVED') {
      throw Errors.badRequest('PO_ALREADY_RECEIVED',
        'أمر مستلَم لا يُلغى — استعمل المرتجع للمورد', 'Received PO cannot be cancelled');
    }

    await this.prisma.$transaction(async (tx) => {
      for (const l of po.lines) {
        const remaining = l.qty - l.qtyReceived;
        if (remaining <= 0) continue;
        const level = await tx.inventoryLevel.findFirst({ where: { variantId: l.variantId } });
        if (level) {
          await tx.inventoryLevel.update({
            where: { id: level.id },
            data: { incoming: { decrement: Math.min(remaining, level.incoming) }, version: { increment: 1 } },
          });
        }
      }
      await tx.purchaseOrder.update({ where: { id: po.id }, data: { state: 'CANCELLED', note: reason } });
      await tx.auditLog.create({
        data: { action: 'po.cancel', entityType: 'purchase_orders', entityId: po.id, diff: { poNo, reason } },
      });
    });
    return { poNo, state: 'CANCELLED' };
  }

  /**
   * تقييم المورد (الفصل 16، مهمة شهرية في 19.2):
   * الالتزام بالمواعيد، ونسبة العيوب المرتجعة، وفارق التكلفة عن المعدّل.
   */
  async supplierScorecard(code: string) {
    const supplier = await this.prisma.supplier.findUnique({
      where: { code },
      include: { purchaseOrders: { include: { lines: true } } },
    });
    if (!supplier) throw Errors.notFound('المورد');

    const pos = supplier.purchaseOrders;
    const received = pos.filter((p) => p.receivedAt);
    const onTime = received.filter((p) => p.expectedAt && p.receivedAt! <= p.expectedAt).length;
    const withEta = received.filter((p) => p.expectedAt).length;

    const orderedUnits = pos.reduce((a, p) => a + p.lines.reduce((x, l) => x + l.qty, 0), 0);
    const receivedUnits = pos.reduce((a, p) => a + p.lines.reduce((x, l) => x + l.qtyReceived, 0), 0);
    const spendUsdCents = pos
      .filter((p) => p.state !== 'CANCELLED')
      .reduce((a, p) => a + Number(p.totalUsdCents), 0);

    return {
      code: supplier.code,
      name: supplier.name,
      poCount: pos.length,
      receivedCount: received.length,
      onTimePct: withEta ? Math.round((onTime / withEta) * 1000) / 10 : null,
      fillRatePct: orderedUnits ? Math.round((receivedUnits / orderedUnits) * 1000) / 10 : null,
      spendUsdCents,
      leadTimeDays: supplier.leadTimeDays,
      /* بلا مواعيد متوقَّعة لا معنى لنسبة الالتزام — والصمت هنا
         أصدق من رقمٍ يُحتسب على لا شيء */
      note: withEta === 0 ? 'لا مواعيد متوقَّعة مسجَّلة على أوامر هذا المورد' : null,
    };
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

    /* أمر شراء تجاوز موعده المتوقَّع ولم يصل: تأخيرٌ يُلاحَق مع المورد
       قبل أن يتحوّل إلى نفادٍ في الرفّ */
    const late = await this.prisma.purchaseOrder.findMany({
      where: {
        state: { in: ['CONFIRMED', 'PARTIALLY_RECEIVED'] },
        expectedAt: { lt: new Date() },
      },
      include: { supplier: true },
      take: 20,
    });
    for (const p of late) {
      out.push({
        code: 'PO_OVERDUE', ar: 'أمر شراء تجاوز موعده',
        detail: { poNo: p.poNo, supplier: p.supplier.name, expectedAt: p.expectedAt },
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

