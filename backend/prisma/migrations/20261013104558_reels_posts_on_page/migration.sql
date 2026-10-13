-- AlterTable
ALTER TABLE "LandingPage" ADD COLUMN     "postsEnabled" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'post',
ADD COLUMN     "video" BYTEA,
ADD COLUMN     "videoSize" INTEGER,
ADD COLUMN     "videoType" TEXT;

