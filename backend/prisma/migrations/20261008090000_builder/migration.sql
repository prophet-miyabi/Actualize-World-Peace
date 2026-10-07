-- AlterTable
ALTER TABLE "LandingPage" ADD COLUMN     "brief" JSONB;

-- CreateTable
CREATE TABLE "BuilderSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "messages" JSONB NOT NULL,
    "brief" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "lpId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BuilderSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BuilderSession_userId_idx" ON "BuilderSession"("userId");

-- AddForeignKey
ALTER TABLE "BuilderSession" ADD CONSTRAINT "BuilderSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

