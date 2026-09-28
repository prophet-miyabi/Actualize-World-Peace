-- AlterTable
ALTER TABLE "LandingPage" ADD COLUMN     "design" JSONB,
ADD COLUMN     "designSource" TEXT,
ADD COLUMN     "designStatus" TEXT,
ADD COLUMN     "designUpdatedAt" TIMESTAMP(3),
ADD COLUMN     "heroImage" BYTEA,
ADD COLUMN     "heroImageType" TEXT;

