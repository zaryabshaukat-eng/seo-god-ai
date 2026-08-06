/**
 * `@seogod/ai-copilot` — conversational AI assistant types.
 *
 * The copilot is a thin orchestration layer over a streaming chat model and a
 * set of deterministic tools. Every platform integration (orchestrator,
 * decision-engine, learning-engine, observability, reports, enterprise) is
 * consumed through narrow structural interfaces so the package never depends
 * on their runtime modules.
 */

// ---------------------------------------------------------------------------
// Conversation model
// ---------------------------------------------------------------------------

export type CopilotRole = 'user' | 'assistant' | 'system' | 'tool';

export interface CopilotMessage {
  role: CopilotRole;
  content: string;
  /** Set for tool results: the tool call this message answers. */
  toolCallId?: string;
  /** Set for tool results: the name of the executed tool. */
  name?: string;
}

export interface CopilotSession {
  sessionId: string;
  tenantId: string;
  storeId?: string;
  userId?: string;
  createdAt: string;
  updatedAt: string;
  messages: CopilotMessage[];
}

export interface SessionFilter {
  tenantId: string;
  storeId?: string;
  userId?: string;
  limit?: number;
}

// ---------------------------------------------------------------------------
// Tool calling
// ---------------------------------------------------------------------------

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  toolCallId: string;
  name: string;
  ok: boolean;
  output: unknown;
  error?: string;
}

export interface ExecutedToolCall {
  call: ToolCall;
  result: ToolResult;
  permission: string;
}

// ---------------------------------------------------------------------------
// Chat API
// ---------------------------------------------------------------------------

export interface ChatUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ChatRequest {
  /** The user's message. */
  message: string;
  /** Tenant scope. Sessions and data access are tenant-scoped. */
  tenantId: string;
  /** Optional store scope for data tools. */
  storeId?: string;
  /** Actor id, recorded on audit entries. */
  userId?: string;
  /** Platform role used for permission checks; defaults to `viewer`. */
  role?: string;
  /** Resume an existing conversation; otherwise a new session is created. */
  sessionId?: string;
  /** Model identifier, e.g. `gpt-4o-mini`. */
  model?: string;
  temperature?: number;
  /** Number of messages kept as model context (system message excluded). */
  history?: number;
  /** Maximum tool-calling turns before the loop is capped. */
  maxToolTurns?: number;
  signal?: AbortSignal;
  /** Correlation id forwarded to audit entries and metrics. */
  requestId?: string;
  /** Remote address recorded on audit entries. */
  ipAddress?: string;
}

export interface ChatResponse {
  sessionId: string;
  storeId?: string;
  /** The final assistant message. */
  message: CopilotMessage;
  /** Every tool call executed (in order) while answering. */
  toolCalls: ExecutedToolCall[];
  usage: ChatUsage;
  /** Model that produced the final answer. */
  model: string;
  /** Prompt template that classified the request. */
  promptId: string;
}

export type ChatStreamEvent =
  | { type: 'delta'; sessionId: string; text: string }
  | { type: 'tool-call'; sessionId: string; toolCall: ToolCall }
  | { type: 'tool-result'; sessionId: string; result: ToolResult }
  | { type: 'done'; sessionId: string; response: ChatResponse }
  | { type: 'error'; sessionId: string; message: string };

/** Deterministic request classifier output. */
export interface TopicIntent {
  /** Prompt template id used to frame the request. */
  promptId: string;
  /** Human-readable topic label. */
  label: string;
}
