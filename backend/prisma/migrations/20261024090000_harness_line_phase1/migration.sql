-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "contactId" TEXT;

-- AlterTable
ALTER TABLE "CrmContact" ADD COLUMN     "assignee" TEXT,
ADD COLUMN     "blocked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "fields" JSONB,
ADD COLUMN     "handledAt" TIMESTAMP(3),
ADD COLUMN     "lastInboundAt" TIMESTAMP(3),
ADD COLUMN     "lineAccountId" TEXT,
ADD COLUMN     "unreadCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "CrmScenario" ADD COLUMN     "lineAccountId" TEXT;

-- AlterTable
ALTER TABLE "CrmScenarioStep" ADD COLUMN     "condition" JSONB,
ADD COLUMN     "message" JSONB,
ADD COLUMN     "onSkip" TEXT NOT NULL DEFAULT 'next';

-- AlterTable
ALTER TABLE "EngagementGate" ADD COLUMN     "replyMessage" JSONB,
ADD COLUMN     "surveyId" TEXT;

-- CreateTable
CREATE TABLE "CrmLineAccount" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "channelSecret" TEXT NOT NULL,
    "channelAccessToken" TEXT NOT NULL,
    "botBasicId" TEXT,
    "webhookActivated" BOOLEAN NOT NULL DEFAULT false,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "healthScore" INTEGER NOT NULL DEFAULT 100,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "sentToday" INTEGER NOT NULL DEFAULT 0,
    "sentDay" TEXT,
    "cooldownUntil" TIMESTAMP(3),
    "lastError" TEXT,
    "lastErrorAt" TIMESTAMP(3),
    "friendsAdded" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmLineAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmMessage" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "lineAccountId" TEXT,
    "direction" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'text',
    "text" TEXT,
    "payload" JSONB,
    "source" TEXT,
    "status" TEXT NOT NULL DEFAULT 'received',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmDelivery" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "lineAccountId" TEXT,
    "kind" TEXT NOT NULL,
    "refId" TEXT,
    "ok" BOOLEAN NOT NULL,
    "error" TEXT,
    "templateHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmBroadcast" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "lineAccountId" TEXT,
    "name" TEXT NOT NULL,
    "audience" JSONB NOT NULL,
    "message" JSONB NOT NULL,
    "scheduledAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'draft',
    "targetCount" INTEGER NOT NULL DEFAULT 0,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmBroadcast_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmReminder" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "lineAccountId" TEXT,
    "name" TEXT NOT NULL,
    "basis" TEXT NOT NULL DEFAULT 'booking',
    "basisRef" TEXT,
    "offsetMinutes" INTEGER NOT NULL,
    "message" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmReminder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmReminderSend" (
    "id" TEXT NOT NULL,
    "reminderId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "refKey" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmReminderSend_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmSurvey" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "questions" JSONB NOT NULL,
    "onComplete" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "starts" INTEGER NOT NULL DEFAULT 0,
    "completes" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmSurvey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmSurveyAnswer" (
    "id" TEXT NOT NULL,
    "surveyId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "answers" JSONB NOT NULL,
    "currentIdx" INTEGER NOT NULL DEFAULT 0,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmSurveyAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CrmLineAccount_ownerId_idx" ON "CrmLineAccount"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "CrmLineAccount_ownerId_channelId_key" ON "CrmLineAccount"("ownerId", "channelId");

-- CreateIndex
CREATE INDEX "CrmMessage_ownerId_createdAt_idx" ON "CrmMessage"("ownerId", "createdAt");

-- CreateIndex
CREATE INDEX "CrmMessage_contactId_createdAt_idx" ON "CrmMessage"("contactId", "createdAt");

-- CreateIndex
CREATE INDEX "CrmDelivery_ownerId_createdAt_idx" ON "CrmDelivery"("ownerId", "createdAt");

-- CreateIndex
CREATE INDEX "CrmDelivery_refId_idx" ON "CrmDelivery"("refId");

-- CreateIndex
CREATE INDEX "CrmBroadcast_ownerId_createdAt_idx" ON "CrmBroadcast"("ownerId", "createdAt");

-- CreateIndex
CREATE INDEX "CrmBroadcast_status_scheduledAt_idx" ON "CrmBroadcast"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "CrmReminder_ownerId_idx" ON "CrmReminder"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "CrmReminderSend_reminderId_refKey_key" ON "CrmReminderSend"("reminderId", "refKey");

-- CreateIndex
CREATE INDEX "CrmSurvey_ownerId_idx" ON "CrmSurvey"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "CrmSurveyAnswer_surveyId_contactId_key" ON "CrmSurveyAnswer"("surveyId", "contactId");

-- AddForeignKey
ALTER TABLE "CrmMessage" ADD CONSTRAINT "CrmMessage_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "CrmContact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmDelivery" ADD CONSTRAINT "CrmDelivery_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "CrmContact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmReminderSend" ADD CONSTRAINT "CrmReminderSend_reminderId_fkey" FOREIGN KEY ("reminderId") REFERENCES "CrmReminder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmSurveyAnswer" ADD CONSTRAINT "CrmSurveyAnswer_surveyId_fkey" FOREIGN KEY ("surveyId") REFERENCES "CrmSurvey"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmSurveyAnswer" ADD CONSTRAINT "CrmSurveyAnswer_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "CrmContact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

