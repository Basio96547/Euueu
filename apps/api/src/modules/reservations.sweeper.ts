import { PrismaService } from '../common/prisma.service.js';
import { runBatch } from '../common/batch.js';

/**
 * كنّاس الحجوزات المنتهية.
 *
 * كل حجز يرفع reserved في inventory_levels، والمتاح = on_hand − reserved.
 * الحجز المرن يموت بعد ربع ساعة والحجز الأوّلي بعد ساعتين — لكن الموت
 * تاريخٌ في صف، لا حدثٌ يقع من تلقائه. بلا كنّاس تبقى كل سلّة مهجورة
 * ماسكةً بضاعتها إلى الأبد: يتآكل المتاح صامتاً حتى يقول المتجر «نفدت
 * الكمية» وفي المستودع بضاعة لم تُبع. لذلك التحرير عملية دورية صريحة.
 *
 * كل حجز يُحرَّر في معاملة واحدة مع خصمه من العدّاد وسطر في دفتر الحركات،
 * فلا تُخصم كمية بلا أثر ولا يُكتب أثر بلا خصم.
 */
export class ReservationSweeper {
  private running = false;

  /* يُستدعى من مهمة Worker المجدوَلة كل دقيقة، ومن اللوحة يدوياً.
     كان مؤقّتاً داخل العملية، ولا عملية دائمة في Worker تحمله. */
  private readonly batch = 200;

  constructor(private prisma: PrismaService) {}

  /** يُستدعى دورياً ومن لوحة التحكم يدوياً */
  async sweep(now = new Date()) {
    if (this.running) return { released: 0, qty: 0, skipped: 'busy' as const };
    this.running = true;
    try {
      let released = 0;
      let qty = 0;

      // على دفعات: انقطاع طويل قد يخلّف آلاف الحجوزات، ومعاملة واحدة ضخمة تقفل الجداول
      for (;;) {
        const due = await this.prisma.inventoryReservation.findMany({
          where: { expiresAt: { lte: now } },
          orderBy: { expiresAt: 'asc' },
          take: this.batch,
        });
        if (!due.length) break;

        for (const r of due) {
          /* الحذف أولاً وبشرط: لو سبقنا إليه كنّاس آخر لم نخصم مرتين.
             والدفعة ذرّية: يُحذف الصف ويُخصم العدّاد ويُكتب الأثر معاً
             أو لا يقع شيء. و`max(0, …)` يمنع عدّاداً سالباً لو تسرّب
             خصم مزدوج من مسار آخر. */
          const gone = await this.prisma.inventoryReservation.deleteMany({ where: { id: r.id } });
          if (gone.count === 0) continue;

          await runBatch(this.prisma, [
            this.prisma.$executeRaw`
              UPDATE inventory_levels
                 SET reserved = max(0, reserved - ${r.qty}),
                     version  = version + 1
               WHERE variant_id = ${r.variantId}
                 AND warehouse_id = ${r.warehouseId}`,
            this.prisma.inventoryMovement.create({
              data: {
                variantId: r.variantId, warehouseId: r.warehouseId,
                reason: 'RELEASE', qtyDelta: r.qty,
                refType: r.orderId ? 'order' : 'cart',
                refId: r.orderId ?? r.cartId ?? null,
                note: `تحرير تلقائي: انتهى ${r.kind} في ${r.expiresAt.toISOString()}`,
              },
            }),
          ]);

          released++;
          qty += r.qty;
        }

        if (due.length < this.batch) break;
      }

      if (released) {
        console.log(`كنّاس الحجوزات: حُرّر ${released} حجزاً (${qty} قطعة)`);
      }
      return { released, qty };
    } finally {
      this.running = false;
    }
  }
}
