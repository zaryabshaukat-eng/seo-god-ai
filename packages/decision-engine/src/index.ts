// Decision engine types
export type {
  DecisionSource,
  DecisionStatus,
  DecisionSummary,
  Decision,
} from './types/decision.js';
export type {
  DecisionRecommendation,
  RiskTolerance,
  ApprovalMode,
  StoreSettings,
  HistoricalOutcome,
  FeatureFlags,
  GraphContext,
  DecisionContext,
  DecisionEngineInput,
} from './types/input.js';
export type {
  ResourceType,
  TaskActionType,
  TaskStatus,
  PlanStatus,
  ExecutionTask,
  ExecutionBatch,
  PlanDependency,
  ExecutionPlan,
} from './types/plan.js';
export type {
  RiskLevel,
  ExecutionResultStatus,
  RollbackStatus,
  ExecutionResult,
  RollbackStepAction,
  RollbackStep,
  RollbackPlan,
  RollbackRecord,
} from './types/result.js';
export type {
  ApprovalPolicyType,
  ApprovalRequestStatus,
  ApprovalRequest,
} from './types/approval.js';
export type {
  ConflictKind,
  ConflictSeverity,
  Conflict,
  ConflictReport,
} from './types/conflict.js';
export type {
  ScoreBreakdown,
  PrioritizedRecommendation,
} from './types/prioritizer.js';
export type {
  ExecutionPolicyType,
  RiskAssessment,
  RiskFactors,
} from './types/safety.js';
export type {
  PlanExecutor,
  DecisionEngineResult,
  PlanResult,
  ApprovalResult,
  ExecutionPlanResult,
  RollbackResult,
} from './types/service.js';

// Utils
export {
  deterministicUuid,
  newId,
  isUuid,
} from './utils/ids.js';
export {
  clamp,
  weightedSum,
  reachFactor,
  smoothedRate,
} from './utils/scoring.js';
export { validateDecisionInput } from './utils/validation.js';

// Scoring
export {
  DEFAULT_PRIORITIZER_WEIGHTS,
  impactFactor,
  easeFactor,
  reachFactorFor,
  businessValueFactor,
  historicalEffectivenessFactor,
  scoreRecommendation,
} from './scoring/prioritization-score.js';
export type {
  PrioritizerWeights,
  ScoredRecommendation,
} from './scoring/prioritization-score.js';

// Prioritizer
export {
  decisionContextFromInput,
  comparePrioritized,
  Prioritizer,
} from './prioritizer/prioritizer.js';
export type { PrioritizerOptions } from './prioritizer/prioritizer.js';

// Dependency graph
export { DependencyGraph } from './dependency-graph/dependency-graph.js';
export type { DependencyEdge } from './dependency-graph/dependency-graph.js';

// Conflict detection
export { ConflictDetector } from './conflict-detector/conflict-detector.js';
export type {
  ConflictContext,
  ConflictDetectorOptions,
} from './conflict-detector/conflict-detector.js';

// Safety
export {
  isMutatingAction,
  isDestructiveAction,
  hasRollbackPotential,
  riskToleranceAdjustment,
  SafetyEngine,
} from './safety/safety-engine.js';
export type { SafetyEngineOptions } from './safety/safety-engine.js';

// Policies
export {
  APPROVAL_POLICY_RULES,
  resolveApprovalPolicy,
} from './policies/approval-policies.js';
export type {
  ApprovalPolicyRule,
  ApprovalPolicyContext,
  PolicyResolution,
} from './policies/approval-policies.js';
export {
  resolveExecutionPolicy,
  executionPolicyConstraints,
} from './policies/execution-policies.js';
export type { ExecutionPolicyInput } from './policies/execution-policies.js';

// Rollback
export { RollbackPlanGenerator } from './execution-plan/rollback.js';

// Batching
export { Batcher } from './batcher/batcher.js';
export type {
  BatcherOptions,
  GroupTasksInput,
} from './batcher/batcher.js';

// Planner
export {
  DEFAULT_RULE_ACTION_MAP,
  planIdForDecision,
  taskIdFor,
  resourceTypeFromUrl,
  ExecutionPlanner,
} from './planner/planner.js';
export type {
  PlannerOptions,
  CreateTasksInput,
  AssembleInput,
  AssembleResult,
} from './planner/planner.js';

// Approval
export { ApprovalEngine } from './approval/approval-engine.js';
export type {
  ApprovalReviewInput,
  ApprovalReviewResult,
} from './approval/approval-engine.js';

// Models
export { DecisionModel } from './models/decision.js';
export type { DecisionCreateInput } from './models/decision.js';
export { DecisionSummaryModel } from './models/decision-summary.js';
export { ExecutionPlanModel } from './models/execution-plan.js';
export type { ExecutionPlanCreateInput } from './models/execution-plan.js';
export { ExecutionTaskModel } from './models/execution-task.js';
export { ExecutionBatchModel } from './models/execution-batch.js';
export { ApprovalRequestModel } from './models/approval-request.js';
export type { ApprovalRequestCreateInput } from './models/approval-request.js';
export {
  RollbackRecordModel,
  planRolledBack,
} from './models/rollback-record.js';
export type { RollbackRecordCreateInput } from './models/rollback-record.js';

// Persistence
export {
  toStoredJson,
  PrismaDecisionRepository,
} from './repositories/decision-repository.js';
export type { DecisionRepository } from './repositories/decision-repository.js';

// Service
export { DecisionEngineService } from './services/decision-engine-service.js';
export type {
  DecisionEngineServiceOptions,
  PlanDecisionOptions,
  RollbackOptions,
} from './services/decision-engine-service.js';
