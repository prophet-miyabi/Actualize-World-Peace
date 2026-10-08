-- AlterTable
ALTER TABLE "LandingPage" ADD COLUMN     "customDomainMode" TEXT,
ADD COLUMN     "customDomainNote" TEXT,
ADD COLUMN     "customDomainReviewUntil" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "purchasable" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "requiresShipping" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "stock" INTEGER;

-- AlterTable
ALTER TABLE "ToolCatalogItem" ADD COLUMN     "isDomainRegistrar" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "registrarMatch" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "plan" TEXT NOT NULL DEFAULT 'free',
ADD COLUMN     "planUntil" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "PlanPayment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "plan" TEXT NOT NULL,
    "months" INTEGER NOT NULL,
    "amountYen" INTEGER NOT NULL,
    "method" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "expiresAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "confirmedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlanPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiUsage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "feature" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DomainReferral" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "toolKey" TEXT NOT NULL,
    "clickedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DomainReferral_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SellerProfile" (
    "userId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "legal" JSONB NOT NULL,
    "bankEnc" TEXT,
    "bankEnabled" BOOLEAN NOT NULL DEFAULT false,
    "inPersonEnabled" BOOLEAN NOT NULL DEFAULT false,
    "inPersonNote" TEXT,
    "shippingFeeYen" INTEGER NOT NULL DEFAULT 0,
    "freeShippingOverYen" INTEGER,
    "paymentDays" INTEGER NOT NULL DEFAULT 7,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SellerProfile_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "lpId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "subtotalYen" INTEGER NOT NULL,
    "shippingYen" INTEGER NOT NULL,
    "totalYen" INTEGER NOT NULL,
    "paymentMethod" TEXT NOT NULL,
    "buyerName" TEXT NOT NULL,
    "buyerContact" TEXT NOT NULL,
    "shipping" JSONB,
    "message" TEXT,
    "status" TEXT NOT NULL DEFAULT 'awaiting_payment',
    "expiresAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "shippedAt" TIMESTAMP(3),
    "sellerNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlanPayment_reference_key" ON "PlanPayment"("reference");

-- CreateIndex
CREATE INDEX "PlanPayment_status_createdAt_idx" ON "PlanPayment"("status", "createdAt");

-- CreateIndex
CREATE INDEX "PlanPayment_userId_idx" ON "PlanPayment"("userId");

-- CreateIndex
CREATE INDEX "AiUsage_userId_createdAt_idx" ON "AiUsage"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "DomainReferral_userId_clickedAt_idx" ON "DomainReferral"("userId", "clickedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Order_code_key" ON "Order"("code");

-- CreateIndex
CREATE INDEX "Order_sellerId_createdAt_idx" ON "Order"("sellerId", "createdAt");

-- CreateIndex
CREATE INDEX "Order_status_expiresAt_idx" ON "Order"("status", "expiresAt");

-- AddForeignKey
ALTER TABLE "PlanPayment" ADD CONSTRAINT "PlanPayment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiUsage" ADD CONSTRAINT "AiUsage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DomainReferral" ADD CONSTRAINT "DomainReferral_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SellerProfile" ADD CONSTRAINT "SellerProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_lpId_fkey" FOREIGN KEY ("lpId") REFERENCES "LandingPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

