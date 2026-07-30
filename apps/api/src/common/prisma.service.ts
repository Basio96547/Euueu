import { PrismaClient } from '@prisma/client';
import { PrismaD1 } from '@prisma/adapter-d1';

/**
 * عميل قاعدة البيانات — Cloudflare D1.
 *
 * لا رابط اتصال ولا منفذ ولا كلمة سرّ: D1 يصل عبر رابط في بيئة الـWorker
 * (`env.DB`). وهذا يعني أن القاعدة لا تُعرَّض للإنترنت أصلاً — لا سطح
 * هجوم ولا جدار ناري يُضبط ولا اتصالٌ يُعدّ.
 *
 * والثمن مدفوع في مكان آخر وموثَّق حيث يقع: لا معاملات تفاعلية (انظر
 * `common/batch.ts`)، ولا أنواع معدودة (قيود CHECK بدلها)، ولا محفِّزات
 * مؤجَّلة (الفحص عند ختم كل عملية مخزون).
 *
 * `PrismaService` بقي اسماً للنوع حتى لا تتغيّر توقيعات عشرين وحدة.
 */
export type PrismaService = PrismaClient;

/** الشكل الأدنى من ربط D1 — بلا استيراد أنواع Cloudflare في شيفرة مشتركة */
export interface D1Binding {
  prepare(query: string): unknown;
  batch(statements: unknown[]): Promise<unknown>;
  exec(query: string): Promise<unknown>;
}

export function makePrisma(db: D1Binding): PrismaClient {
  if (!db) {
    throw new Error('ربط قاعدة D1 غير موجود — لا إقلاع بلا قاعدة بيانات.');
  }
  return new PrismaClient({ adapter: new PrismaD1(db as never) });
}
