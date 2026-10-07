-- CreateTable
CREATE TABLE "ToolCatalogItem" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "officialUrl" TEXT NOT NULL,
    "affiliateUrl" TEXT,
    "allowedHosts" TEXT[],
    "embeddable" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ToolCatalogItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LpTool" (
    "id" TEXT NOT NULL,
    "lpId" TEXT NOT NULL,
    "toolKey" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "display" TEXT NOT NULL DEFAULT 'button',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LpTool_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AffiliateClick" (
    "id" TEXT NOT NULL,
    "toolKey" TEXT NOT NULL,
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AffiliateClick_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ToolCatalogItem_key_key" ON "ToolCatalogItem"("key");

-- CreateIndex
CREATE INDEX "LpTool_lpId_idx" ON "LpTool"("lpId");

-- CreateIndex
CREATE INDEX "AffiliateClick_toolKey_idx" ON "AffiliateClick"("toolKey");

-- AddForeignKey
ALTER TABLE "LpTool" ADD CONSTRAINT "LpTool_lpId_fkey" FOREIGN KEY ("lpId") REFERENCES "LandingPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
