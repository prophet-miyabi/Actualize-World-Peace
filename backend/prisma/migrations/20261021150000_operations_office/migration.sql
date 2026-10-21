-- AlterTable
ALTER TABLE "CompanyTask" ADD COLUMN     "approvalRequired" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "doneCriteria" TEXT,
ADD COLUMN     "dueAt" TIMESTAMP(3),
ADD COLUMN     "feature" TEXT,
ADD COLUMN     "kpi" TEXT,
ADD COLUMN     "loopRunId" TEXT,
ADD COLUMN     "pausedAt" TIMESTAMP(3),
ADD COLUMN     "priority" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "recurrence" TEXT,
ADD COLUMN     "role" TEXT,
ADD COLUMN     "services" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "AgentLoopDefinition" (
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "department" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "steps" JSONB NOT NULL,
    "schedule" TEXT,
    "autoRun" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentLoopDefinition_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "AgentLoopRun" (
    "id" TEXT NOT NULL,
    "loopKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "currentStep" INTEGER NOT NULL DEFAULT 0,
    "startedBy" TEXT NOT NULL,
    "stats" JSONB,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "AgentLoopRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentApproval" (
    "id" TEXT NOT NULL,
    "taskId" TEXT,
    "loopRunId" TEXT,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "options" JSONB NOT NULL,
    "impact" TEXT NOT NULL,
    "payload" JSONB,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "decision" TEXT,
    "note" TEXT,
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentMetric" (
    "id" TEXT NOT NULL,
    "agent" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "done" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "avgMs" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "health" INTEGER NOT NULL DEFAULT 100,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OperationsAlert" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "taskId" TEXT,
    "agent" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OperationsAlert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentLoopRun_loopKey_startedAt_idx" ON "AgentLoopRun"("loopKey", "startedAt");

-- CreateIndex
CREATE INDEX "AgentApproval_status_createdAt_idx" ON "AgentApproval"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AgentMetric_agent_day_key" ON "AgentMetric"("agent", "day");

-- CreateIndex
CREATE UNIQUE INDEX "OperationsAlert_key_key" ON "OperationsAlert"("key");

-- CreateIndex
CREATE INDEX "OperationsAlert_status_createdAt_idx" ON "OperationsAlert"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "CompanyTask" ADD CONSTRAINT "CompanyTask_loopRunId_fkey" FOREIGN KEY ("loopRunId") REFERENCES "AgentLoopRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentLoopRun" ADD CONSTRAINT "AgentLoopRun_loopKey_fkey" FOREIGN KEY ("loopKey") REFERENCES "AgentLoopDefinition"("key") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentApproval" ADD CONSTRAINT "AgentApproval_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "CompanyTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

