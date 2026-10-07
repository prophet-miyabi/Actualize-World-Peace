-- AlterTable
ALTER TABLE "AffiliateClick" ADD COLUMN     "lpId" TEXT;

-- AlterTable
ALTER TABLE "LandingPage" ADD COLUMN     "monetizationEnabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "ToolCatalogItem" ADD COLUMN     "revenueShareAllowed" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "LedgerTransaction" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "memo" TEXT NOT NULL,
    "refType" TEXT,
    "refId" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" TEXT NOT NULL,
    "txId" TEXT NOT NULL,
    "account" TEXT NOT NULL,
    "userId" TEXT,
    "debit" INTEGER NOT NULL DEFAULT 0,
    "credit" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RevenueEvent" (
    "id" TEXT NOT NULL,
    "toolKey" TEXT NOT NULL,
    "lpId" TEXT,
    "userId" TEXT,
    "grossYen" INTEGER NOT NULL,
    "ownerYen" INTEGER NOT NULL,
    "platformYen" INTEGER NOT NULL,
    "occurredOn" TIMESTAMP(3) NOT NULL,
    "externalRef" TEXT,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'recorded',
    "txId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RevenueEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LedgerTransaction_refType_refId_idx" ON "LedgerTransaction"("refType", "refId");

-- CreateIndex
CREATE INDEX "LedgerEntry_account_idx" ON "LedgerEntry"("account");

-- CreateIndex
CREATE INDEX "LedgerEntry_userId_idx" ON "LedgerEntry"("userId");

-- CreateIndex
CREATE INDEX "RevenueEvent_userId_idx" ON "RevenueEvent"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "RevenueEvent_toolKey_externalRef_key" ON "RevenueEvent"("toolKey", "externalRef");

-- CreateIndex
CREATE INDEX "AffiliateClick_lpId_idx" ON "AffiliateClick"("lpId");

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_txId_fkey" FOREIGN KEY ("txId") REFERENCES "LedgerTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

