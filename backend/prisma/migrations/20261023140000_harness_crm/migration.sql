-- AlterTable
ALTER TABLE "CompanyTask" ADD COLUMN     "budgetDay" TEXT,
ADD COLUMN     "estimateMin" INTEGER,
ADD COLUMN     "ownerPriority" INTEGER;

-- CreateTable
CREATE TABLE "CrmContact" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "cid" TEXT NOT NULL,
    "displayName" TEXT,
    "lineUserId" TEXT,
    "xUserId" TEXT,
    "igUserId" TEXT,
    "tiktokUserId" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "source" TEXT NOT NULL DEFAULT 'lp',
    "stage" TEXT NOT NULL DEFAULT 'lead',
    "leadScore" INTEGER NOT NULL DEFAULT 0,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmTag" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmContactTag" (
    "contactId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmContactTag_pkey" PRIMARY KEY ("contactId","tagId")
);

-- CreateTable
CREATE TABLE "CrmScenario" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'line',
    "trigger" TEXT NOT NULL DEFAULT 'manual',
    "triggerRef" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmScenario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmScenarioStep" (
    "id" TEXT NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "delayMinutes" INTEGER NOT NULL DEFAULT 0,
    "template" TEXT NOT NULL,
    "mediaUrl" TEXT,
    "linkPath" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmScenarioStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmScenarioEnrollment" (
    "id" TEXT NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "currentStep" INTEGER NOT NULL DEFAULT 0,
    "nextAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmScenarioEnrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EngagementGate" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "postExternalId" TEXT,
    "replyTemplate" TEXT NOT NULL,
    "linkPath" TEXT,
    "scenarioId" TEXT,
    "tagName" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "hits" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EngagementGate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmAutomationRule" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "conditions" JSONB,
    "actions" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "fired" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmAutomationRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelAccountPool" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "socialAccountId" TEXT,
    "label" TEXT NOT NULL,
    "healthScore" INTEGER NOT NULL DEFAULT 100,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "sentToday" INTEGER NOT NULL DEFAULT 0,
    "sentDay" TEXT,
    "dailyLimit" INTEGER NOT NULL DEFAULT 200,
    "minIntervalMs" INTEGER NOT NULL DEFAULT 2500,
    "cooldownUntil" TIMESTAMP(3),
    "lastErrorAt" TIMESTAMP(3),
    "lastError" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChannelAccountPool_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmContactEvent" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "channel" TEXT,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmContactEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CrmContact_cid_key" ON "CrmContact"("cid");

-- CreateIndex
CREATE INDEX "CrmContact_ownerId_leadScore_idx" ON "CrmContact"("ownerId", "leadScore");

-- CreateIndex
CREATE INDEX "CrmContact_ownerId_stage_idx" ON "CrmContact"("ownerId", "stage");

-- CreateIndex
CREATE UNIQUE INDEX "CrmContact_ownerId_lineUserId_key" ON "CrmContact"("ownerId", "lineUserId");

-- CreateIndex
CREATE UNIQUE INDEX "CrmTag_ownerId_name_key" ON "CrmTag"("ownerId", "name");

-- CreateIndex
CREATE INDEX "CrmScenario_ownerId_idx" ON "CrmScenario"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "CrmScenarioStep_scenarioId_order_key" ON "CrmScenarioStep"("scenarioId", "order");

-- CreateIndex
CREATE INDEX "CrmScenarioEnrollment_status_nextAt_idx" ON "CrmScenarioEnrollment"("status", "nextAt");

-- CreateIndex
CREATE UNIQUE INDEX "CrmScenarioEnrollment_scenarioId_contactId_key" ON "CrmScenarioEnrollment"("scenarioId", "contactId");

-- CreateIndex
CREATE INDEX "EngagementGate_ownerId_channel_active_idx" ON "EngagementGate"("ownerId", "channel", "active");

-- CreateIndex
CREATE INDEX "CrmAutomationRule_ownerId_event_active_idx" ON "CrmAutomationRule"("ownerId", "event", "active");

-- CreateIndex
CREATE INDEX "ChannelAccountPool_ownerId_channel_active_idx" ON "ChannelAccountPool"("ownerId", "channel", "active");

-- CreateIndex
CREATE INDEX "CrmContactEvent_contactId_createdAt_idx" ON "CrmContactEvent"("contactId", "createdAt");

-- AddForeignKey
ALTER TABLE "CrmContactTag" ADD CONSTRAINT "CrmContactTag_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "CrmContact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmContactTag" ADD CONSTRAINT "CrmContactTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "CrmTag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmScenarioStep" ADD CONSTRAINT "CrmScenarioStep_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "CrmScenario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmScenarioEnrollment" ADD CONSTRAINT "CrmScenarioEnrollment_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "CrmScenario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmScenarioEnrollment" ADD CONSTRAINT "CrmScenarioEnrollment_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "CrmContact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EngagementGate" ADD CONSTRAINT "EngagementGate_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "CrmScenario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmContactEvent" ADD CONSTRAINT "CrmContactEvent_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "CrmContact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

