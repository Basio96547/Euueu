-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "public_id" TEXT NOT NULL,
    "phone_e164" TEXT NOT NULL,
    "phone_verified_at" DATETIME,
    "full_name" TEXT,
    "role" TEXT NOT NULL DEFAULT 'CUSTOMER',
    "locale" TEXT NOT NULL DEFAULT 'ar',
    "display_currency" TEXT NOT NULL DEFAULT 'SYP',
    "token_version" INTEGER NOT NULL DEFAULT 0,
    "password_hash" TEXT,
    "password_set_at" DATETIME,
    "failed_logins" INTEGER NOT NULL DEFAULT 0,
    "locked_until" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "deleted_at" DATETIME,
    "notify_prefs" JSONB NOT NULL DEFAULT '{}',
    CHECK ("role" IN ('CUSTOMER', 'SUPPORT', 'CATALOG_ADMIN', 'OPS_MANAGER', 'WAREHOUSE', 'COURIER', 'ADMIN')),
    CHECK (length("phone_e164") = 13
            AND substr("phone_e164", 1, 5) = '+9639'
            AND substr("phone_e164", 6) NOT GLOB '*[^0-9]*')
);

-- CreateTable
CREATE TABLE "addresses" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "label" TEXT,
    "recipient_name" TEXT NOT NULL,
    "governorate" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "neighborhood" TEXT NOT NULL,
    "street" TEXT,
    "landmark" TEXT NOT NULL,
    "details" TEXT,
    "phone" TEXT NOT NULL,
    "alt_phone" TEXT,
    "geo_lat" DECIMAL,
    "geo_lng" DECIMAL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" DATETIME,
    CONSTRAINT "addresses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CHECK (length("phone") = 13
            AND substr("phone", 1, 5) = '+9639'
            AND substr("phone", 6) NOT GLOB '*[^0-9]*'),
    CHECK (length("landmark") >= 3)
);

-- CreateTable
CREATE TABLE "brands" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slug" TEXT NOT NULL,
    "name" JSONB NOT NULL,
    "country_of_origin" TEXT,
    "is_featured" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0
);

-- CreateTable
CREATE TABLE "categories" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "parent_id" TEXT,
    "slug" TEXT NOT NULL,
    "name" JSONB NOT NULL,
    "path" TEXT NOT NULL,
    "depth" INTEGER NOT NULL DEFAULT 0,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "categories" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "public_id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "brand_id" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,
    "name" JSONB NOT NULL,
    "short_desc" JSONB,
    "description" JSONB,
    "spec" JSONB,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "rating_avg" DECIMAL,
    "rating_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "deleted_at" DATETIME,
    CONSTRAINT "products_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CHECK ("status" IN ('DRAFT', 'IN_REVIEW', 'PUBLISHED', 'ARCHIVED'))
);

-- CreateTable
CREATE TABLE "product_variants" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "public_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "color_code" TEXT,
    "color_name" JSONB,
    "storage_gb" INTEGER,
    "ram_gb" INTEGER,
    "network_gen" TEXT,
    "dual_sim" BOOLEAN NOT NULL DEFAULT false,
    "esim_only" BOOLEAN NOT NULL DEFAULT false,
    "part_code" TEXT,
    "condition" TEXT NOT NULL DEFAULT 'NEW',
    "battery_health_pct" INTEGER,
    "deviceOrigin" TEXT NOT NULL,
    "warrantyType" TEXT NOT NULL,
    "warranty_months" INTEGER NOT NULL,
    "price_usd_cents" BIGINT NOT NULL,
    "compare_at_price_usd_cents" BIGINT,
    "cost_price_usd_cents" BIGINT,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" DATETIME,
    CONSTRAINT "product_variants_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CHECK ("network_gen" IN ('G2', 'G3', 'G4', 'G5')),
    CHECK ("condition" IN ('NEW', 'OPEN_BOX', 'REFURBISHED', 'USED_A', 'USED_B')),
    CHECK ("deviceOrigin" IN ('GULF', 'EURO', 'US', 'ASIA', 'OTHER')),
    CHECK ("warrantyType" IN ('STORE', 'AGENT', 'IMPORTER', 'NONE')),
    CHECK ("price_usd_cents" >= 0),
    CHECK (NOT ("dual_sim" AND "esim_only")),
    CHECK ("part_code" IS NULL
            OR (length("part_code") = 4
                AND substr("part_code", 3, 2) = '/A'
                AND substr("part_code", 1, 2) NOT GLOB '*[^A-Z]*')),
    CHECK ("condition" = 'NEW' OR ("battery_health_pct" BETWEEN 1 AND 100)),
    CHECK ("warranty_months" >= 0)
);

