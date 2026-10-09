-- AlterTable
ALTER TABLE "AgentRun" ADD COLUMN     "engine" TEXT NOT NULL DEFAULT 'messages',
ADD COLUMN     "sessionId" TEXT;

-- AlterTable
ALTER TABLE "CompanyAgentConfig" ADD COLUMN     "managedAgentId" TEXT,
ADD COLUMN     "managedHash" TEXT,
ADD COLUMN     "managedSyncedAt" TIMESTAMP(3),
ADD COLUMN     "managedVersion" INTEGER;

