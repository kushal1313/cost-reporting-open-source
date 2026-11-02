-- AlterTable
ALTER TABLE "CostRecord" ADD COLUMN     "dataset" TEXT;

-- AlterTable
ALTER TABLE "GroupCost" ADD COLUMN     "dataset" TEXT;

-- AlterTable
ALTER TABLE "UserActivity" ADD COLUMN     "dataset" TEXT;

-- CreateTable
CREATE TABLE "UserUsage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "connectorInstanceId" TEXT NOT NULL,
    "providerName" TEXT NOT NULL,
    "dataset" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,
    "userEmail" TEXT,
    "userName" TEXT,
    "credits" DOUBLE PRECISION,
    "effectiveCost" DECIMAL(18,6) NOT NULL,
    "billingCurrency" TEXT NOT NULL,
    "tokens" DOUBLE PRECISION,
    "linesOfCode" INTEGER,

    CONSTRAINT "UserUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageMetric" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "connectorInstanceId" TEXT NOT NULL,
    "providerName" TEXT NOT NULL,
    "dataset" TEXT NOT NULL,
    "dimension" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "effectiveCost" DECIMAL(18,6),

    CONSTRAINT "UsageMetric_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserUsage_organizationId_providerName_periodStart_idx" ON "UserUsage"("organizationId", "providerName", "periodStart");

-- CreateIndex
CREATE INDEX "UserUsage_connectorInstanceId_periodStart_idx" ON "UserUsage"("connectorInstanceId", "periodStart");

-- CreateIndex
CREATE INDEX "UsageMetric_organizationId_providerName_periodStart_idx" ON "UsageMetric"("organizationId", "providerName", "periodStart");

-- CreateIndex
CREATE INDEX "UsageMetric_connectorInstanceId_periodStart_idx" ON "UsageMetric"("connectorInstanceId", "periodStart");

-- AddForeignKey
ALTER TABLE "UserUsage" ADD CONSTRAINT "UserUsage_connectorInstanceId_fkey" FOREIGN KEY ("connectorInstanceId") REFERENCES "ConnectorInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageMetric" ADD CONSTRAINT "UsageMetric_connectorInstanceId_fkey" FOREIGN KEY ("connectorInstanceId") REFERENCES "ConnectorInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Rows from ChatGPT imports made before reports were told apart all came from
-- the per-user usage export (seat fees aside), so tag them as that dataset;
-- otherwise the next import of that report would leave them in place beside
-- its own rows and count them twice.
UPDATE "CostRecord" SET "dataset" = CASE WHEN "chargeCategory" = 'Purchase' THEN 'seats' ELSE 'usage' END
WHERE "connectorInstanceId" IN (SELECT "id" FROM "ConnectorInstance" WHERE "provider" = 'OpenAI');
UPDATE "GroupCost" SET "dataset" = 'usage'
WHERE "connectorInstanceId" IN (SELECT "id" FROM "ConnectorInstance" WHERE "provider" = 'OpenAI');
UPDATE "UserActivity" SET "dataset" = 'usage'
WHERE "connectorInstanceId" IN (SELECT "id" FROM "ConnectorInstance" WHERE "provider" = 'OpenAI');
