-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('CUSTOMER', 'SUPPORT', 'CATALOG_ADMIN', 'OPS_MANAGER', 'WAREHOUSE', 'COURIER', 'ADMIN');

-- CreateEnum
CREATE TYPE "Governorate" AS ENUM ('DAMASCUS', 'RIF_DIMASHQ', 'ALEPPO', 'HOMS', 'HAMA', 'LATAKIA', 'TARTUS', 'IDLIB', 'DEIR_EZZOR', 'HASAKAH', 'RAQQA', 'DARAA', 'SUWAYDA', 'QUNEITRA');

-- CreateEnum
CREATE TYPE "DeviceOrigin" AS ENUM ('GULF', 'EURO', 'US', 'ASIA', 'OTHER');

-- CreateEnum
CREATE TYPE "ProductCondition" AS ENUM ('NEW', 'OPEN_BOX', 'REFURBISHED', 'USED_A', 'USED_B');

-- CreateEnum
CREATE TYPE "WarrantyType" AS ENUM ('STORE', 'AGENT', 'IMPORTER', 'NONE');

-- CreateEnum
CREATE TYPE "NetworkGen" AS ENUM ('G2', 'G3', 'G4', 'G5');

-- CreateEnum
CREATE TYPE "ProductStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "DeviceUnitState" AS ENUM ('IN_STOCK', 'ALLOCATED', 'SOLD', 'RETURNED', 'RMA', 'LOANER');

-- CreateEnum
CREATE TYPE "ReservationKind" AS ENUM ('SOFT_HOLD', 'ORDER_HOLD', 'ORDER_HOLD_EXT');

-- CreateEnum
CREATE TYPE "MovementReason" AS ENUM ('RECEIPT', 'RESERVE', 'RELEASE', 'SALE', 'RETURN', 'TRANSFER_IN', 'TRANSFER_OUT', 'ADJUSTMENT', 'RMA');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING_CONFIRMATION', 'PROCESSING', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'DELIVERY_FAILED', 'RETURNED_TO_ORIGIN', 'RETURN_REQUESTED', 'RETURNED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('COD');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'COLLECTED', 'PARTIAL', 'REFUNDED');

