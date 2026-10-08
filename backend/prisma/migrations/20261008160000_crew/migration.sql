-- CreateTable
CREATE TABLE "CrewTask" (
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "area" TEXT NOT NULL,
    "epic" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "agents" TEXT[],
    "estimateMin" INTEGER NOT NULL,
    "remainingMin" INTEGER NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 2,
    "planDay" TEXT NOT NULL,
    "dueDay" TEXT,
    "dependsOn" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'todo',
    "steps" TEXT,
    "acceptance" TEXT NOT NULL,
    "notes" TEXT,
    "issueNumber" INTEGER,
    "issueUrl" TEXT,
    "branch" TEXT,
    "prNumber" INTEGER,
    "prUrl" TEXT,
    "reviewState" TEXT,
    "reviewRequestedAt" TIMESTAMP(3),
    "dispatchedAt" TIMESTAMP(3),
    "doneAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrewTask_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "CrewDayPlan" (
    "day" TEXT NOT NULL,
    "blocks" JSONB NOT NULL,
    "postedAt" TIMESTAMP(3),
    "reportedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrewDayPlan_pkey" PRIMARY KEY ("day")
);

-- CreateTable
CREATE TABLE "CrewState" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrewState_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "CrewLog" (
    "id" TEXT NOT NULL,
    "agent" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "taskKey" TEXT,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrewLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CrewTask_status_planDay_idx" ON "CrewTask"("status", "planDay");

-- CreateIndex
CREATE INDEX "CrewLog_createdAt_idx" ON "CrewLog"("createdAt");

