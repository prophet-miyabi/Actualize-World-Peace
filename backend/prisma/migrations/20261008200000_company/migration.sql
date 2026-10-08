-- CreateTable
CREATE TABLE "CompanyGoal" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "kpis" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "setBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyGoal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyTask" (
    "id" TEXT NOT NULL,
    "goalId" TEXT,
    "parentId" TEXT,
    "title" TEXT NOT NULL,
    "instructions" TEXT NOT NULL,
    "assignee" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "risk" TEXT NOT NULL DEFAULT 'low',
    "status" TEXT NOT NULL DEFAULT 'queued',
    "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "result" JSONB,
    "verification" JSONB,
    "error" TEXT,
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyAction" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "agent" TEXT NOT NULL,
    "tool" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "risk" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "result" JSONB,
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyEvent" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "taskId" TEXT,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyMemory" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "updatedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyMemory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL,
    "agent" TEXT NOT NULL,
    "taskId" TEXT,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "toolCalls" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyAgentConfig" (
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "model" TEXT,
    "dailyBudgetUsd" DOUBLE PRECISION,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyAgentConfig_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "CompanyTask_status_runAt_idx" ON "CompanyTask"("status", "runAt");

-- CreateIndex
CREATE INDEX "CompanyTask_assignee_createdAt_idx" ON "CompanyTask"("assignee", "createdAt");

-- CreateIndex
CREATE INDEX "CompanyTask_parentId_idx" ON "CompanyTask"("parentId");

-- CreateIndex
CREATE INDEX "CompanyAction_status_createdAt_idx" ON "CompanyAction"("status", "createdAt");

-- CreateIndex
CREATE INDEX "CompanyEvent_createdAt_idx" ON "CompanyEvent"("createdAt");

-- CreateIndex
CREATE INDEX "CompanyMemory_scope_idx" ON "CompanyMemory"("scope");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyMemory_scope_key_key" ON "CompanyMemory"("scope", "key");

-- CreateIndex
CREATE INDEX "AgentRun_agent_startedAt_idx" ON "AgentRun"("agent", "startedAt");

-- AddForeignKey
ALTER TABLE "CompanyTask" ADD CONSTRAINT "CompanyTask_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "CompanyGoal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyAction" ADD CONSTRAINT "CompanyAction_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "CompanyTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "CompanyTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;

