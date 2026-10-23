-- CreateTable
CREATE TABLE "AwpIntelligenceLake" (
    "id" TEXT NOT NULL,
    "industryKey" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "funnelStage" TEXT NOT NULL,
    "templateHash" TEXT,
    "spintaxVariant" TEXT,
    "triggerKeyword" TEXT,
    "converted" BOOLEAN NOT NULL DEFAULT false,
    "revenueAmount" INTEGER NOT NULL DEFAULT 0,
    "dwellTimeMs" INTEGER,
    "hourOfDay" INTEGER NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AwpIntelligenceLake_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IndustryFunnelBenchmark" (
    "id" TEXT NOT NULL,
    "industryKey" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "sampleSize" INTEGER NOT NULL DEFAULT 0,
    "avgGatePassRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgClickRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgBookingRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgOrderValue" INTEGER NOT NULL DEFAULT 0,
    "bestSendHoursJson" JSONB NOT NULL DEFAULT '[]',
    "winningKeywordsJson" JSONB NOT NULL DEFAULT '[]',
    "optimalJitterMs" INTEGER NOT NULL DEFAULT 2500,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IndustryFunnelBenchmark_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HarnessIntentSignal" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "industryKey" TEXT NOT NULL,
    "monthlyTraffic" INTEGER NOT NULL DEFAULT 0,
    "monthlyBookings" INTEGER NOT NULL DEFAULT 0,
    "lineFriendCount" INTEGER NOT NULL DEFAULT 0,
    "recommendedAddon" TEXT NOT NULL,
    "intentScore" INTEGER NOT NULL DEFAULT 0,
    "reason" TEXT,
    "isConverted" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HarnessIntentSignal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AwpIntelligenceLake_industryKey_channel_funnelStage_idx" ON "AwpIntelligenceLake"("industryKey", "channel", "funnelStage");

-- CreateIndex
CREATE INDEX "AwpIntelligenceLake_createdAt_converted_idx" ON "AwpIntelligenceLake"("createdAt", "converted");

-- CreateIndex
CREATE UNIQUE INDEX "IndustryFunnelBenchmark_industryKey_channel_key" ON "IndustryFunnelBenchmark"("industryKey", "channel");

-- CreateIndex
CREATE INDEX "HarnessIntentSignal_ownerId_intentScore_idx" ON "HarnessIntentSignal"("ownerId", "intentScore");

-- CreateIndex
CREATE UNIQUE INDEX "HarnessIntentSignal_ownerId_recommendedAddon_key" ON "HarnessIntentSignal"("ownerId", "recommendedAddon");

