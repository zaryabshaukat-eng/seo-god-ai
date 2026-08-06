/**
 * `@seogod/ai-copilot` — conversational AI assistant for SEO GOD AI.
 *
 * A streaming chat loop with conversation memory, tool calling, prompt
 * management, audit logging and role-based permissions. Platform data is read
 * through narrow structural sources so the package never depends on the
 * platform runtime packages; adapters are provided for the orchestrator
 * provider, observability, learning-engine, reports, decision-engine and
 * enterprise services.
 */

export * from './types.js';
export * from './errors.js';
export * from './utils.js';
export * from './prompts.js';
export * from './memory.js';
export * from './provider.js';
export * from './sources.js';
export * from './permissions.js';
export * from './audit.js';
export * from './metrics.js';
export * from './tools.js';
export * from './service.js';
