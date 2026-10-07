-- AlterTable
ALTER TABLE "LandingPage" ADD COLUMN     "lineAddUrl" TEXT,
ADD COLUMN     "purpose" TEXT NOT NULL DEFAULT 'business';
