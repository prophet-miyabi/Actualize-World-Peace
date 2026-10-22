-- AlterTable
ALTER TABLE "SocialAccount" ADD COLUMN     "lastError" TEXT,
ADD COLUMN     "lastSyncAt" TIMESTAMP(3),
ADD COLUMN     "scope" TEXT,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'connected',
ADD COLUMN     "syncEnabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "ScheduledPost" ADD COLUMN     "canceledAt" TIMESTAMP(3),
ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'post',
ADD COLUMN     "lastError" TEXT,
ADD COLUMN     "media" BYTEA,
ADD COLUMN     "mediaType" TEXT,
ADD COLUMN     "nextAttemptAt" TIMESTAMP(3),
ADD COLUMN     "postId" TEXT,
ADD COLUMN     "postedIds" JSONB;

-- AlterTable
ALTER TABLE "LandingPage" ADD COLUMN     "postsConfig" JSONB;

-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "externalId" TEXT,
ADD COLUMN     "externalUrl" TEXT,
ADD COLUMN     "scheduledPostId" TEXT,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'awp';

-- CreateIndex
CREATE INDEX "Post_userId_source_externalId_idx" ON "Post"("userId", "source", "externalId");

