-- CreateTable
CREATE TABLE "HarnessAddon" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "harness" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "priceYen" INTEGER,
    "isInstall" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HarnessAddon_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HarnessOrder" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "totalYen" INTEGER NOT NULL,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'requested',
    "paymentStatus" TEXT NOT NULL DEFAULT 'unpaid',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HarnessOrder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HarnessAddon_key_key" ON "HarnessAddon"("key");

-- CreateIndex
CREATE INDEX "HarnessOrder_userId_idx" ON "HarnessOrder"("userId");

-- AddForeignKey
ALTER TABLE "HarnessOrder" ADD CONSTRAINT "HarnessOrder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

