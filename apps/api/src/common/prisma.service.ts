import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

/**
 * عميل قاعدة البيانات.
 *
 * المحرك الثنائي الأصلي لا يعمل داخل Cloudflare Worker، فالعميل يُبنى
 * على محوّل سائق (`@prisma/adapter-pg`) ومترجم استعلامات بلا Rust.
 * المخطَّط والاستعلامات والمحفِّزات كما هي حرفياً — التغيير في طريقة
 * الاتصال لا في لغة السؤال.
 *
 * `PrismaService` بقي اسماً للنوع حتى لا تتغيّر توقيعات عشرين وحدة
 * لأجل تبديل طبقة نقل.
 */
export type PrismaService = PrismaClient;

export function makePrisma(connectionString: string): PrismaClient {
  if (!connectionString) {
    throw new Error('DATABASE_URL غير مضبوط — لا إقلاع بلا قاعدة بيانات.');
  }
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}
