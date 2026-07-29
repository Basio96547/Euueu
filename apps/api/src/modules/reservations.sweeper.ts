import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service.js';

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
@Injectable()
export class ReservationSweeper implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  /** كل دقيقة: أدقّ بكثير من أقصر مهلة (خمس عشرة دقيقة) وأرخص من كل طلب */
  private readonly intervalMs = Number(process.env.SWEEP_INTERVAL_MS ?? 60_000);
  private readonly batch = 200;

  constructor(@Inject(PrismaService) private prisma: PrismaService) {}

  onModuleInit() {
    if (process.env.SWEEP_DISABLED === '1') return;
    this.timer = setInterval(() => { void this.sweep(); }, this.intervalMs);
    this.timer.unref?.();                     // لا يمنع الخروج النظيف
    void this.sweep();                        // مرة عند الإقلاع: قد يكون الخادم غاب طويلاً
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

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
          await this.prisma.$transaction(async (tx) => {
            // الحذف أولاً وبشرط: لو سبقنا إليه كنّاس آخر لم نخصم مرتين
            const gone = await tx.inventoryReservation.deleteMany({ where: { id: r.id } });
            if (gone.count === 0) return;

            // GREATEST يمنع عدّاداً سالباً لو تسرّب خصم مزدوج من مسار آخر
            await tx.$executeRaw`
              UPDATE inventory_levels
                 SET reserved = GREATEST(0, reserved - ${r.qty}),
                     version  = version + 1
               WHERE variant_id = ${r.variantId}::uuid
                 AND warehouse_id = ${r.warehouseId}::uuid`;

            await tx.inventoryMovement.create({
              data: {
                variantId: r.variantId, warehouseId: r.warehouseId,
                reason: 'RELEASE', qtyDelta: r.qty,
                refType: r.orderId ? 'order' : 'cart',
                refId: r.orderId ?? r.cartId ?? null,
                note: `تحرير تلقائي: انتهى ${r.kind} في ${r.expiresAt.toISOString()}`,
              },
            });

            released++;
            qty += r.qty;
          });
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
