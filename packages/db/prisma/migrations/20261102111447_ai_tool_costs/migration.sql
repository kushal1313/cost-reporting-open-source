-- AlterTable
ALTER TABLE "ConnectorInstance" ADD COLUMN     "seatCount" INTEGER,
ADD COLUMN     "seatPricePerMonth" DECIMAL(18,2);

-- AlterTable
ALTER TABLE "CostRecord" ADD COLUMN     "userEmail" TEXT,
ADD COLUMN     "userId" TEXT,
ADD COLUMN     "userName" TEXT;

-- CreateTable
CREATE TABLE "GroupCost" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "connectorInstanceId" TEXT NOT NULL,
    "providerName" TEXT NOT NULL,
    "groupId" TEXT,
    "groupName" TEXT,
    "chargePeriodStart" TIMESTAMP(3) NOT NULL,
    "chargePeriodEnd" TIMESTAMP(3) NOT NULL,
    "effectiveCost" DECIMAL(18,6) NOT NULL,
    "billingCurrency" TEXT NOT NULL,

    CONSTRAINT "GroupCost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserActivity" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "connectorInstanceId" TEXT NOT NULL,
    "providerName" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,
    "userEmail" TEXT,
    "userName" TEXT,
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "sessionCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "UserActivity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GroupCost_organizationId_providerName_chargePeriodStart_idx" ON "GroupCost"("organizationId", "providerName", "chargePeriodStart");

-- CreateIndex
CREATE INDEX "GroupCost_connectorInstanceId_chargePeriodStart_idx" ON "GroupCost"("connectorInstanceId", "chargePeriodStart");

-- CreateIndex
CREATE INDEX "UserActivity_organizationId_providerName_date_idx" ON "UserActivity"("organizationId", "providerName", "date");

-- CreateIndex
CREATE INDEX "UserActivity_connectorInstanceId_date_idx" ON "UserActivity"("connectorInstanceId", "date");

-- CreateIndex
CREATE INDEX "CostRecord_organizationId_providerName_userId_idx" ON "CostRecord"("organizationId", "providerName", "userId");

-- AddForeignKey
ALTER TABLE "GroupCost" ADD CONSTRAINT "GroupCost_connectorInstanceId_fkey" FOREIGN KEY ("connectorInstanceId") REFERENCES "ConnectorInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserActivity" ADD CONSTRAINT "UserActivity_connectorInstanceId_fkey" FOREIGN KEY ("connectorInstanceId") REFERENCES "ConnectorInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;
