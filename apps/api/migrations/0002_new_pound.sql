-- ═══════════════════════════════════════════════════════════════
-- الليرة السورية الجديدة
--
-- في 2026-01-01 حُذف صفران من العملة: كل مئة ليرة قديمة صارت ليرةً
-- جديدة واحدة، وأصغر ورقةٍ متداولة عشرُ ليرات. فوحدةُ التقريب النقدي
-- التي كانت ألفاً صارت عشرة — وهي الوحدة نفسها بالضبط، لا وحدةٌ أدقّ:
-- ألفُ القديمة هي عشرةُ الجديدة.
--
-- والقيد "total_syp % 1000 = 0" لم يكن تجميلاً: كان يمنع تخزين مبلغٍ
-- غير مقرَّب. وبعد حذف الصفرين صار هو نفسه يرفض كل مبلغٍ صحيح — أي
-- أن أول طلبٍ حقيقي كان سيفشل بخطأ قيدٍ غامض. فيُستبدل لا يُحذف.
--
-- SQLite لا يعدّل قيداً في مكانه، فتُبنى الجدولة من جديد. وهذا آمنٌ
-- هنا لأن الجدول فارغ (صفر طلبات، صفر تسويات، صفر مردودات) — وقد
-- تُحقّق من ذلك قبل كتابة هذا الملف.
-- ═══════════════════════════════════════════════════════════════

PRAGMA foreign_keys = OFF;

CREATE TABLE "orders_new" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "public_id" TEXT NOT NULL,
    "order_no" TEXT NOT NULL,
    "user_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING_CONFIRMATION',
    "shipping_address_id" TEXT NOT NULL,
    "subtotal_usd_cents" BIGINT NOT NULL,
    "discount_total_usd_cents" BIGINT NOT NULL DEFAULT 0,
    "shipping_total_usd_cents" BIGINT NOT NULL DEFAULT 0,
    "tax_rate_bp" INTEGER NOT NULL DEFAULT 0,
    "tax_amount_usd_cents" BIGINT NOT NULL DEFAULT 0,
    "total_usd_cents" BIGINT NOT NULL,
    "fx_rate_id" TEXT,
    "fx_rate" DECIMAL NOT NULL,
    "total_syp" BIGINT NOT NULL,
    "rounding_diff_syp" INTEGER NOT NULL DEFAULT 0,
    "fx_stale" BOOLEAN NOT NULL DEFAULT false,
    "price_locked_until" DATETIME NOT NULL,
    "payment_method" TEXT NOT NULL DEFAULT 'COD',
    "payment_status" TEXT NOT NULL DEFAULT 'PENDING',
    "collected_amount_syp" BIGINT,
    "collected_at" DATETIME,
    "collected_by" TEXT,
    "confirmation_attempts" INTEGER NOT NULL DEFAULT 0,
    "confirmed_by" TEXT,
    "confirmed_at" DATETIME,
    "confirmation_notes" TEXT,
    "collector_type" TEXT,
    "settlement_id" TEXT,
    "delivered_at" DATETIME,
    "replacement_of" TEXT,
    "coupon_code" TEXT,
    "placed_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "orders_shipping_address_id_fkey" FOREIGN KEY ("shipping_address_id") REFERENCES "addresses" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "orders_fx_rate_id_fkey" FOREIGN KEY ("fx_rate_id") REFERENCES "fx_rates" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "orders_settlement_id_fkey" FOREIGN KEY ("settlement_id") REFERENCES "cash_settlements" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CHECK ("status" IN ('PENDING_CONFIRMATION', 'PROCESSING', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'DELIVERY_FAILED', 'RETURNED_TO_ORIGIN', 'RETURN_REQUESTED', 'RETURNED', 'CANCELLED')),
    CHECK ("payment_method" IN ('COD')),
    CHECK ("payment_status" IN ('PENDING', 'COLLECTED', 'PARTIAL', 'REFUNDED')),
    CHECK ("collector_type" IN ('COURIER', 'TRANSPORT_OFFICE')),
    CHECK (length("order_no") = 14
            AND substr("order_no", 1, 3) = 'TS-'
            AND substr("order_no", 8, 1) = '-'
            AND substr("order_no", 4, 4) NOT GLOB '*[^0-9]*'
            AND substr("order_no", 9, 6) NOT GLOB '*[^0-9]*'),
    CHECK ("total_usd_cents" >= 0),
    CHECK ("total_syp" % 10 = 0),
    CHECK ("tax_rate_bp" BETWEEN 0 AND 10000),
    CHECK ("confirmation_attempts" <= 3),
    CHECK ("payment_status" <> 'COLLECTED' OR "collected_at" IS NOT NULL)
);

INSERT INTO "orders_new" SELECT * FROM "orders";
DROP TABLE "orders";
ALTER TABLE "orders_new" RENAME TO "orders";

CREATE UNIQUE INDEX "orders_public_id_key" ON "orders"("public_id");
CREATE UNIQUE INDEX "orders_order_no_key" ON "orders"("order_no");
CREATE INDEX "orders_status_placed_at_idx" ON "orders"("status", "placed_at");

PRAGMA foreign_keys = ON;

-- سعر الصرف المخزَّن بالقديمة يُحوَّل بقسمته على مئة. وهو سعرٌ تجريبي
-- في كلتا الحالتين: السعر الحقيقي يُضبط من اللوحة ويُسجَّل باسم من ضبطه.
UPDATE "fx_rates" SET "rate" = ROUND("rate" / 100.0, 2) WHERE "rate" > 5000;
