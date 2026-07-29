-- CreateTable
CREATE TABLE "quantity_breaks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "variant_sku" VARCHAR(40),
    "category_slug" TEXT,
    "min_qty" INTEGER NOT NULL,
    "discount_bp" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quantity_breaks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "quantity_breaks_variant_sku_min_qty_idx" ON "quantity_breaks"("variant_sku", "min_qty");

-- CreateIndex
CREATE INDEX "quantity_breaks_category_slug_min_qty_idx" ON "quantity_breaks"("category_slug", "min_qty");