-- CreateTable
CREATE TABLE "product_compatibility" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accessory_product_id" TEXT NOT NULL,
    "phone_product_id" TEXT NOT NULL,
    "note" JSONB,
    CONSTRAINT "product_compatibility_accessory_product_id_fkey" FOREIGN KEY ("accessory_product_id") REFERENCES "products" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "product_compatibility_phone_product_id_fkey" FOREIGN KEY ("phone_product_id") REFERENCES "products" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "media" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "owner_type" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "alt" JSONB,
    "color_code" TEXT,
    "blurhash" TEXT,
    "is_real_unit_photo" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "media_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "products" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "warehouses" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" JSONB NOT NULL,
    "governorate" TEXT NOT NULL,
    CHECK ("governorate" IN ('DAMASCUS', 'RIF_DIMASHQ', 'ALEPPO', 'HOMS', 'HAMA', 'LATAKIA', 'TARTUS', 'IDLIB', 'DEIR_EZZOR', 'HASAKAH', 'RAQQA', 'DARAA', 'SUWAYDA', 'QUNEITRA'))
);

-- CreateTable
CREATE TABLE "inventory_levels" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "variant_id" TEXT NOT NULL,
    "warehouse_id" TEXT NOT NULL,
    "on_hand" INTEGER NOT NULL DEFAULT 0,
    "reserved" INTEGER NOT NULL DEFAULT 0,
    "incoming" INTEGER NOT NULL DEFAULT 0,
    "reorder_point" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "inventory_levels_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "inventory_levels_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CHECK ("on_hand" >= 0 AND "reserved" >= 0),
    CHECK ("reserved" <= "on_hand")
);

-- CreateTable
CREATE TABLE "inventory_reservations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "variant_id" TEXT NOT NULL,
    "warehouse_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "cart_id" TEXT,
    "order_id" TEXT,
    "expires_at" DATETIME NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "inventory_reservations_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CHECK ("kind" IN ('SOFT_HOLD', 'ORDER_HOLD', 'ORDER_HOLD_EXT'))
);

-- CreateTable
CREATE TABLE "inventory_movements" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "variant_id" TEXT NOT NULL,
    "warehouse_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "qty_delta" INTEGER NOT NULL,
    "ref_type" TEXT,
    "ref_id" TEXT,
    "actor_id" TEXT,
    "note" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK ("reason" IN ('RECEIPT', 'RESERVE', 'RELEASE', 'SALE', 'RETURN', 'TRANSFER_IN', 'TRANSFER_OUT', 'ADJUSTMENT', 'RMA'))
);

-- CreateTable
CREATE TABLE "device_units" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "variant_id" TEXT NOT NULL,
    "warehouse_id" TEXT NOT NULL,
    "imei" TEXT,
    "imei2" TEXT,
    "serial" TEXT,
    "state" TEXT NOT NULL DEFAULT 'IN_STOCK',
    "grade" TEXT,
    "battery_health_pct" INTEGER,
    "imei_check_status" TEXT,
    "order_item_id" TEXT,
    "warranty_type" TEXT,
    "warranty_start_at" DATETIME,
    "warranty_end_at" DATETIME,
    "acquisition_cost_usd_cents" BIGINT,
    CONSTRAINT "device_units_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "device_units_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "device_units_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CHECK ("state" IN ('IN_STOCK', 'ALLOCATED', 'SOLD', 'RETURNED', 'RMA', 'LOANER')),
    CHECK ("warranty_type" IN ('STORE', 'AGENT', 'IMPORTER', 'NONE'))
);

-- CreateTable
CREATE TABLE "fx_rates" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "base" TEXT NOT NULL DEFAULT 'USD',
    "quote" TEXT NOT NULL DEFAULT 'SYP',
    "rate" DECIMAL NOT NULL,
    "effective_from" DATETIME NOT NULL,
    "valid_until" DATETIME NOT NULL,
    "safety_margin_bp" INTEGER NOT NULL DEFAULT 300,
    "set_by" TEXT,
    "note" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK ("rate" > 0),
    CHECK ("valid_until" > "effective_from")
);

