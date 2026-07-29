-- CreateEnum
CREATE TYPE "PurchaseOrderState" AS ENUM ('DRAFT', 'CONFIRMED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DeletionRequestState" AS ENUM ('PENDING', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ReadinessCategory" AS ENUM ('TECH', 'CONTENT', 'OPS', 'LEGAL', 'FINANCE');

-- CreateEnum
CREATE TYPE "ReadinessStatus" AS ENUM ('PENDING', 'PASSED', 'FAILED', 'WAIVED');

-- CreateEnum
CREATE TYPE "RoutineCadence" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "RoutineRunStatus" AS ENUM ('DONE', 'SKIPPED', 'FAILED');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "notify_prefs" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "suppliers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(24) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "contact_name" VARCHAR(96),
    "contact_phone" VARCHAR(16),
    "country" CHAR(2),
    "lead_time_days" INTEGER NOT NULL DEFAULT 14,
    "notes" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_orders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "po_no" VARCHAR(16) NOT NULL,
    "supplier_id" UUID NOT NULL,
    "state" "PurchaseOrderState" NOT NULL DEFAULT 'CONFIRMED',
    "goods_usd_cents" BIGINT NOT NULL,
    "extra_usd_cents" BIGINT NOT NULL DEFAULT 0,
    "total_usd_cents" BIGINT NOT NULL,
    "landed_factor_ppm" INTEGER NOT NULL DEFAULT 0,
    "expected_at" TIMESTAMPTZ,
    "received_at" TIMESTAMPTZ,
    "created_by_id" UUID,
    "note" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "po_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "qty" INTEGER NOT NULL,
    "qty_received" INTEGER NOT NULL DEFAULT 0,
    "unit_cost_usd_cents" BIGINT NOT NULL,
    "landed_unit_cost_usd_cents" BIGINT NOT NULL,

    CONSTRAINT "purchase_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wishlist_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wishlist_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "user_agent" VARCHAR(200),
    "ip" VARCHAR(45),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_deletion_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "state" "DeletionRequestState" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "requested_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "due_at" TIMESTAMPTZ NOT NULL,
    "completed_at" TIMESTAMPTZ,
    "note" TEXT,

    CONSTRAINT "account_deletion_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "readiness_checks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(48) NOT NULL,
    "category" "ReadinessCategory" NOT NULL,
    "title" JSONB NOT NULL,
    "is_blocking" BOOLEAN NOT NULL DEFAULT true,
    "owner_role" VARCHAR(32) NOT NULL,
    "evidence_url" TEXT,
    "status" "ReadinessStatus" NOT NULL DEFAULT 'PENDING',
    "checked_by_id" UUID,
    "checked_at" TIMESTAMPTZ,
    "waiver_reason" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "readiness_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ops_routine_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "routine_code" VARCHAR(48) NOT NULL,
    "cadence" "RoutineCadence" NOT NULL,
    "period_key" VARCHAR(12) NOT NULL,
    "performed_by_id" UUID,
    "is_automated" BOOLEAN NOT NULL DEFAULT false,
    "status" "RoutineRunStatus" NOT NULL DEFAULT 'DONE',
    "notes" TEXT,
    "completed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ops_routine_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_code_key" ON "suppliers"("code");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_po_no_key" ON "purchase_orders"("po_no");

-- CreateIndex
CREATE INDEX "purchase_orders_state_created_at_idx" ON "purchase_orders"("state", "created_at");

-- CreateIndex
CREATE INDEX "purchase_order_lines_variant_id_idx" ON "purchase_order_lines"("variant_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_order_lines_po_id_variant_id_key" ON "purchase_order_lines"("po_id", "variant_id");

-- CreateIndex
CREATE INDEX "wishlist_items_user_id_idx" ON "wishlist_items"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "wishlist_items_user_id_variant_id_key" ON "wishlist_items"("user_id", "variant_id");

-- CreateIndex
CREATE INDEX "sessions_user_id_revoked_at_idx" ON "sessions"("user_id", "revoked_at");

-- CreateIndex
CREATE INDEX "account_deletion_requests_state_due_at_idx" ON "account_deletion_requests"("state", "due_at");

-- CreateIndex
CREATE UNIQUE INDEX "readiness_checks_code_key" ON "readiness_checks"("code");

-- CreateIndex
CREATE INDEX "readiness_checks_category_sort_order_idx" ON "readiness_checks"("category", "sort_order");

-- CreateIndex
CREATE INDEX "ops_routine_runs_cadence_period_key_idx" ON "ops_routine_runs"("cadence", "period_key");

-- CreateIndex
CREATE UNIQUE INDEX "ops_routine_runs_routine_code_period_key_key" ON "ops_routine_runs"("routine_code", "period_key");

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_po_id_fkey" FOREIGN KEY ("po_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wishlist_items" ADD CONSTRAINT "wishlist_items_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wishlist_items" ADD CONSTRAINT "wishlist_items_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_deletion_requests" ADD CONSTRAINT "account_deletion_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "readiness_checks" ADD CONSTRAINT "readiness_checks_checked_by_id_fkey" FOREIGN KEY ("checked_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ops_routine_runs" ADD CONSTRAINT "ops_routine_runs_performed_by_id_fkey" FOREIGN KEY ("performed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

