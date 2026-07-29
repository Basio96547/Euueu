-- CreateEnum
CREATE TYPE "EmploymentType" AS ENUM ('EMPLOYEE', 'CONTRACTOR');

-- CreateEnum
CREATE TYPE "VehicleType" AS ENUM ('MOTORCYCLE', 'CAR', 'VAN', 'ON_FOOT');

-- CreateEnum
CREATE TYPE "CourierStatus" AS ENUM ('AVAILABLE', 'ON_ROUTE', 'OFF_DUTY', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "ZoneType" AS ENUM ('URBAN_CORE', 'URBAN_OUTER', 'SUBURBAN', 'REMOTE');

-- CreateTable
CREATE TABLE "couriers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "code" VARCHAR(8) NOT NULL,
    "full_name" VARCHAR(120) NOT NULL,
    "phone" VARCHAR(16) NOT NULL,
    "employment_type" "EmploymentType" NOT NULL DEFAULT 'CONTRACTOR',
    "vehicle_type" "VehicleType" NOT NULL DEFAULT 'MOTORCYCLE',
    "vehicle_plate" VARCHAR(20),
    "home_governorate" "Governorate" NOT NULL,
    "daily_capacity" INTEGER NOT NULL DEFAULT 18,
    "cash_cap_usd_cents" BIGINT NOT NULL DEFAULT 200000,
    "status" "CourierStatus" NOT NULL DEFAULT 'OFF_DUTY',
    "suspension_reason" TEXT,
    "guarantor_name" VARCHAR(120),
    "guarantor_phone" VARCHAR(16),
    "deposit_usd_cents" BIGINT NOT NULL DEFAULT 0,
    "rating_avg" DECIMAL(3,2),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "couriers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_zones" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(16) NOT NULL,
    "name" JSONB NOT NULL,
    "governorate" "Governorate" NOT NULL,
    "city" VARCHAR(40) NOT NULL,
    "neighborhoods" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "zone_type" "ZoneType" NOT NULL DEFAULT 'URBAN_CORE',
    "surcharge_usd_cents" INTEGER NOT NULL DEFAULT 0,
    "sla_hours" INTEGER NOT NULL DEFAULT 24,
    "default_courier_id" UUID,
    "cod_max_usd_cents" BIGINT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "delivery_zones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "courier_zones" (
    "courier_id" UUID NOT NULL,
    "zone_id" UUID NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 10,

    CONSTRAINT "courier_zones_pkey" PRIMARY KEY ("courier_id","zone_id")
);

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

-- AddForeignKey
ALTER TABLE "couriers" ADD CONSTRAINT "couriers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_zones" ADD CONSTRAINT "delivery_zones_default_courier_id_fkey" FOREIGN KEY ("default_courier_id") REFERENCES "couriers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courier_zones" ADD CONSTRAINT "courier_zones_courier_id_fkey" FOREIGN KEY ("courier_id") REFERENCES "couriers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courier_zones" ADD CONSTRAINT "courier_zones_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "delivery_zones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