-- CreateTable
CREATE TABLE "carts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "token" TEXT NOT NULL,
    "user_id" TEXT,
    "coupon_code" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "carts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "cart_items" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "cart_id" TEXT NOT NULL,
    "variant_id" TEXT NOT NULL,
    "qty" INTEGER NOT NULL DEFAULT 1,
    "unit_price_snapshot_usd_cents" BIGINT NOT NULL,
    CONSTRAINT "cart_items_cart_id_fkey" FOREIGN KEY ("cart_id") REFERENCES "carts" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "cart_items_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "orders" (
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

-- CreateTable
CREATE TABLE "order_items" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "order_id" TEXT NOT NULL,
    "variant_id" TEXT NOT NULL,
    "qty" INTEGER NOT NULL DEFAULT 1,
    "unit_price_usd_cents" BIGINT NOT NULL,
    "line_total_usd_cents" BIGINT NOT NULL,
    "cogs_usd_cents" BIGINT,
    "name_snapshot" JSONB NOT NULL,
    CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "order_items_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "order_status_history" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "order_id" TEXT NOT NULL,
    "from_status" TEXT,
    "to_status" TEXT NOT NULL,
    "actor_type" TEXT NOT NULL,
    "actor_id" TEXT,
    "reason_code" TEXT,
    "source" TEXT NOT NULL DEFAULT 'SYSTEM',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "order_status_history_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CHECK ("from_status" IN ('PENDING_CONFIRMATION', 'PROCESSING', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'DELIVERY_FAILED', 'RETURNED_TO_ORIGIN', 'RETURN_REQUESTED', 'RETURNED', 'CANCELLED')),
    CHECK ("to_status" IN ('PENDING_CONFIRMATION', 'PROCESSING', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'DELIVERY_FAILED', 'RETURNED_TO_ORIGIN', 'RETURN_REQUESTED', 'RETURNED', 'CANCELLED'))
);

-- CreateTable
CREATE TABLE "shipping_rates" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "governorate" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "base_fee_usd_cents" BIGINT NOT NULL,
    "per_kg_fee_usd_cents" BIGINT NOT NULL DEFAULT 0,
    "free_above_usd_cents" BIGINT,
    "eta_min_days" INTEGER NOT NULL,
    "eta_max_days" INTEGER NOT NULL,
    CHECK ("governorate" IN ('DAMASCUS', 'RIF_DIMASHQ', 'ALEPPO', 'HOMS', 'HAMA', 'LATAKIA', 'TARTUS', 'IDLIB', 'DEIR_EZZOR', 'HASAKAH', 'RAQQA', 'DARAA', 'SUWAYDA', 'QUNEITRA')),
    CHECK ("method" IN ('COURIER_INTRACITY', 'INTERCITY_OFFICE', 'POST'))
);

-- CreateTable
CREATE TABLE "store_settings" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" JSONB NOT NULL,
    "updated_by" TEXT,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "actor_id" TEXT,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT,
    "diff" JSONB,
    "ip" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "cash_settlements" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "collector_type" TEXT NOT NULL,
    "collector_id" TEXT NOT NULL,
    "settlement_date" DATETIME NOT NULL,
    "orders_count" INTEGER NOT NULL DEFAULT 0,
    "expected_amount_syp" BIGINT NOT NULL DEFAULT 0,
    "collected_amount_syp" BIGINT NOT NULL DEFAULT 0,
    "variance_syp" BIGINT NOT NULL DEFAULT 0,
    "rounding_diff_syp" INTEGER NOT NULL DEFAULT 0,
    "delivery_commission_syp" BIGINT NOT NULL DEFAULT 0,
    "state" TEXT NOT NULL DEFAULT 'OPEN',
    "note" TEXT,
    "reconciled_by" TEXT,
    "reconciled_at" DATETIME,
    "settled_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "cash_settlements_collector_id_fkey" FOREIGN KEY ("collector_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CHECK ("collector_type" IN ('COURIER', 'TRANSPORT_OFFICE')),
    CHECK ("state" IN ('OPEN', 'RECONCILED', 'DISPUTED', 'SETTLED'))
);

