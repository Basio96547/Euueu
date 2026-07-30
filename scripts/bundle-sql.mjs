/**
 * حزم المخطَّط والبذرة نصّاً داخل الـWorker.
 *
 * لازمٌ لمسار التهيئة الذاتية: الـWorker يملك ربط القاعدة، فيستطيع أن
 * يهيّئها بنفسه حين لا يملك مفتاح النشر صلاحية D1. والتوليد هنا لا يدوياً
 * حتى لا ينحرف النصّ المحزوم عن الترحيل الذي يُطبَّق محلياً.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';

const migration = readFileSync('apps/api/migrations/0001_d1_init.sql', 'utf8');
const seed = execSync('node apps/api/prisma/seed-d1.mjs', { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });

mkdirSync('apps/api/src/generated', { recursive: true });
writeFileSync('apps/api/src/generated/bootstrap-sql.ts',
`/* مولَّد — لا يُحرَّر بيد. المصدر:
   apps/api/migrations/0001_d1_init.sql · apps/api/prisma/seed-d1.mjs
   التوليد: node scripts/bundle-sql.mjs */

export const MIGRATION_SQL = ${JSON.stringify(migration)};

export const SEED_SQL = ${JSON.stringify(seed)};
`);
console.log(`حُزم: مخطَّط ${(migration.length / 1024).toFixed(0)}ك · بذرة ${(seed.length / 1024).toFixed(0)}ك`);
