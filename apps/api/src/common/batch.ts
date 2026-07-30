import { ApiError, Errors } from './errors.js';
import type { PrismaService } from './prisma.service.js';

/**
 * تنفيذ دفعة كتابات ذرّية.
 *
 * D1 لا يدعم المعاملة التفاعلية (`$transaction(async tx => …)`): لا يمكن
 * القراءة داخل المعاملة ثم اتخاذ قرار ثم الكتابة. المدعوم هو الدفعة —
 * قائمة عمليات تُنفَّذ كلها أو لا تُنفَّذ.
 *
 * وهذا يغيّر مكان الحراسة لا وجودها. كان الحارس قراءةً داخل المعاملة،
 * وصار قيداً ومحفِّزاً في القاعدة نفسها: `reserved <= on_hand` وتطابق
 * وحدات الأجهزة مع العدّاد. القراءة قبل الدفعة تبقى — لكن لتعطي رسالة
 * مفهومة، لا لتكون الضمانة. الضمانة أن الدفعة ترتدّ كاملةً إن رفضت
 * القاعدة أيّ سطر منها.
 *
 * `onReject` يترجم رفض القاعدة إلى خطأ يفهمه الزبون: «الكمية غير متوفرة»
 * أوضح من نصّ محفِّز.
 */
export async function runBatch<T extends readonly unknown[]>(
  prisma: PrismaService,
  writes: T,
  onReject?: (message: string) => ApiError,
): Promise<void> {
  if (!writes.length) return;
  try {
    await prisma.$transaction(writes as any);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (isInvariantViolation(msg)) {
      throw onReject ? onReject(msg) : Errors.stockDrift(cleanup(msg));
    }
    throw e;
  }
}

/** رفضٌ من قيد أو محفِّز — لا عطلٌ في الشبكة ولا خطأ برمجي */
export function isInvariantViolation(message: string): boolean {
  return (
    message.includes('انحراف مخزون') ||
    message.includes('CHECK constraint failed') ||
    message.includes('SQLITE_CONSTRAINT') ||
    message.includes('constraint failed')
  );
}

const cleanup = (m: string) => m.split('\n')[0]!.replace(/^.*?(انحراف مخزون)/, '$1').slice(0, 200);
