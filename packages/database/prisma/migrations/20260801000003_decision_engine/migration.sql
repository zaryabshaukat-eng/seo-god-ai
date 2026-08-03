-- CreateTable
CREATE TABLE "Decision" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "recommendationIds" JSONB NOT NULL,
    "recommendations" JSONB NOT NULL,
    "context" JSONB NOT NULL,
    "summary" JSONB NOT NULL,
    "planId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Decision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExecutionPlan" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "estimatedDurationMinutes" INTEGER NOT NULL,
    "totalEffortHours" DOUBLE PRECISION NOT NULL,
    "totalImpact" DOUBLE PRECISION NOT NULL,
    "risk" TEXT NOT NULL,
    "approvalRequestId" TEXT,
    "orderedTaskIds" JSONB NOT NULL,
    "dependencies" JSONB NOT NULL,
    "batches" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExecutionPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExecutionTask" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "recommendationId" TEXT NOT NULL,
    "rule" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "resourceRef" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "priority" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "dependsOn" JSONB NOT NULL,
    "isMutating" BOOLEAN NOT NULL,
    "risk" TEXT NOT NULL,
    "estimatedSeconds" INTEGER NOT NULL,
    "rollback" JSONB,
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExecutionTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanApprovalRequest" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "policy" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlanApprovalRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RollbackRecord" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "steps" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RollbackRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Decision_storeId_status_idx" ON "Decision"("storeId", "status");

-- CreateIndex
CREATE INDEX "Decision_storeId_createdAt_idx" ON "Decision"("storeId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ExecutionPlan_decisionId_version_key" ON "ExecutionPlan"("decisionId", "version");

-- CreateIndex
CREATE INDEX "ExecutionPlan_storeId_status_idx" ON "ExecutionPlan"("storeId", "status");

-- CreateIndex
CREATE INDEX "ExecutionTask_planId_idx" ON "ExecutionTask"("planId");

-- CreateIndex
CREATE INDEX "ExecutionTask_storeId_status_idx" ON "ExecutionTask"("storeId", "status");

-- CreateIndex
CREATE INDEX "PlanApprovalRequest_storeId_status_idx" ON "PlanApprovalRequest"("storeId", "status");

-- CreateIndex
CREATE INDEX "PlanApprovalRequest_planId_idx" ON "PlanApprovalRequest"("planId");

-- CreateIndex
CREATE INDEX "RollbackRecord_storeId_status_idx" ON "RollbackRecord"("storeId", "status");

-- CreateIndex
CREATE INDEX "RollbackRecord_planId_idx" ON "RollbackRecord"("planId");