-- CreateTable
CREATE TABLE "returns" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "return_no" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "order_item_id" TEXT,
    "state" TEXT NOT NULL DEFAULT 'REQUESTED',
    "reason" TEXT NOT NULL,
    "customer_note" TEXT,
    "imei_submitted" TEXT,
    "imei_checked" BOOLEAN NOT NULL DEFAULT false,
    "imei_matched" BOOLEAN,
    "inspection_note" TEXT,
    "reject_reason" TEXT,
    "restock" BOOLEAN NOT NULL DEFAULT false,
    "requested_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" DATETIME,
    "received_at" DATETIME,
    "completed_at" DATETIME,
    "decided_by" TEXT,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "returns_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CHECK ("state" IN ('REQUESTED', 'APPROVED', 'REJECTED', 'PICKUP_SCHEDULED', 'RECEIVED', 'INSPECTED', 'COMPLETED', 'CANCELLED')),
    CHECK ("reason" IN ('NOT_AS_DESCRIBED', 'DEFECTIVE', 'WRONG_ITEM', 'CHANGED_MIND', 'DAMAGED_IN_TRANSIT'))
);

-- CreateTable
CREATE TABLE "refunds" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "return_id" TEXT NOT NULL,
    "amount_usd_cents" BIGINT NOT NULL,
    "fx_rate" DECIMAL NOT NULL,
    "amount_syp" BIGINT NOT NULL,
    "rounding_diff_syp" INTEGER NOT NULL DEFAULT 0,
    "state" TEXT NOT NULL DEFAULT 'PENDING',
    "disbursed_by" TEXT,
    "disbursed_at" DATETIME,
    "note" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "refunds_return_id_fkey" FOREIGN KEY ("return_id") REFERENCES "returns" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CHECK ("state" IN ('PENDING', 'APPROVED', 'DISBURSED', 'CANCELLED'))
);

-- CreateTable
CREATE TABLE "warranty_claims" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "claim_no" TEXT NOT NULL,
    "device_unit_id" TEXT,
    "imei" TEXT,
    "phone" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'OPENED',
    "diagnosis" TEXT,
    "resolution" TEXT,
    "reject_reason" TEXT,
    "loaner_unit_id" TEXT,
    "opened_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" DATETIME,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "warranty_claims_device_unit_id_fkey" FOREIGN KEY ("device_unit_id") REFERENCES "device_units" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CHECK ("state" IN ('OPENED', 'RECEIVED', 'DIAGNOSING', 'DECISION', 'IN_REPAIR', 'TESTING', 'READY', 'CLOSED', 'REJECTED'))
);

-- CreateTable
CREATE TABLE "support_tickets" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ticket_no" TEXT NOT NULL,
    "user_id" TEXT,
    "phone" TEXT NOT NULL,
    "order_id" TEXT,
    "device_unit_id" TEXT,
    "warranty_claim_id" TEXT,
    "channel" TEXT NOT NULL DEFAULT 'WEB',
    "external_thread_id" TEXT,
    "subject" TEXT,
    "contact_reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "assignee_id" TEXT,
    "first_response_at" DATETIME,
    "resolved_at" DATETIME,
    "closed_at" DATETIME,
    "sla_first_response_due_at" DATETIME,
    "sla_resolution_due_at" DATETIME,
    "sla_breached" BOOLEAN NOT NULL DEFAULT false,
    "csat_score" INTEGER,
    "csat_comment" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "support_tickets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "support_tickets_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "support_tickets_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "support_tickets_warranty_claim_id_fkey" FOREIGN KEY ("warranty_claim_id") REFERENCES "warranty_claims" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CHECK ("channel" IN ('WHATSAPP', 'PHONE', 'WEB', 'EMAIL', 'ADMIN')),
    CHECK ("status" IN ('NEW', 'OPEN', 'PENDING_CUSTOMER', 'ESCALATED', 'RESOLVED', 'CLOSED')),
    CHECK ("priority" IN ('LOW', 'NORMAL', 'HIGH', 'URGENT'))
);

-- CreateTable
CREATE TABLE "ticket_messages" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ticket_id" TEXT NOT NULL,
    "author_type" TEXT NOT NULL,
    "author_id" TEXT,
    "body" TEXT NOT NULL,
    "is_internal_note" BOOLEAN NOT NULL DEFAULT false,
    "macro_id" TEXT,
    "delivery_channel" TEXT,
    "delivery_status" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ticket_messages_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "support_tickets" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ticket_messages_macro_id_fkey" FOREIGN KEY ("macro_id") REFERENCES "ticket_macros" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CHECK ("delivery_channel" IN ('WHATSAPP', 'PHONE', 'WEB', 'EMAIL', 'ADMIN'))
);

