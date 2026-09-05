-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "btree_gist";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "postgis";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('CUSTOMER', 'TECHNICIAN', 'ENGINEER', 'ADMIN');

-- CreateEnum
CREATE TYPE "VehicleType" AS ENUM ('SEDAN', 'SUV', 'MOTORCYCLE', 'HEAVY_TRUCK', 'BUS');

-- CreateEnum
CREATE TYPE "MalfunctionCategory" AS ENUM ('ELECTRICAL', 'MECHANICAL', 'TIRE_AND_WHEEL', 'BODY_AND_CHASSIS', 'BATTERY_JUMP', 'TOWING');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('PENDING', 'EXAM_PASSED', 'VERIFIED', 'REJECTED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('QUEUED', 'DISPATCHING', 'ACCEPTED', 'ARRIVED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'UNFULFILLED');

-- CreateEnum
CREATE TYPE "DisputeStatus" AS ENUM ('PENDING', 'INVESTIGATING', 'RESOLVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ComplaintAuthorRole" AS ENUM ('CUSTOMER', 'TECHNICIAN');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "national_id" VARCHAR(32),
    "phone_number" VARCHAR(20) NOT NULL,
    "full_name" VARCHAR(128) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'CUSTOMER',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "technician_profiles" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "user_id" UUID NOT NULL,
    "verification_status" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
    "exam_score" DOUBLE PRECISION,
    "is_online" BOOLEAN NOT NULL DEFAULT false,
    "is_locked" BOOLEAN NOT NULL DEFAULT false,
    "vehicle_specialties" "VehicleType"[],
    "malfunction_specialties" "MalfunctionCategory"[],
    "avg_quality_rating" DECIMAL(3,2) NOT NULL DEFAULT 5.0,
    "avg_price_rating" DECIMAL(3,2) NOT NULL DEFAULT 5.0,
    "total_completed_jobs" INTEGER NOT NULL DEFAULT 0,
    "current_location" geometry(Point, 4326),

    CONSTRAINT "technician_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assistance_requests" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "customer_id" UUID NOT NULL,
    "technician_id" UUID,
    "vehicle_type" "VehicleType" NOT NULL,
    "malfunction_category" "MalfunctionCategory" NOT NULL,
    "status" "RequestStatus" NOT NULL DEFAULT 'QUEUED',
    "pickup_location" geometry(Point, 4326) NOT NULL,
    "address_description" TEXT,
    "fare_amount" DECIMAL(10,2),
    "estimated_arrival_minutes" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "accepted_at" TIMESTAMPTZ,
    "completed_at" TIMESTAMPTZ,

    CONSTRAINT "assistance_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ratings" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "request_id" UUID NOT NULL,
    "quality_score" SMALLINT NOT NULL,
    "price_fairness_score" SMALLINT NOT NULL,
    "comment" VARCHAR(500),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ratings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "disputes" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "request_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "target_user_id" UUID NOT NULL,
    "author_role" "ComplaintAuthorRole" NOT NULL,
    "category" VARCHAR(64) NOT NULL,
    "description" TEXT NOT NULL,
    "status" "DisputeStatus" NOT NULL DEFAULT 'PENDING',
    "admin_notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ,

    CONSTRAINT "disputes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" BIGSERIAL NOT NULL,
    "user_id" UUID,
    "action" VARCHAR(64) NOT NULL,
    "entity_type" VARCHAR(64) NOT NULL,
    "entity_id" VARCHAR(64) NOT NULL,
    "payload_json" JSONB NOT NULL,
    "client_ip" VARCHAR(45),
    "timestamp" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_national_id_key" ON "users"("national_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_number_key" ON "users"("phone_number");

-- CreateIndex
CREATE INDEX "idx_users_phone" ON "users"("phone_number");

-- CreateIndex
CREATE UNIQUE INDEX "technician_profiles_user_id_key" ON "technician_profiles"("user_id");

-- CreateIndex
CREATE INDEX "idx_technicians_dispatch_readiness" ON "technician_profiles"("is_online", "verification_status");

-- CreateIndex
CREATE INDEX "idx_requests_status" ON "assistance_requests"("status");

-- CreateIndex
CREATE INDEX "idx_customer_active_req" ON "assistance_requests"("customer_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ratings_request_id_key" ON "ratings"("request_id");

-- CreateIndex
CREATE INDEX "idx_audit_entity" ON "audit_logs"("entity_type", "entity_id");

-- AddForeignKey
ALTER TABLE "technician_profiles" ADD CONSTRAINT "technician_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistance_requests" ADD CONSTRAINT "assistance_requests_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistance_requests" ADD CONSTRAINT "assistance_requests_technician_id_fkey" FOREIGN KEY ("technician_id") REFERENCES "technician_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "assistance_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "assistance_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_target_user_id_fkey" FOREIGN KEY ("target_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
