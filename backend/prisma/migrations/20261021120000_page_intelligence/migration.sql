-- CreateTable
CREATE TABLE "PageIntelligenceSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lpId" TEXT,
    "industry" TEXT NOT NULL,
    "industryKey" TEXT,
    "pageGoal" TEXT NOT NULL,
    "targetAudience" JSONB,
    "tone" TEXT,
    "valueProps" JSONB,
    "requiredSections" TEXT[],
    "assumptions" JSONB,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "researchSnapshotId" TEXT,
    "selectedProposalId" TEXT,
    "selections" JSONB,
    "previewToken" TEXT NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PageIntelligenceSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PageStructureSuggestion" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "landingPageId" TEXT,
    "industry" TEXT NOT NULL,
    "goal" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "concept" TEXT NOT NULL,
    "whyItWorks" TEXT NOT NULL,
    "sections" JSONB NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "sourceSummary" TEXT,
    "status" TEXT NOT NULL DEFAULT 'proposed',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PageStructureSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PageImageSuggestion" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "proposalId" TEXT,
    "sectionId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "tone" TEXT NOT NULL,
    "aspectRatio" TEXT NOT NULL,
    "cropPolicy" TEXT,
    "prompt" TEXT,
    "assetUrl" TEXT,
    "uploadId" TEXT,
    "data" BYTEA,
    "mimeType" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "licenseInfo" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "alternatives" JSONB,
    "altText" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'candidate',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PageImageSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PageResearchSnapshot" (
    "id" TEXT NOT NULL,
    "industryKey" TEXT NOT NULL,
    "goal" TEXT NOT NULL,
    "region" TEXT,
    "patterns" JSONB NOT NULL,
    "commonSections" JSONB NOT NULL,
    "commonCta" JSONB NOT NULL,
    "trustElements" JSONB NOT NULL,
    "imagePatterns" JSONB NOT NULL,
    "differentiators" JSONB NOT NULL,
    "sourceSummary" TEXT NOT NULL,
    "researchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PageResearchSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PageIntelligenceSession_previewToken_key" ON "PageIntelligenceSession"("previewToken");

-- CreateIndex
CREATE INDEX "PageIntelligenceSession_userId_createdAt_idx" ON "PageIntelligenceSession"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "PageStructureSuggestion_sessionId_idx" ON "PageStructureSuggestion"("sessionId");

-- CreateIndex
CREATE INDEX "PageImageSuggestion_sessionId_sectionId_idx" ON "PageImageSuggestion"("sessionId", "sectionId");

-- CreateIndex
CREATE INDEX "PageResearchSnapshot_industryKey_goal_idx" ON "PageResearchSnapshot"("industryKey", "goal");

-- AddForeignKey
ALTER TABLE "PageIntelligenceSession" ADD CONSTRAINT "PageIntelligenceSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PageIntelligenceSession" ADD CONSTRAINT "PageIntelligenceSession_lpId_fkey" FOREIGN KEY ("lpId") REFERENCES "LandingPage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PageIntelligenceSession" ADD CONSTRAINT "PageIntelligenceSession_researchSnapshotId_fkey" FOREIGN KEY ("researchSnapshotId") REFERENCES "PageResearchSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PageStructureSuggestion" ADD CONSTRAINT "PageStructureSuggestion_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "PageIntelligenceSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PageStructureSuggestion" ADD CONSTRAINT "PageStructureSuggestion_landingPageId_fkey" FOREIGN KEY ("landingPageId") REFERENCES "LandingPage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PageImageSuggestion" ADD CONSTRAINT "PageImageSuggestion_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "PageIntelligenceSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PageImageSuggestion" ADD CONSTRAINT "PageImageSuggestion_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "PageStructureSuggestion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