-- CreateEnum
CREATE TYPE "ShippingMethod" AS ENUM ('COURIER_INTRACITY', 'INTERCITY_OFFICE', 'POST');

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

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "public_id" CHAR(12) NOT NULL,
    "phone_e164" VARCHAR(16) NOT NULL,
    "phone_verified_at" TIMESTAMPTZ,
    "full_name" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'CUSTOMER',
    "locale" CHAR(2) NOT NULL DEFAULT 'ar',
    "display_currency" CHAR(3) NOT NULL DEFAULT 'SYP',
    "token_version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "addresses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "label" TEXT,
    "recipient_name" TEXT NOT NULL,
    "governorate" "Governorate" NOT NULL,
    "city" VARCHAR(64) NOT NULL,
    "neighborhood" VARCHAR(64) NOT NULL,
    "street" VARCHAR(96),
    "landmark" VARCHAR(120) NOT NULL,
    "details" TEXT,
    "phone" VARCHAR(16) NOT NULL,
    "alt_phone" VARCHAR(16),
    "geo_lat" DECIMAL(9,6),
    "geo_lng" DECIMAL(9,6),
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brands" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "slug" TEXT NOT NULL,
    "name" JSONB NOT NULL,
    "country_of_origin" CHAR(2),
    "is_featured" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "brands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "parent_id" UUID,
    "slug" TEXT NOT NULL,
    "name" JSONB NOT NULL,
    "path" TEXT NOT NULL,
    "depth" INTEGER NOT NULL DEFAULT 0,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "public_id" CHAR(12) NOT NULL,
    "slug" TEXT NOT NULL,
    "brand_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "name" JSONB NOT NULL,
    "short_desc" JSONB,
    "description" JSONB,
    "spec" JSONB,
    "status" "ProductStatus" NOT NULL DEFAULT 'DRAFT',
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "rating_avg" DECIMAL(2,1),
    "rating_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_variants" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "public_id" CHAR(12) NOT NULL,
    "product_id" UUID NOT NULL,
    "sku" VARCHAR(40) NOT NULL,
    "color_code" TEXT,
    "color_name" JSONB,
    "storage_gb" INTEGER,
    "ram_gb" INTEGER,
    "network_gen" "NetworkGen",
    "dual_sim" BOOLEAN NOT NULL DEFAULT false,
    "esim_only" BOOLEAN NOT NULL DEFAULT false,
    "part_code" VARCHAR(8),
    "condition" "ProductCondition" NOT NULL DEFAULT 'NEW',
    "battery_health_pct" INTEGER,
    "deviceOrigin" "DeviceOrigin" NOT NULL,
    "warrantyType" "WarrantyType" NOT NULL,
    "warranty_months" INTEGER NOT NULL,
    "price_usd_cents" BIGINT NOT NULL,
    "compare_at_price_usd_cents" BIGINT,
    "cost_price_usd_cents" BIGINT,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "product_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_compatibility" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "accessory_product_id" UUID NOT NULL,
    "phone_product_id" UUID NOT NULL,
    "note" JSONB,

    CONSTRAINT "product_compatibility_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "owner_type" TEXT NOT NULL,
    "owner_id" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "alt" JSONB,
    "color_code" TEXT,
    "blurhash" TEXT,
    "is_real_unit_photo" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warehouses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "name" JSONB NOT NULL,
    "governorate" "Governorate" NOT NULL,

    CONSTRAINT "warehouses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_levels" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "variant_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "on_hand" INTEGER NOT NULL DEFAULT 0,
    "reserved" INTEGER NOT NULL DEFAULT 0,
    "incoming" INTEGER NOT NULL DEFAULT 0,
    "reorder_point" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "inventory_levels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_reservations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "variant_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "kind" "ReservationKind" NOT NULL,
    "qty" INTEGER NOT NULL,
    "cart_id" UUID,
    "order_id" UUID,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_movements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "variant_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "reason" "MovementReason" NOT NULL,
    "qty_delta" INTEGER NOT NULL,
    "ref_type" TEXT,
    "ref_id" UUID,
    "actor_id" UUID,
    "note" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_units" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "variant_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "imei" TEXT,
    "imei2" TEXT,
    "serial" TEXT,
    "state" "DeviceUnitState" NOT NULL DEFAULT 'IN_STOCK',
    "grade" TEXT,
    "battery_health_pct" INTEGER,
    "imei_check_status" TEXT,
    "order_item_id" UUID,
    "warranty_type" "WarrantyType",
    "warranty_start_at" TIMESTAMPTZ,
    "warranty_end_at" TIMESTAMPTZ,
    "acquisition_cost_usd_cents" BIGINT,

    CONSTRAINT "device_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fx_rates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "base" CHAR(3) NOT NULL DEFAULT 'USD',
    "quote" CHAR(3) NOT NULL DEFAULT 'SYP',
    "rate" DECIMAL(14,4) NOT NULL,
    "effective_from" TIMESTAMPTZ NOT NULL,
    "valid_until" TIMESTAMPTZ NOT NULL,
    "safety_margin_bp" INTEGER NOT NULL DEFAULT 300,
    "set_by" UUID,
    "note" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fx_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "carts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "token" TEXT NOT NULL,
    "user_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "carts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cart_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "cart_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "qty" INTEGER NOT NULL DEFAULT 1,
    "unit_price_snapshot_usd_cents" BIGINT NOT NULL,

    CONSTRAINT "cart_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "public_id" CHAR(12) NOT NULL,
    "order_no" VARCHAR(14) NOT NULL,
    "user_id" UUID,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING_CONFIRMATION',
    "shipping_address_id" UUID NOT NULL,
    "subtotal_usd_cents" BIGINT NOT NULL,
    "discount_total_usd_cents" BIGINT NOT NULL DEFAULT 0,
    "shipping_total_usd_cents" BIGINT NOT NULL DEFAULT 0,
    "tax_rate_bp" INTEGER NOT NULL DEFAULT 0,
    "tax_amount_usd_cents" BIGINT NOT NULL DEFAULT 0,
    "total_usd_cents" BIGINT NOT NULL,
    "fx_rate_id" UUID,
    "fx_rate" DECIMAL(14,4) NOT NULL,
    "total_syp" BIGINT NOT NULL,
    "rounding_diff_syp" INTEGER NOT NULL DEFAULT 0,
    "fx_stale" BOOLEAN NOT NULL DEFAULT false,
    "price_locked_until" TIMESTAMPTZ NOT NULL,
    "payment_method" "PaymentMethod" NOT NULL DEFAULT 'COD',
    "payment_status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "collected_amount_syp" BIGINT,
    "collected_at" TIMESTAMPTZ,
    "collected_by" UUID,
    "confirmation_attempts" INTEGER NOT NULL DEFAULT 0,
    "confirmed_by" UUID,
    "confirmed_at" TIMESTAMPTZ,
    "confirmation_notes" TEXT,
    "collector_type" "CollectorType",
    "settlement_id" UUID,
    "delivered_at" TIMESTAMPTZ,
    "replacement_of" UUID,
    "coupon_code" VARCHAR(32),
    "placed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "order_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "qty" INTEGER NOT NULL DEFAULT 1,
    "unit_price_usd_cents" BIGINT NOT NULL,
    "line_total_usd_cents" BIGINT NOT NULL,
    "cogs_usd_cents" BIGINT,
    "name_snapshot" JSONB NOT NULL,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_status_history" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "order_id" UUID NOT NULL,
    "from_status" "OrderStatus",
    "to_status" "OrderStatus" NOT NULL,
    "actor_type" TEXT NOT NULL,
    "actor_id" UUID,
    "reason_code" TEXT,
    "source" TEXT NOT NULL DEFAULT 'SYSTEM',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipping_rates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "governorate" "Governorate" NOT NULL,
    "method" "ShippingMethod" NOT NULL,
    "base_fee_usd_cents" BIGINT NOT NULL,
    "per_kg_fee_usd_cents" BIGINT NOT NULL DEFAULT 0,
    "free_above_usd_cents" BIGINT,
    "eta_min_days" INTEGER NOT NULL,
    "eta_max_days" INTEGER NOT NULL,

    CONSTRAINT "shipping_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "store_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "actor_id" UUID,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID,
    "diff" JSONB,
    "ip" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

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
CREATE UNIQUE INDEX "users_public_id_key" ON "users"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_e164_key" ON "users"("phone_e164");

