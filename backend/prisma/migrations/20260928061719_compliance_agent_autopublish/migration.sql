-- AlterTable
ALTER TABLE "AgentTask" ADD COLUMN     "autoApproved" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "reviewNote" TEXT,
ADD COLUMN     "reviewPassed" BOOLEAN;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "autoPublishEnabled" BOOLEAN NOT NULL DEFAULT false;
