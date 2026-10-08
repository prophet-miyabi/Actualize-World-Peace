-- CreateTable
CREATE TABLE "CompanyChat" (
    "id" TEXT NOT NULL,
    "agent" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "messages" JSONB NOT NULL,
    "taskId" TEXT,
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyChat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CompanyChat_updatedAt_idx" ON "CompanyChat"("updatedAt");

