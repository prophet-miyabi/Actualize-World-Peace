-- CreateTable
CREATE TABLE "Photo" (
    "id" TEXT NOT NULL,
    "lpId" TEXT NOT NULL,
    "isLogo" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,
    "original" BYTEA NOT NULL,
    "originalType" TEXT NOT NULL,
    "enhanced" BYTEA,
    "enhancedType" TEXT,
    "enhanceStatus" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Photo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Photo_lpId_idx" ON "Photo"("lpId");

-- AddForeignKey
ALTER TABLE "Photo" ADD CONSTRAINT "Photo_lpId_fkey" FOREIGN KEY ("lpId") REFERENCES "LandingPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

