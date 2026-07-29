import { PrismaClient } from '@prisma/client';

/**
 * بوابة الإقلاع (الفصل 7 §7.10): فشل صريح عند التشغيل أرحم من متجر
 * يعرض بضاعة لا وجود لها ويستقبل عليها طلبات.
 */
export async function assertNoPublishedDemoInProd() {
  if (process.env.NODE_ENV !== 'production') return;
  if (process.env.DEMO_MODE === 'true') return;
  const prisma = new PrismaClient();
  try {
    const n = await prisma.product.count({ where: { isDemo: true, status: 'PUBLISHED' } });
    if (n > 0) {
      throw new Error(
        `الإقلاع مرفوض: ${n} منتجاً تجريبياً منشوراً في الإنتاج. ` +
        'حوّلها من لوحة التحكم أو شغّل pnpm db:purge-demo، أو فعّل DEMO_MODE صراحةً.',
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}