-- CreateTable
CREATE TABLE "ticket_macros" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "title" JSONB NOT NULL,
    "body" JSONB NOT NULL,
    "variables" JSONB NOT NULL DEFAULT '[]',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "usage_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "reviews" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "product_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "order_item_id" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "title" TEXT,
    "body" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reject_reason" TEXT,
    "flagged" BOOLEAN NOT NULL DEFAULT false,
    "helpful_count" INTEGER NOT NULL DEFAULT 0,
    "merchant_reply" TEXT,
    "merchant_reply_at" DATETIME,
    "moderated_by" TEXT,
    "moderated_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "reviews_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "reviews_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CHECK ("status" IN ('PENDING', 'PUBLISHED', 'REJECTED', 'HIDDEN'))
);

-- CreateTable
CREATE TABLE "review_reports" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "review_id" TEXT NOT NULL,
    "reporter_id" TEXT,
    "reason" TEXT NOT NULL,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "resolved_by" TEXT,
    "resolved_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "review_reports_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "reviews" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "product_questions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "product_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "answer_body" TEXT,
    "answer_source" TEXT,
    "answered_by" TEXT,
    "answered_at" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reject_reason" TEXT,
    "helpful_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "product_questions_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "product_questions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CHECK ("status" IN ('PENDING', 'PUBLISHED', 'REJECTED', 'HIDDEN'))
);

-- CreateTable
CREATE TABLE "coupons" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "value" INTEGER NOT NULL,
    "max_discount_usd_cents" INTEGER,
    "min_subtotal_usd_cents" INTEGER NOT NULL DEFAULT 0,
    "category_slugs" JSONB NOT NULL DEFAULT '[]',
    "starts_at" DATETIME NOT NULL,
    "ends_at" DATETIME NOT NULL,
    "usage_limit_total" INTEGER,
    "usage_limit_per_customer" INTEGER NOT NULL DEFAULT 1,
    "first_order_only" BOOLEAN NOT NULL DEFAULT false,
    "stackable" BOOLEAN NOT NULL DEFAULT false,
    "used_count" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CHECK ("type" IN ('PERCENTAGE', 'FIXED_AMOUNT', 'FREE_SHIPPING'))
);

-- CreateTable
CREATE TABLE "coupon_redemptions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "coupon_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "discount_usd_cents" INTEGER NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "coupon_redemptions_coupon_id_fkey" FOREIGN KEY ("coupon_id") REFERENCES "coupons" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "coupon_redemptions_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "price_alerts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "variant_id" TEXT NOT NULL,
    "base_price_usd_cents" BIGINT NOT NULL,
    "threshold_bp" INTEGER NOT NULL DEFAULT 500,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_notified_at" DATETIME,
    "expires_at" DATETIME NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "price_alerts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "price_alerts_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "push_subscriptions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT,
    "phone" TEXT,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "user_agent" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "fail_count" INTEGER NOT NULL DEFAULT 0,
    "last_sent_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "push_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "stock_alerts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT,
    "phone" TEXT NOT NULL,
    "variant_id" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "notified_at" DATETIME,
    "expires_at" DATETIME NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "stock_alerts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "stock_alerts_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "couriers" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "employment_type" TEXT NOT NULL DEFAULT 'CONTRACTOR',
    "vehicle_type" TEXT NOT NULL DEFAULT 'MOTORCYCLE',
    "vehicle_plate" TEXT,
    "home_governorate" TEXT NOT NULL,
    "daily_capacity" INTEGER NOT NULL DEFAULT 18,
    "cash_cap_usd_cents" BIGINT NOT NULL DEFAULT 200000,
    "status" TEXT NOT NULL DEFAULT 'OFF_DUTY',
    "suspension_reason" TEXT,
    "guarantor_name" TEXT,
    "guarantor_phone" TEXT,
    "deposit_usd_cents" BIGINT NOT NULL DEFAULT 0,
    "rating_avg" DECIMAL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "couriers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CHECK ("employment_type" IN ('EMPLOYEE', 'CONTRACTOR')),
    CHECK ("vehicle_type" IN ('MOTORCYCLE', 'CAR', 'VAN', 'ON_FOOT')),
    CHECK ("home_governorate" IN ('DAMASCUS', 'RIF_DIMASHQ', 'ALEPPO', 'HOMS', 'HAMA', 'LATAKIA', 'TARTUS', 'IDLIB', 'DEIR_EZZOR', 'HASAKAH', 'RAQQA', 'DARAA', 'SUWAYDA', 'QUNEITRA')),
    CHECK ("status" IN ('AVAILABLE', 'ON_ROUTE', 'OFF_DUTY', 'SUSPENDED'))
);

