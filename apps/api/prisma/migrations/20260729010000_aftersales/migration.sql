-- CreateEnum
CREATE TYPE "CollectorType" AS ENUM ('COURIER', 'TRANSPORT_OFFICE');

-- CreateEnum
CREATE TYPE "SettlementState" AS ENUM ('OPEN', 'RECONCILED', 'DISPUTED', 'SETTLED');

-- CreateEnum
CREATE TYPE "ReturnState" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'PICKUP_SCHEDULED', 'RECEIVED', 'INSPECTED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ReturnReason" AS ENUM ('NOT_AS_DESCRIBED', 'DEFECTIVE', 'WRONG_ITEM', 'CHANGED_MIND', 'DAMAGED_IN_TRANSIT');

-- CreateEnum
CREATE TYPE "RefundState" AS ENUM ('PENDING', 'APPROVED', 'DISBURSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ClaimState" AS ENUM ('OPENED', 'PICKUP_SCHEDULED', 'RECEIVED', 'DIAGNOSING', 'APPROVED', 'REPAIRING', 'READY', 'CLOSED', 'REJECTED');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('NEW', 'OPEN', 'PENDING_CUSTOMER', 'ESCALATED', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "TicketPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "TicketChannel" AS ENUM ('WHATSAPP', 'PHONE', 'WEB', 'EMAIL', 'ADMIN');

-- CreateEnum
CREATE TYPE "ModerationStatus" AS ENUM ('PENDING', 'PUBLISHED', 'REJECTED', 'HIDDEN');

-- CreateEnum
CREATE TYPE "CouponType" AS ENUM ('PERCENTAGE', 'FIXED_AMOUNT', 'FREE_SHIPPING');

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "collector_type" "CollectorType",
ADD COLUMN     "coupon_code" VARCHAR(32),
ADD COLUMN     "delivered_at" TIMESTAMPTZ,
ADD COLUMN     "replacement_of" UUID,
ADD COLUMN     "settlement_id" UUID;

-- CreateTable
CREATE TABLE "cash_settlements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "collector_type" "CollectorType" NOT NULL,
    "collector_id" UUID NOT NULL,
    "settlement_date" DATE NOT NULL,
    "orders_count" INTEGER NOT NULL DEFAULT 0,
    "expected_amount_syp" BIGINT NOT NULL DEFAULT 0,
    "collected_amount_syp" BIGINT NOT NULL DEFAULT 0,
    "variance_syp" BIGINT NOT NULL DEFAULT 0,
    "rounding_diff_syp" INTEGER NOT NULL DEFAULT 0,
    "delivery_commission_syp" BIGINT NOT NULL DEFAULT 0,
    "state" "SettlementState" NOT NULL DEFAULT 'OPEN',
    "note" TEXT,
    "reconciled_by" UUID,
    "reconciled_at" TIMESTAMPTZ,
    "settled_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "cash_settlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "returns" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "return_no" VARCHAR(16) NOT NULL,
    "order_id" UUID NOT NULL,
    "order_item_id" UUID,
    "state" "ReturnState" NOT NULL DEFAULT 'REQUESTED',
    "reason" "ReturnReason" NOT NULL,
    "customer_note" TEXT,
    "imei_submitted" TEXT,
    "imei_checked" BOOLEAN NOT NULL DEFAULT false,
    "imei_matched" BOOLEAN,
    "inspection_note" TEXT,
    "reject_reason" TEXT,
    "restock" BOOLEAN NOT NULL DEFAULT false,
    "requested_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMPTZ,
    "received_at" TIMESTAMPTZ,
    "completed_at" TIMESTAMPTZ,
    "decided_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refunds" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "return_id" UUID NOT NULL,
    "amount_usd_cents" BIGINT NOT NULL,
    "fx_rate" DECIMAL(14,4) NOT NULL,
    "amount_syp" BIGINT NOT NULL,
    "rounding_diff_syp" INTEGER NOT NULL DEFAULT 0,
    "state" "RefundState" NOT NULL DEFAULT 'PENDING',
    "disbursed_by" UUID,
    "disbursed_at" TIMESTAMPTZ,
    "note" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warranty_claims" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "claim_no" VARCHAR(16) NOT NULL,
    "device_unit_id" UUID,
    "imei" TEXT,
    "phone" VARCHAR(16) NOT NULL,
    "description" TEXT NOT NULL,
    "state" "ClaimState" NOT NULL DEFAULT 'OPENED',
    "diagnosis" TEXT,
    "resolution" TEXT,
    "reject_reason" TEXT,
    "loaner_unit_id" UUID,
    "opened_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMPTZ,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "warranty_claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_tickets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ticket_no" VARCHAR(16) NOT NULL,
    "user_id" UUID,
    "phone" VARCHAR(16) NOT NULL,
    "order_id" UUID,
    "device_unit_id" UUID,
    "warranty_claim_id" UUID,
    "channel" "TicketChannel" NOT NULL DEFAULT 'WEB',
    "external_thread_id" TEXT,
    "subject" TEXT,
    "contact_reason" TEXT NOT NULL,
    "status" "TicketStatus" NOT NULL DEFAULT 'NEW',
    "priority" "TicketPriority" NOT NULL DEFAULT 'NORMAL',
    "assignee_id" UUID,
    "first_response_at" TIMESTAMPTZ,
    "resolved_at" TIMESTAMPTZ,
    "closed_at" TIMESTAMPTZ,
    "sla_first_response_due_at" TIMESTAMPTZ,
    "sla_resolution_due_at" TIMESTAMPTZ,
    "sla_breached" BOOLEAN NOT NULL DEFAULT false,
    "csat_score" INTEGER,
    "csat_comment" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ticket_id" UUID NOT NULL,
    "author_type" TEXT NOT NULL,
    "author_id" UUID,
    "body" TEXT NOT NULL,
    "is_internal_note" BOOLEAN NOT NULL DEFAULT false,
    "macro_id" UUID,
    "delivery_channel" "TicketChannel",
    "delivery_status" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_macros" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "title" JSONB NOT NULL,
    "body" JSONB NOT NULL,
    "variables" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "usage_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_macros_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reviews" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "product_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "order_item_id" UUID NOT NULL,
    "rating" INTEGER NOT NULL,
    "title" TEXT,
    "body" TEXT,
    "status" "ModerationStatus" NOT NULL DEFAULT 'PENDING',
    "reject_reason" TEXT,
    "flagged" BOOLEAN NOT NULL DEFAULT false,
    "helpful_count" INTEGER NOT NULL DEFAULT 0,
    "merchant_reply" TEXT,
    "merchant_reply_at" TIMESTAMPTZ,
    "moderated_by" UUID,
    "moderated_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_reports" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "review_id" UUID NOT NULL,
    "reporter_id" UUID,
    "reason" TEXT NOT NULL,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "resolved_by" UUID,
    "resolved_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_questions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "product_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "answer_body" TEXT,
    "answer_source" TEXT,
    "answered_by" UUID,
    "answered_at" TIMESTAMPTZ,
    "status" "ModerationStatus" NOT NULL DEFAULT 'PENDING',
    "reject_reason" TEXT,
    "helpful_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "product_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coupons" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(32) NOT NULL,
    "type" "CouponType" NOT NULL,
    "value" INTEGER NOT NULL,
    "max_discount_usd_cents" INTEGER,
    "min_subtotal_usd_cents" INTEGER NOT NULL DEFAULT 0,
    "category_slugs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "starts_at" TIMESTAMPTZ NOT NULL,
    "ends_at" TIMESTAMPTZ NOT NULL,
    "usage_limit_total" INTEGER,
    "usage_limit_per_customer" INTEGER NOT NULL DEFAULT 1,
    "first_order_only" BOOLEAN NOT NULL DEFAULT false,
    "stackable" BOOLEAN NOT NULL DEFAULT false,
    "used_count" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "coupons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coupon_redemptions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "coupon_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "phone" VARCHAR(16) NOT NULL,
    "discount_usd_cents" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coupon_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_alerts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "base_price_usd_cents" BIGINT NOT NULL,
    "threshold_bp" INTEGER NOT NULL DEFAULT 500,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_notified_at" TIMESTAMPTZ,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "price_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_alerts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID,
    "phone" VARCHAR(16) NOT NULL,
    "variant_id" UUID NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "notified_at" TIMESTAMPTZ,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cash_settlements_state_settlement_date_idx" ON "cash_settlements"("state", "settlement_date");

-- CreateIndex
CREATE UNIQUE INDEX "cash_settlements_collector_type_collector_id_settlement_dat_key" ON "cash_settlements"("collector_type", "collector_id", "settlement_date");

-- CreateIndex
CREATE UNIQUE INDEX "returns_return_no_key" ON "returns"("return_no");

-- CreateIndex
CREATE INDEX "returns_state_requested_at_idx" ON "returns"("state", "requested_at");

-- CreateIndex
CREATE INDEX "returns_order_id_idx" ON "returns"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "refunds_return_id_key" ON "refunds"("return_id");

-- CreateIndex
CREATE INDEX "refunds_state_idx" ON "refunds"("state");

-- CreateIndex
CREATE UNIQUE INDEX "warranty_claims_claim_no_key" ON "warranty_claims"("claim_no");

-- CreateIndex
CREATE INDEX "warranty_claims_state_opened_at_idx" ON "warranty_claims"("state", "opened_at");

-- CreateIndex
CREATE INDEX "warranty_claims_phone_idx" ON "warranty_claims"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "support_tickets_ticket_no_key" ON "support_tickets"("ticket_no");

-- CreateIndex
CREATE INDEX "support_tickets_status_priority_created_at_idx" ON "support_tickets"("status", "priority", "created_at");

-- CreateIndex
CREATE INDEX "support_tickets_phone_idx" ON "support_tickets"("phone");

-- CreateIndex
CREATE INDEX "support_tickets_order_id_idx" ON "support_tickets"("order_id");

-- CreateIndex
CREATE INDEX "ticket_messages_ticket_id_created_at_idx" ON "ticket_messages"("ticket_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_macros_code_key" ON "ticket_macros"("code");

-- CreateIndex
CREATE UNIQUE INDEX "reviews_order_item_id_key" ON "reviews"("order_item_id");

-- CreateIndex
CREATE INDEX "reviews_product_id_status_idx" ON "reviews"("product_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "review_reports_review_id_reporter_id_key" ON "review_reports"("review_id", "reporter_id");

-- CreateIndex
CREATE INDEX "product_questions_product_id_status_idx" ON "product_questions"("product_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "coupons_code_key" ON "coupons"("code");

-- CreateIndex
CREATE INDEX "coupons_is_active_ends_at_idx" ON "coupons"("is_active", "ends_at");

-- CreateIndex
CREATE UNIQUE INDEX "coupon_redemptions_order_id_key" ON "coupon_redemptions"("order_id");

-- CreateIndex
CREATE INDEX "coupon_redemptions_coupon_id_phone_idx" ON "coupon_redemptions"("coupon_id", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "price_alerts_user_id_variant_id_key" ON "price_alerts"("user_id", "variant_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_alerts_phone_variant_id_key" ON "stock_alerts"("phone", "variant_id");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_settlement_id_fkey" FOREIGN KEY ("settlement_id") REFERENCES "cash_settlements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_settlements" ADD CONSTRAINT "cash_settlements_collector_id_fkey" FOREIGN KEY ("collector_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "returns" ADD CONSTRAINT "returns_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_return_id_fkey" FOREIGN KEY ("return_id") REFERENCES "returns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warranty_claims" ADD CONSTRAINT "warranty_claims_device_unit_id_fkey" FOREIGN KEY ("device_unit_id") REFERENCES "device_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_warranty_claim_id_fkey" FOREIGN KEY ("warranty_claim_id") REFERENCES "warranty_claims"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "support_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_macro_id_fkey" FOREIGN KEY ("macro_id") REFERENCES "ticket_macros"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_reports" ADD CONSTRAINT "review_reports_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "reviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_questions" ADD CONSTRAINT "product_questions_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_questions" ADD CONSTRAINT "product_questions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_coupon_id_fkey" FOREIGN KEY ("coupon_id") REFERENCES "coupons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_alerts" ADD CONSTRAINT "price_alerts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_alerts" ADD CONSTRAINT "price_alerts_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_alerts" ADD CONSTRAINT "stock_alerts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_alerts" ADD CONSTRAINT "stock_alerts_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

