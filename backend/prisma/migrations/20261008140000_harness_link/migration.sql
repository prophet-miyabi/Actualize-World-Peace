-- CreateTable
CREATE TABLE "HarnessLink" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "apiKeyEnc" TEXT NOT NULL,
    "accountId" TEXT,
    "accountLabel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HarnessLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HarnessScheduledPost" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "remoteId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HarnessScheduledPost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HarnessLink_userId_kind_key" ON "HarnessLink"("userId", "kind");

-- CreateIndex
CREATE INDEX "HarnessScheduledPost_userId_createdAt_idx" ON "HarnessScheduledPost"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "HarnessLink" ADD CONSTRAINT "HarnessLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HarnessScheduledPost" ADD CONSTRAINT "HarnessScheduledPost_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