-- CreateTable
CREATE TABLE "delivery_zones" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" JSONB NOT NULL,
    "governorate" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "neighborhoods" JSONB NOT NULL DEFAULT '[]',
    "zone_type" TEXT NOT NULL DEFAULT 'URBAN_CORE',
    "surcharge_usd_cents" INTEGER NOT NULL DEFAULT 0,
    "sla_hours" INTEGER NOT NULL DEFAULT 24,
    "default_courier_id" TEXT,
    "cod_max_usd_cents" BIGINT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "delivery_zones_default_courier_id_fkey" FOREIGN KEY ("default_courier_id") REFERENCES "couriers" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CHECK ("governorate" IN ('DAMASCUS', 'RIF_DIMASHQ', 'ALEPPO', 'HOMS', 'HAMA', 'LATAKIA', 'TARTUS', 'IDLIB', 'DEIR_EZZOR', 'HASAKAH', 'RAQQA', 'DARAA', 'SUWAYDA', 'QUNEITRA')),
    CHECK ("zone_type" IN ('URBAN_CORE', 'URBAN_OUTER', 'SUBURBAN', 'REMOTE'))
);

-- CreateTable
CREATE TABLE "courier_zones" (
    "courier_id" TEXT NOT NULL,
    "zone_id" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 10,

    PRIMARY KEY ("courier_id", "zone_id"),
    CONSTRAINT "courier_zones_courier_id_fkey" FOREIGN KEY ("courier_id") REFERENCES "couriers" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "courier_zones_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "delivery_zones" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "quantity_breaks" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "variant_sku" TEXT,
    "category_slug" TEXT,
    "min_qty" INTEGER NOT NULL,
    "discount_bp" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "bundles" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" JSONB NOT NULL,
    "description" JSONB,
    "price_usd_cents" INTEGER NOT NULL,
    "starts_at" DATETIME,
    "ends_at" DATETIME,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "bundle_items" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bundle_id" TEXT NOT NULL,
    "variant_sku" TEXT NOT NULL,
    "qty" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "bundle_items_bundle_id_fkey" FOREIGN KEY ("bundle_id") REFERENCES "bundles" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "suppliers" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contact_name" TEXT,
    "contact_phone" TEXT,
    "country" TEXT,
    "lead_time_days" INTEGER NOT NULL DEFAULT 14,
    "notes" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "deleted_at" DATETIME
);

-- CreateTable
CREATE TABLE "purchase_orders" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "po_no" TEXT NOT NULL,
    "supplier_id" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'CONFIRMED',
    "goods_usd_cents" BIGINT NOT NULL,
    "extra_usd_cents" BIGINT NOT NULL DEFAULT 0,
    "total_usd_cents" BIGINT NOT NULL,
    "landed_factor_ppm" INTEGER NOT NULL DEFAULT 0,
    "expected_at" DATETIME,
    "received_at" DATETIME,
    "created_by_id" TEXT,
    "note" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "purchase_orders_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CHECK ("state" IN ('DRAFT', 'CONFIRMED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED'))
);

-- CreateTable
CREATE TABLE "purchase_order_lines" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "po_id" TEXT NOT NULL,
    "variant_id" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "qty_received" INTEGER NOT NULL DEFAULT 0,
    "unit_cost_usd_cents" BIGINT NOT NULL,
    "landed_unit_cost_usd_cents" BIGINT NOT NULL,
    CONSTRAINT "purchase_order_lines_po_id_fkey" FOREIGN KEY ("po_id") REFERENCES "purchase_orders" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "purchase_order_lines_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "wishlist_items" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "variant_id" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "wishlist_items_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "wishlist_items_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "user_agent" TEXT,
    "ip" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" DATETIME,
    CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "account_deletion_requests" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "requested_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "due_at" DATETIME NOT NULL,
    "completed_at" DATETIME,
    "note" TEXT,
    CONSTRAINT "account_deletion_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CHECK ("state" IN ('PENDING', 'COMPLETED', 'CANCELLED'))
);

