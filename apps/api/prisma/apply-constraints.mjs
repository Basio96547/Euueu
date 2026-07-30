/**
 * حقن القيود في ترحيل D1.
 *
 * SQLite لا يقبل `ALTER TABLE ... ADD CONSTRAINT`، فالقيد يجب أن يولد مع
 * الجدول. وPrisma لا يعبّر عن CHECK. فبدل صيانة ملف SQL يدوي يتخلّف عن
 * المخطَّط، تُحقن القيود في الترحيل المولَّد بخطوة واحدة صريحة.
 *
 * مصدر قيود الأنواع المعدودة هو `prisma/enums.json` المولَّد وقت النقل من
 * PostgreSQL — فالقيمة التي كانت ترفضها القاعدة هناك ترفضها هنا.
 *
 *   node prisma/apply-constraints.mjs prisma/migrations/<dir>/migration.sql
 */
import { readFileSync, writeFileSync } from 'node:fs';

const target = process.argv[2];
if (!target) {
  console.error('الاستعمال: node prisma/apply-constraints.mjs <migration.sql>');
  process.exit(1);
}

const { fields } = JSON.parse(readFileSync(new URL('./enums.json', import.meta.url), 'utf8'));
const { enums } = JSON.parse(readFileSync(new URL('./enums.json', import.meta.url), 'utf8'));

/** اسم الجدول من اسم النموذج: Prisma يكتبه في @@map، ونقرؤه من الترحيل */
const sql = readFileSync(target, 'utf8');
const tables = [...sql.matchAll(/CREATE TABLE "([a-z_]+)" \(/g)].map((m) => m[1]);

/** ربط النموذج بجدوله عبر التطابق النصّي: users ← User, order_items ← OrderItem */
const snake = (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
const plural = (s) => (s.endsWith('s') ? s : s.endsWith('y') ? `${s.slice(0, -1)}ies` : `${s}s`);
const tableOf = (model) => {
  const guesses = [plural(snake(model)), snake(model)];
  return guesses.find((g) => tables.includes(g)) ?? null;
};

/* ——— قيود الأنواع المعدودة ——— */
const byTable = new Map();
const add = (table, check) => {
  if (!table) return;
  if (!byTable.has(table)) byTable.set(table, []);
  byTable.get(table).push(check);
};

for (const [model, column, enumName] of fields) {
  const table = tableOf(model);
  const values = enums[enumName];
  if (!table || !values?.length) continue;
  const list = values.map((v) => `'${v}'`).join(', ');
  add(table, `CHECK ("${column}" IN (${list}))`);
}

/* ——— القيود المكتوبة في الفصل 3 — نصّها في prisma/sql/constraints.sql ——— */
const MANUAL = {
  orders: [
    /* صيغة رقم الطلب TS-YYMM-NNNNNN.
       النمط الكامل بأصنافه العشرة يرفضه D1 بـ«LIKE or GLOB pattern too
       complex»، فالفحص بنيوي مكافئ: طول ثابت، وحرفان فاصلان في موضعيهما،
       وصنفٌ واحد منفيّ يقول «لا حرف غير رقمي هنا». */
    `CHECK (length("order_no") = 14
            AND substr("order_no", 1, 3) = 'TS-'
            AND substr("order_no", 8, 1) = '-'
            AND substr("order_no", 4, 4) NOT GLOB '*[^0-9]*'
            AND substr("order_no", 9, 6) NOT GLOB '*[^0-9]*')`,
    'CHECK ("total_usd_cents" >= 0)',
    /* عشرة لا ألف: حُذف صفران من الليرة في 2026-01-01 */
    'CHECK ("total_syp" % 10 = 0)',
    'CHECK ("tax_rate_bp" BETWEEN 0 AND 10000)',
    'CHECK ("confirmation_attempts" <= 3)',
    `CHECK ("payment_status" <> 'COLLECTED' OR "collected_at" IS NOT NULL)`,
  ],
  users: [
    `CHECK (length("phone_e164") = 13
            AND substr("phone_e164", 1, 5) = '+9639'
            AND substr("phone_e164", 6) NOT GLOB '*[^0-9]*')`,
  ],
  addresses: [
    `CHECK (length("phone") = 13
            AND substr("phone", 1, 5) = '+9639'
            AND substr("phone", 6) NOT GLOB '*[^0-9]*')`,
    'CHECK (length("landmark") >= 3)',
  ],
  product_variants: [
    'CHECK ("price_usd_cents" >= 0)',
    'CHECK (NOT ("dual_sim" AND "esim_only"))',
    `CHECK ("part_code" IS NULL
            OR (length("part_code") = 4
                AND substr("part_code", 3, 2) = '/A'
                AND substr("part_code", 1, 2) NOT GLOB '*[^A-Z]*'))`,
    `CHECK ("condition" = 'NEW' OR ("battery_health_pct" BETWEEN 1 AND 100))`,
    'CHECK ("warranty_months" >= 0)',
  ],
  fx_rates: ['CHECK ("rate" > 0)', 'CHECK ("valid_until" > "effective_from")'],
  inventory_levels: [
    'CHECK ("on_hand" >= 0 AND "reserved" >= 0)',
    'CHECK ("reserved" <= "on_hand")',
  ],
};
for (const [table, checks] of Object.entries(MANUAL)) for (const c of checks) add(table, c);

/* ——— الحقن: قبل القوس الختامي لكل CREATE TABLE ——— */
let out = sql;
let injected = 0;
for (const [table, checks] of byTable) {
  const re = new RegExp(`(CREATE TABLE "${table}" \\([\\s\\S]*?)\\n\\);`);
  const m = out.match(re);
  if (!m) { console.warn(`تحذير: لا جدول باسم ${table} في الترحيل`); continue; }
  const body = m[1].replace(/,\s*$/, '');
  out = out.replace(re, `${body},\n    ${checks.join(',\n    ')}\n);`);
  injected += checks.length;
}

/* ——— JSONB DEFAULT {} يولّده Prisma بلا اقتباس فترفضه SQLite ——— */
out = out.replace(/DEFAULT \{\}/g, `DEFAULT '{}'`);
out = out.replace(/DEFAULT \[\]/g, `DEFAULT '[]'`);

/* ——— المحفِّزات ——— */
const triggers = readFileSync(new URL('./sql/constraints.sql', import.meta.url), 'utf8')
  .split('-- ===========================================================')
  .filter((chunk) => chunk.includes('CREATE TRIGGER'))
  .join('\n');

out += `\n\n-- ——————————— المحفِّزات (prisma/sql/constraints.sql) ———————————\n${triggers}\n`;

writeFileSync(target, out);
console.log(`حُقن ${injected} قيداً في ${byTable.size} جدولاً، ومحفِّزات تطابق المخزون.`);
