-- AlterTable
ALTER TABLE "CrawlJob" ADD COLUMN     "error" TEXT,
ADD COLUMN     "seeds" JSONB,
ADD COLUMN     "statistics" JSONB;

-- AlterTable
ALTER TABLE "Page" ADD COLUMN     "canonicalUrl" TEXT,
ADD COLUMN     "charset" TEXT,
ADD COLUMN     "contentType" TEXT,
ADD COLUMN     "favicon" TEXT,
ADD COLUMN     "finalUrl" TEXT,
ADD COLUMN     "htmlSizeBytes" INTEGER,
ADD COLUMN     "lang" TEXT,
ADD COLUMN     "metaRobots" TEXT,
ADD COLUMN     "ogTags" JSONB,
ADD COLUMN     "pageSizeBytes" INTEGER,
ADD COLUMN     "redirectChain" JSONB,
ADD COLUMN     "responseTimeMs" INTEGER,
ADD COLUMN     "robotsBlocked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "scriptCount" INTEGER,
ADD COLUMN     "stylesheetCount" INTEGER,
ADD COLUMN     "themeColor" TEXT,
ADD COLUMN     "ttfbMs" INTEGER,
ADD COLUMN     "twitterTags" JSONB;

-- CreateTable
CREATE TABLE "PageLink" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "href" TEXT NOT NULL,
    "anchorText" TEXT,
    "rel" TEXT,
    "isInternal" BOOLEAN NOT NULL,
    "isImage" BOOLEAN NOT NULL DEFAULT false,
    "statusCode" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PageLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PageStructuredData" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "schemaType" TEXT,
    "valid" BOOLEAN NOT NULL DEFAULT true,
    "raw" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PageStructuredData_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PageLink_pageId_idx" ON "PageLink"("pageId");

-- CreateIndex
CREATE INDEX "PageLink_href_idx" ON "PageLink"("href");

-- CreateIndex
CREATE INDEX "PageStructuredData_pageId_idx" ON "PageStructuredData"("pageId");

-- AddForeignKey
ALTER TABLE "PageLink" ADD CONSTRAINT "PageLink_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PageStructuredData" ADD CONSTRAINT "PageStructuredData_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;