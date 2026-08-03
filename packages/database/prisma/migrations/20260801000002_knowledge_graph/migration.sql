-- CreateTable
CREATE TABLE "GraphSnapshot" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "label" TEXT,
    "source" TEXT NOT NULL,
    "previousSnapshotId" TEXT,
    "summary" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GraphSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GraphNode" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT,
    "properties" JSONB,
    "source" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GraphNode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GraphEdge" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "sourceNodeId" TEXT NOT NULL,
    "targetNodeId" TEXT NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "source" TEXT NOT NULL,
    "properties" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GraphEdge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GraphSnapshot_storeId_createdAt_idx" ON "GraphSnapshot"("storeId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "GraphSnapshot_storeId_version_key" ON "GraphSnapshot"("storeId", "version");

-- CreateIndex
CREATE INDEX "GraphNode_storeId_type_idx" ON "GraphNode"("storeId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "GraphNode_snapshotId_type_externalId_key" ON "GraphNode"("snapshotId", "type", "externalId");

-- CreateIndex
CREATE INDEX "GraphEdge_snapshotId_sourceNodeId_idx" ON "GraphEdge"("snapshotId", "sourceNodeId");

-- CreateIndex
CREATE INDEX "GraphEdge_snapshotId_targetNodeId_idx" ON "GraphEdge"("snapshotId", "targetNodeId");

-- CreateIndex
CREATE INDEX "GraphEdge_storeId_type_idx" ON "GraphEdge"("storeId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "GraphEdge_snapshotId_type_sourceNodeId_targetNodeId_key" ON "GraphEdge"("snapshotId", "type", "sourceNodeId", "targetNodeId");

-- AddForeignKey
ALTER TABLE "GraphNode" ADD CONSTRAINT "GraphNode_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "GraphSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GraphEdge" ADD CONSTRAINT "GraphEdge_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "GraphSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GraphEdge" ADD CONSTRAINT "GraphEdge_sourceNodeId_fkey" FOREIGN KEY ("sourceNodeId") REFERENCES "GraphNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GraphEdge" ADD CONSTRAINT "GraphEdge_targetNodeId_fkey" FOREIGN KEY ("targetNodeId") REFERENCES "GraphNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

