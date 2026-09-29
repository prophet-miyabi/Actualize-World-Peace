-- CreateTable
CREATE TABLE "LpVariant" (
    "id" TEXT NOT NULL,
    "lpId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "heroTitle" TEXT NOT NULL,
    "isControl" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "conversions" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LpVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemError" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "stack" TEXT,
    "context" JSONB,
    "diagnosis" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SystemError_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LpVariant_lpId_idx" ON "LpVariant"("lpId");

-- CreateIndex
CREATE INDEX "SystemError_status_createdAt_idx" ON "SystemError"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "LpVariant" ADD CONSTRAINT "LpVariant_lpId_fkey" FOREIGN KEY ("lpId") REFERENCES "LandingPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
