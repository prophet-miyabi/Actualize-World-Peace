-- AlterTable
ALTER TABLE "LandingPage" ADD COLUMN     "postsPlacement" TEXT NOT NULL DEFAULT 'top';

-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "showOnPage" BOOLEAN NOT NULL DEFAULT true;
