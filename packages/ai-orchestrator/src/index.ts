/**
 * @seogod/ai-orchestrator
 *
 * Coordinates specialist agents into deterministic, validated, recoverable
 * workflows. The orchestrator holds no SEO business logic — every decision
 * arrives from the decision engine as an {@link ExecutionPlan} and agents are
 * black boxes behind a provider abstraction.
 */

// Errors
export {
  OrchestratorError,
  TimeoutError,
  CancelledError,
  ValidationFailedError,
  SafetyViolationError,
  UnsupportedProviderError,
} from './errors.js';

// Orchestrator facade
export { Orchestrator } from './orchestrator/orchestrator.js';
export type {
  OrchestratorOptions,
  StartWorkflowOptions,
  RunAgentTaskOptions,
} from './orchestrator/orchestrator.js';

// Registry
export { AgentRegistry } from './registry/agent-registry.js';
export type { AgentRegistryOptions } from './registry/agent-registry.js';

// Planner
export { WorkflowPlanner, defaultTaskSchema } from './planner/workflow-planner.js';
export type { WorkflowPlannerOptions } from './planner/workflow-planner.js';

// Workflow engine
export { WorkflowEngine, validateDefinition } from './workflow/workflow-engine.js';
export type {
  WorkflowEngineOptions,
  RunWorkflowOptions,
  WorkflowResult,
  AgentTaskFactory,
} from './workflow/workflow-engine.js';

// Execution engine
export { ExecutionEngine } from './execution/execution-engine.js';
export type {
  ExecutionEngineOptions,
  AgentStepContext,
  AgentStepResult,
} from './execution/execution-engine.js';

// Agent runner
export { AgentRunner } from './execution/agent-runner.js';
export type { AgentExecutor, AgentExecutorOptions, AgentRunnerOptions } from './execution/agent-runner.js';

// Rate limiter + scheduler
export { RateLimiter } from './execution/rate-limiter.js';
export type { RateLimiterOptions } from './execution/rate-limiter.js';
export { Scheduler } from './scheduler/scheduler.js';
export type { SchedulerOptions, ScheduleOptions } from './scheduler/scheduler.js';

// Context + prompts
export { ContextBuilder, estimateTokens } from './context/context-builder.js';
export type { BuildContextOptions } from './context/context-builder.js';
export { PromptBuilder } from './prompts/prompt-builder.js';
export {
  DEFAULT_TEMPLATES,
  AGENT_TASK_TEMPLATE,
  AGENT_SUMMARY_TEMPLATE,
  SYSTEM_CONTEXT_TEMPLATE,
} from './prompts/templates.js';

// Validation + safety
export { matchSchema } from './validation/schema.js';
export { ResponseValidator } from './validation/response-validator.js';
export type { ResponseValidatorOptions } from './validation/response-validator.js';
export { SafetyGuard } from './safety/safety-guard.js';
export type { SafetyGuardOptions, AgentOutput } from './safety/safety-guard.js';
export { isSupportedAction, isUnsafeAction } from './safety/action-policy.js';

// Memory + repository
export { InMemoryMemoryStore } from './memory/memory-store.js';
export type { MemoryStore } from './memory/memory-store.js';
export { InMemoryOrchestratorRepository } from './repositories/in-memory-repository.js';

// Providers
export { OpenAIProvider } from './providers/openai-provider.js';
export { DefaultProviderFactory } from './providers/provider-factory.js';
export type {
  ProviderFactory,
  ProviderFactoryOptions,
} from './providers/provider-factory.js';
export type { FetchLike, OpenAiResponsePayload } from './providers/openai-provider.js';

// Models
export { AgentExecutionModel } from './models/agent-execution.js';
export { WorkflowExecutionModel, countAgentSteps } from './models/workflow-execution.js';
export { ExecutionTraceModel } from './models/execution-trace.js';
export { ExecutionReportModel } from './models/execution-report.js';

// Utils
export { deterministicUuid, newId, isUuid } from './utils/ids.js';
export { parseJson, extractJson, stableStringify } from './utils/json.js';
export { resolvePath, resolveOutputs } from './utils/path.js';
export { estimateCost, MODEL_PRICING, DEFAULT_PRICING } from './utils/cost.js';
export { isRetryable, errorMessage, backoffDelay } from './utils/retry.js';
export type { BackoffOptions } from './utils/retry.js';
export { withTimeout, isAborted } from './utils/async.js';

// Types
export type { AgentDefinition, AgentHealth, AgentTask, AgentResult } from './types/agent.js';
export type { PromptContext, ContextSources, ContextSection, ContextBudget, ContextSectionKind } from './types/context.js';
export type { MemoryEntry, MemoryQuery, MemoryKind } from './types/memory.js';
export type {
  Provider,
  ProviderConfig,
  ProviderRequest,
  ProviderResponse,
  ProviderMessage,
  ProviderUsage,
  ProviderHealth,
  ProviderCallOptions,
  ProviderName,
} from './types/provider.js';
export type {
  ValidationSchema,
  ValidationIssue,
  ValidationResult,
} from './types/validation.js';
export type {
  WorkflowDefinition,
  WorkflowStep,
  AgentWorkflowStep,
  SequentialGroup,
  ParallelGroup,
  ConditionalStep,
  WorkflowCondition,
  WorkflowStatus,
  StepStatus,
  WorkflowStepKind,
} from './types/workflow.js';
export type {
  AgentExecution,
  StepExecution,
  WorkflowExecution,
  ExecutionTrace,
  TraceEvent,
  ExecutionReport,
  FailureDetail,
  AgentExecutionStatus,
} from './types/execution.js';
export type {
  OrchestratorEvent,
  EventSink,
  WorkflowStartedEvent,
  WorkflowCompletedEvent,
  AgentStartedEvent,
  AgentCompletedEvent,
  AgentFailedEvent,
  ValidationFailedEvent,
} from './types/events.js';
export type { AgentWorkflow, PlanWorkflowOptions } from './types/planner.js';
export type { OrchestratorRepository } from './types/repository.js';
export type { SafetyCheck, SafetyCheckId, SafetyDecision } from './types/safety.js';
export type { PromptTemplate, RenderPromptOptions } from './types/prompt.js';
