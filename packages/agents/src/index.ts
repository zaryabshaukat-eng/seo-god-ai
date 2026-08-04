export const packageName = '@seogod/agents' as const;

// Types
export type {
  AgentDefinition,
  AgentHealth,
  AgentHealthStatus,
} from './types/agent.js';
export type { AgentEntityInput, AgentInput } from './types/input.js';
export type {
  AgentAction,
  AgentActionType,
  AgentRecommendation,
  AgentResourceType,
  AgentResult,
  AgentRisk,
  AgentStatus,
  ImplementationDifficulty,
  RecommendationEvidence,
  Severity,
} from './types/output.js';
export { KNOWN_ACTION_TYPES, KNOWN_RESOURCE_TYPES } from './types/output.js';
export type { AgentContext, ContextBudget, ContextSection } from './types/context.js';
export type {
  AgentRunRecord,
  FeedbackRecord,
  MemoryEntry,
  MemoryKind,
  MemoryQuery,
  ValidationFailureRecord,
} from './types/memory.js';
export type { AgentEvent, AgentEventType } from './types/events.js';
export type { JsonSchema, SchemaProperty, SchemaType } from './types/schema.js';
export type { ValidationCode, ValidationFailure } from './types/validation.js';

// Interfaces
export type { Agent } from './interfaces/agent.js';

// Base
export {
  BaseAgent,
  type ActionOptions,
  type RecommendationOptions,
  type ResultOptions,
} from './base/base-agent.js';
export { AGENT_INPUT_SCHEMA, AGENT_OUTPUT_SCHEMA, ENTITY_SCHEMA } from './base/agent-schemas.js';

// Utils
export { AgentError, SafetyViolationError } from './utils/errors.js';
export { deterministicUuid, isUuid, newId } from './utils/ids.js';
export { clamp, slugify, truncate, wordCount } from './utils/text.js';

// Models
export { AgentRunModel, type BuildAgentRunOptions } from './models/agent-run.js';
export { MemoryEntryModel } from './models/memory-entry.js';

// Prompts
export { PROMPTS, type PromptTemplate } from './prompts/templates.js';
export { PromptLoaderImpl, renderPrompt, type PromptLoader } from './prompts/prompt-loader.js';

// Validation
export { firstMessage, isValid, validateSchema, type SchemaViolation } from './validation/schema.js';
export { OutputValidator } from './validation/output-validator.js';

// Safety
export {
  DESTRUCTIVE_ACTION_TYPES,
  PUBLISHING_ACTION_TYPES,
  REJECTED_ACTION_TYPES,
  SENSITIVE_ACTION_TYPES,
  isRejectedActionType,
  isSensitiveActionType,
} from './safety/action-policy.js';
export { DefaultSafetyGuard, type SafetyGuard } from './safety/safety-guard.js';

// Context
export {
  ContextBuilderImpl,
  estimateTokens,
  type BuildContextOptions,
  type ContextBuilder,
} from './context/context-builder.js';

// Memory
export {
  AgentMemory,
  type AgentMemoryStore,
  type RecordFeedbackParams,
  type RecordHistoryParams,
  type RecordValidationFailureParams,
} from './memory/agent-memory.js';

// Repositories
export {
  InMemoryAgentRepository,
  type AgentRepository,
  type PerformanceSnapshot,
  type RunFilter,
} from './repositories/agent-repository.js';

// Registry
export { AgentRegistry } from './registry/agent-registry.js';
export { DEFAULT_AGENTS, buildDefaultRegistry } from './registry/default-registry.js';

// Service
export { AgentService, type AgentInvokeResult, type AgentServiceOptions, type InvokeOptions } from './service/agent-service.js';

// Agents
export { MetadataAgent } from './metadata/metadata-agent.js';
export { TechnicalSeoAgent } from './technical-seo/technical-seo-agent.js';
export { ContentAgent } from './content/content-agent.js';
export { KeywordAgent } from './keyword/keyword-agent.js';
export { InternalLinkingAgent } from './internal-linking/internal-linking-agent.js';
export { SchemaAgent } from './schema/schema-agent.js';
export { ImageSeoAgent } from './image-seo/image-seo-agent.js';
export { ProductAgent } from './product/product-agent.js';
export { CollectionAgent } from './collections/collection-agent.js';
export { BlogAgent } from './blog/blog-agent.js';
export { PageAgent } from './page/page-agent.js';
export { ReportingAgent } from './reporting/reporting-agent.js';
export { AnalyticsAgent } from './analytics/analytics-agent.js';
