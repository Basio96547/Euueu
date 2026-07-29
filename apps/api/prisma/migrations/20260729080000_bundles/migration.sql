-- CreateTable
CREATE TABLE "bundles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(32) NOT NULL,
    "name" JSONB NOT NULL,
    "description" JSONB,
    "price_usd_cents" INTEGER NOT NULL,
    "starts_at" TIMESTAMPTZ,
    "ends_at" TIMESTAMPTZ,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "bundles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bundle_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "bundle_id" UUID NOT NULL,
    "variant_sku" VARCHAR(40) NOT NULL,
    "qty" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "bundle_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bundles_code_key" ON "bundles"("code");

-- CreateIndex
CREATE INDEX "bundles_is_active_ends_at_idx" ON "bundles"("is_active", "ends_at");

-- CreateIndex
CREATE UNIQUE INDEX "bundle_items_bundle_id_variant_sku_key" ON "bundle_items"("bundle_id", "variant_sku");

-- AddForeignKey
ALTER TABLE "bundle_items" ADD CONSTRAINT "bundle_items_bundle_id_fkey" FOREIGN KEY ("bundle_id") REFERENCES "bundles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