-- CreateTable
CREATE TABLE "readiness_checks" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "title" JSONB NOT NULL,
    "is_blocking" BOOLEAN NOT NULL DEFAULT true,
    "owner_role" TEXT NOT NULL,
    "evidence_url" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "checked_by_id" TEXT,
    "checked_at" DATETIME,
    "waiver_reason" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "readiness_checks_checked_by_id_fkey" FOREIGN KEY ("checked_by_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CHECK ("category" IN ('TECH', 'CONTENT', 'OPS', 'LEGAL', 'FINANCE')),
    CHECK ("status" IN ('PENDING', 'PASSED', 'FAILED', 'WAIVED'))
);

-- CreateTable
CREATE TABLE "ops_routine_runs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "routine_code" TEXT NOT NULL,
    "cadence" TEXT NOT NULL,
    "period_key" TEXT NOT NULL,
    "performed_by_id" TEXT,
    "is_automated" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'DONE',
    "notes" TEXT,
    "completed_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ops_routine_runs_performed_by_id_fkey" FOREIGN KEY ("performed_by_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CHECK ("cadence" IN ('DAILY', 'WEEKLY', 'MONTHLY')),
    CHECK ("status" IN ('DONE', 'SKIPPED', 'FAILED'))
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
CREATE UNIQUE INDEX "product_variants_product_id_storage_gb_ram_gb_color_code_deviceOrigin_part_code_key" ON "product_variants"("product_id", "storage_gb", "ram_gb", "color_code", "deviceOrigin", "part_code");

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
CREATE UNIQUE INDEX "cash_settlements_collector_type_collector_id_settlement_date_key" ON "cash_settlements"("collector_type", "collector_id", "settlement_date");

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
CREATE UNIQUE INDEX "push_subscriptions_endpoint_key" ON "push_subscriptions"("endpoint");

-- CreateIndex
CREATE INDEX "push_subscriptions_user_id_idx" ON "push_subscriptions"("user_id");

-- CreateIndex
CREATE INDEX "push_subscriptions_phone_idx" ON "push_subscriptions"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "stock_alerts_phone_variant_id_key" ON "stock_alerts"("phone", "variant_id");

-- CreateIndex
CREATE UNIQUE INDEX "couriers_user_id_key" ON "couriers"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "couriers_code_key" ON "couriers"("code");

-- CreateIndex
CREATE INDEX "couriers_status_active_idx" ON "couriers"("status", "active");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_zones_code_key" ON "delivery_zones"("code");

-- CreateIndex
CREATE INDEX "delivery_zones_governorate_active_idx" ON "delivery_zones"("governorate", "active");

-- CreateIndex
CREATE INDEX "quantity_breaks_variant_sku_min_qty_idx" ON "quantity_breaks"("variant_sku", "min_qty");

-- CreateIndex
CREATE INDEX "quantity_breaks_category_slug_min_qty_idx" ON "quantity_breaks"("category_slug", "min_qty");

-- CreateIndex
CREATE UNIQUE INDEX "bundles_code_key" ON "bundles"("code");

-- CreateIndex
CREATE INDEX "bundles_is_active_ends_at_idx" ON "bundles"("is_active", "ends_at");

-- CreateIndex
CREATE UNIQUE INDEX "bundle_items_bundle_id_variant_sku_key" ON "bundle_items"("bundle_id", "variant_sku");

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



-- ——————————— المحفِّزات (prisma/sql/constraints.sql) ———————————


CREATE TRIGGER IF NOT EXISTS trg_units_match_levels
AFTER UPDATE OF version ON inventory_levels
WHEN (
  SELECT count(*) FROM device_units du
   WHERE du.variant_id = NEW.variant_id
     AND du.warehouse_id = NEW.warehouse_id
     AND du.state = 'IN_STOCK'
) > 0
AND NEW.on_hand <> (
  SELECT count(*) FROM device_units du
   WHERE du.variant_id = NEW.variant_id
     AND du.warehouse_id = NEW.warehouse_id
     AND du.state = 'IN_STOCK'
)
BEGIN
  SELECT RAISE(ABORT, 'انحراف مخزون: عدد الوحدات بحالة IN_STOCK لا يطابق on_hand');
END;




CREATE TRIGGER IF NOT EXISTS trg_reserved_le_onhand
AFTER UPDATE ON inventory_levels
WHEN NEW.reserved > NEW.on_hand
BEGIN
  SELECT RAISE(ABORT, 'انحراف مخزون: المحجوز يتجاوز الموجود على الرفّ');
END;

