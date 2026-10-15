-- AlterTable
ALTER TABLE "LandingPage" ADD COLUMN     "industryKey" TEXT;

-- CreateTable
CREATE TABLE "IndustryPlaybook" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ready',
    "error" TEXT,
    "model" TEXT,
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IndustryPlaybook_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IndustryPlaybook_key_key" ON "IndustryPlaybook"("key");