-- CreateIndex
CREATE INDEX "addresses_user_id_idx" ON "addresses"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "brands_slug_key" ON "brands"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "categories_slug_key" ON "categories"("slug");

-- CreateIndex
CREATE INDEX "categories_path_idx" ON "categories"("path");

-- CreateIndex
CREATE UNIQUE INDEX "products_public_id_key" ON "products"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "products_slug_key" ON "products"("slug");

-- CreateIndex
CREATE INDEX "products_status_is_demo_idx" ON "products"("status", "is_demo");

-- CreateIndex
CREATE UNIQUE INDEX "product_variants_public_id_key" ON "product_variants"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_variants_sku_key" ON "product_variants"("sku");

-- CreateIndex
CREATE INDEX "product_variants_product_id_idx" ON "product_variants"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_variants_product_id_storage_gb_ram_gb_color_code_de_key" ON "product_variants"("product_id", "storage_gb", "ram_gb", "color_code", "deviceOrigin", "part_code");

-- CreateIndex
CREATE INDEX "product_compatibility_phone_product_id_idx" ON "product_compatibility"("phone_product_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_compatibility_accessory_product_id_phone_product_id_key" ON "product_compatibility"("accessory_product_id", "phone_product_id");

-- CreateIndex
CREATE INDEX "media_owner_type_owner_id_idx" ON "media"("owner_type", "owner_id");

-- CreateIndex
CREATE UNIQUE INDEX "warehouses_code_key" ON "warehouses"("code");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_levels_variant_id_warehouse_id_key" ON "inventory_levels"("variant_id", "warehouse_id");

-- CreateIndex
CREATE INDEX "inventory_reservations_expires_at_idx" ON "inventory_reservations"("expires_at");

-- CreateIndex
CREATE INDEX "inventory_reservations_order_id_idx" ON "inventory_reservations"("order_id");

-- CreateIndex
CREATE INDEX "inventory_movements_variant_id_created_at_idx" ON "inventory_movements"("variant_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "device_units_imei_key" ON "device_units"("imei");

-- CreateIndex
CREATE UNIQUE INDEX "device_units_order_item_id_key" ON "device_units"("order_item_id");

-- CreateIndex
CREATE INDEX "device_units_variant_id_state_idx" ON "device_units"("variant_id", "state");

-- CreateIndex
CREATE INDEX "fx_rates_effective_from_idx" ON "fx_rates"("effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "fx_rates_quote_effective_from_key" ON "fx_rates"("quote", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "carts_token_key" ON "carts"("token");

-- CreateIndex
CREATE UNIQUE INDEX "cart_items_cart_id_variant_id_key" ON "cart_items"("cart_id", "variant_id");

-- CreateIndex
CREATE UNIQUE INDEX "orders_public_id_key" ON "orders"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "orders_order_no_key" ON "orders"("order_no");

-- CreateIndex
CREATE INDEX "orders_status_placed_at_idx" ON "orders"("status", "placed_at");

-- CreateIndex
CREATE INDEX "order_items_order_id_idx" ON "order_items"("order_id");

-- CreateIndex
CREATE INDEX "order_status_history_order_id_created_at_idx" ON "order_status_history"("order_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "shipping_rates_governorate_method_key" ON "shipping_rates"("governorate", "method");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

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
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_compatibility" ADD CONSTRAINT "product_compatibility_accessory_product_id_fkey" FOREIGN KEY ("accessory_product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_compatibility" ADD CONSTRAINT "product_compatibility_phone_product_id_fkey" FOREIGN KEY ("phone_product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media" ADD CONSTRAINT "media_product_fk" FOREIGN KEY ("owner_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_levels" ADD CONSTRAINT "inventory_levels_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_levels" ADD CONSTRAINT "inventory_levels_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_units" ADD CONSTRAINT "device_units_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_units" ADD CONSTRAINT "device_units_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_units" ADD CONSTRAINT "device_units_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "carts" ADD CONSTRAINT "carts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_cart_id_fkey" FOREIGN KEY ("cart_id") REFERENCES "carts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_shipping_address_id_fkey" FOREIGN KEY ("shipping_address_id") REFERENCES "addresses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_fx_rate_id_fkey" FOREIGN KEY ("fx_rate_id") REFERENCES "fx_rates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_settlement_id_fkey" FOREIGN KEY ("settlement_id") REFERENCES "cash_settlements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

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


-- ══ القيود والمحفِّزات: جزء من الهجرة لا خطوة يدوية بعدها ══
-- قيود لا يعبّر عنها Prisma — تُطبَّق يدوياً بعد كل ترحيل
-- المرجع: الفصل 3

-- ——— صيغة رقم الطلب ———
ALTER TABLE orders
  ADD CONSTRAINT orders_order_no_format
  CHECK (order_no ~ '^TS-[0-9]{4}-[0-9]{6}$');

-- ——— المبالغ غير سالبة، والمبلغ النقدي مقرَّب لأقرب 1000 ———
ALTER TABLE orders ADD CONSTRAINT orders_total_nonneg CHECK (total_usd_cents >= 0);
ALTER TABLE orders ADD CONSTRAINT orders_cash_rounded CHECK (total_syp % 1000 = 0);
ALTER TABLE orders ADD CONSTRAINT orders_tax_bp_range CHECK (tax_rate_bp BETWEEN 0 AND 10000);
ALTER TABLE orders ADD CONSTRAINT orders_confirm_attempts CHECK (confirmation_attempts <= 3);
ALTER TABLE orders ADD CONSTRAINT orders_collected_requires_time
  CHECK (payment_status <> 'COLLECTED' OR collected_at IS NOT NULL);

-- ——— أرقام الجوال السورية ———
ALTER TABLE users ADD CONSTRAINT users_phone_sy CHECK (phone_e164 ~ '^\+9639[0-9]{8}$');
ALTER TABLE addresses ADD CONSTRAINT addresses_phone_sy CHECK (phone ~ '^\+9639[0-9]{8}$');
ALTER TABLE addresses ADD CONSTRAINT addresses_landmark_len CHECK (length(landmark) >= 3);

-- ——— فروق السوق على مستوى المتغيّر ———
ALTER TABLE product_variants ADD CONSTRAINT variants_price_nonneg CHECK (price_usd_cents >= 0);
ALTER TABLE product_variants ADD CONSTRAINT variants_sim_exclusive CHECK (NOT (dual_sim AND esim_only));
ALTER TABLE product_variants ADD CONSTRAINT variants_part_code_format
  CHECK (part_code IS NULL OR part_code ~ '^[A-Z]{2}/A$');
-- صحة البطارية إلزامية لغير الجديد
ALTER TABLE product_variants ADD CONSTRAINT variants_battery_required
  CHECK (condition = 'NEW' OR battery_health_pct BETWEEN 1 AND 100);
ALTER TABLE product_variants ADD CONSTRAINT variants_warranty_months CHECK (warranty_months >= 0);

-- ——— سعر الصرف: التقادم ليس حالة مسموحة ———
ALTER TABLE fx_rates ADD CONSTRAINT fx_rate_positive CHECK (rate > 0);
ALTER TABLE fx_rates ADD CONSTRAINT fx_valid_window CHECK (valid_until > effective_from);

-- ——— المخزون: المتاح لا يكون سالباً ———
ALTER TABLE inventory_levels ADD CONSTRAINT inv_nonneg CHECK (on_hand >= 0 AND reserved >= 0);
ALTER TABLE inventory_levels ADD CONSTRAINT inv_reserved_le_onhand CHECK (reserved <= on_hand);

-- ===========================================================
-- المحفِّز الحاسم: تطابق وحدات الأجهزة مع عدّاد المخزون
-- مؤجَّل إلى نهاية المعاملة، فتفشل المعاملة كلها عند الانحراف.
-- الاعتماد على مهمة أسبوعية يعني اكتشاف البيع الزائد بعد أسبوع.
-- ===========================================================

CREATE OR REPLACE FUNCTION assert_units_match_levels() RETURNS TRIGGER AS $$
DECLARE
  v_variant UUID;
  v_wh      UUID;
  v_units   INT;
  v_onhand  INT;
BEGIN
  v_variant := COALESCE(NEW.variant_id, OLD.variant_id);
  v_wh      := COALESCE(NEW.warehouse_id, OLD.warehouse_id);

  SELECT count(*) INTO v_units
    FROM device_units
   WHERE variant_id = v_variant AND warehouse_id = v_wh AND state = 'IN_STOCK';

  SELECT on_hand INTO v_onhand
    FROM inventory_levels
   WHERE variant_id = v_variant AND warehouse_id = v_wh;

  -- الملحقات لا صفوف لها في device_units، فيُتجاهل الفحص عند غياب أي وحدة
  IF v_onhand IS NOT NULL AND v_units > 0 AND v_units <> v_onhand THEN
    RAISE EXCEPTION
      'انحراف مخزون: % وحدة بحالة IN_STOCK مقابل on_hand = % للمتغيّر %',
      v_units, v_onhand, v_variant;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER trg_units_match_levels
  AFTER INSERT OR UPDATE OR DELETE ON device_units
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_units_match_levels();
