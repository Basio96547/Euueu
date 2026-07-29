-- AlterEnum
BEGIN;
CREATE TYPE "ClaimState_new" AS ENUM ('OPENED', 'RECEIVED', 'DIAGNOSING', 'DECISION', 'IN_REPAIR', 'TESTING', 'READY', 'CLOSED', 'REJECTED');
ALTER TABLE "public"."warranty_claims" ALTER COLUMN "state" DROP DEFAULT;
ALTER TABLE "warranty_claims" ALTER COLUMN "state" TYPE "ClaimState_new" USING ("state"::text::"ClaimState_new");
ALTER TYPE "ClaimState" RENAME TO "ClaimState_old";
ALTER TYPE "ClaimState_new" RENAME TO "ClaimState";
DROP TYPE "public"."ClaimState_old";
ALTER TABLE "warranty_claims" ALTER COLUMN "state" SET DEFAULT 'OPENED';
COMMIT;

