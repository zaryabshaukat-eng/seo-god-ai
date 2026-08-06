/**
 * Prompt management and deterministic request classification.
 *
 * The library follows the same versioned-template contract as the
 * orchestrator's `PromptBuilder`: templates are registered under an id and
 * rendered by substituting `{{ placeholder }}` tokens. Rendering fails fast on
 * missing variables or leftover placeholders so prompts never reach the model
 * half-filled.
 */

import { CopilotNotFoundError, CopilotValidationError } from './errors.js';
import type { TopicIntent } from './types.js';

const PLACEHOLDER_PATTERN = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

export type PromptRole = 'system' | 'user' | 'assistant';

export interface PromptTemplate {
  id: string;
  role: PromptRole;
  content: string;
}

/** Fills every `{{ placeholder }}` token with the given variables. */
export function renderTemplate(content: string, variables: Record<string, string>): string {
  return content.replace(PLACEHOLDER_PATTERN, (_match, key: string) => {
    const value = variables[key];
    if (value === undefined) {
      throw new CopilotValidationError(`Missing template variable '${key}'.`, {
        context: { key },
      });
    }
    return value;
  });
}

export class PromptLibrary {
  private readonly templates = new Map<string, PromptTemplate>();

  constructor(templates: readonly PromptTemplate[] = []) {
    for (const template of templates) {
      this.register(template);
    }
  }

  /** Validates and stores a template. */
  register(template: PromptTemplate): PromptLibrary {
    if (template.id.trim().length === 0) {
      throw new CopilotValidationError('Prompt id is required.', { context: { id: template.id } });
    }
    if (template.content.trim().length === 0) {
      throw new CopilotValidationError(`Prompt '${template.id}' content is required.`);
    }
    this.templates.set(template.id, template);
    return this;
  }

  has(id: string): boolean {
    return this.templates.has(id);
  }

  /** All registered template ids, in registration order. */
  list(): string[] {
    return [...this.templates.keys()];
  }

  get(id: string): PromptTemplate {
    const template = this.templates.get(id);
    if (template === undefined) {
      throw new CopilotNotFoundError(`Prompt '${id}' is not registered.`, { context: { id } });
    }
    return template;
  }

  /** Renders a registered template with variables. */
  render(id: string, variables: Record<string, string> = {}): string {
    return renderTemplate(this.get(id).content, variables);
  }
}

// ---------------------------------------------------------------------------
// Default prompt set
// ---------------------------------------------------------------------------

export const PROMPT_SYSTEM_ID = 'copilot.system';
export const PROMPT_ANSWER_ID = 'copilot.answer';
export const PROMPT_EXPLAIN_ID = 'copilot.explain';
export const PROMPT_PLAN_ID = 'copilot.plan';
export const PROMPT_METRICS_ID = 'copilot.metrics';
export const PROMPT_CRAWL_ID = 'copilot.crawl';
export const PROMPT_EXECUTION_ID = 'copilot.execution';
export const PROMPT_ACTIONS_ID = 'copilot.actions';

export const DEFAULT_PROMPTS: readonly PromptTemplate[] = [
  {
    id: PROMPT_SYSTEM_ID,
    role: 'system',
    content:
      'You are Copilot, the SEO GOD AI assistant. You help merchants understand ' +
      'their SEO health, prioritize optimization work and safely act on it. ' +
      'You can load live data through tools; never invent numbers. ' +
      'When you use a tool, base your answer only on the returned data. ' +
      'Available capabilities: {{capabilities}}.',
  },
  {
    id: PROMPT_ANSWER_ID,
    role: 'user',
    content: 'Answer the question using the context below.\nContext:\n{{context}}\n\nQuestion: {{question}}',
  },
  {
    id: PROMPT_EXPLAIN_ID,
    role: 'user',
    content:
      'Explain the recommendation in plain language: why it matters, what it ' +
      'would change and what the expected impact is. Base the answer only on ' +
      'the tool data.\n\nData:\n{{context}}\n\nQuestion: {{question}}',
  },
  {
    id: PROMPT_PLAN_ID,
    role: 'user',
    content:
      'Turn the data below into a clear optimization plan: order items by ' +
      'impact, call out the quick wins and flag anything that needs ' +
      'approval.\n\nData:\n{{context}}\n\nQuestion: {{question}}',
  },
  {
    id: PROMPT_METRICS_ID,
    role: 'user',
    content:
      'Summarize the health metrics below: what is improving, what is ' +
      'declining and what needs attention right now.\n\nData:\n{{context}}\n\n' +
      'Question: {{question}}',
  },
  {
    id: PROMPT_CRAWL_ID,
    role: 'user',
    content:
      'Summarize the latest crawl: score change, pages crawled, issues found ' +
      'and the most important problems to fix.\n\nData:\n{{context}}\n\n' +
      'Question: {{question}}',
  },
  {
    id: PROMPT_EXECUTION_ID,
    role: 'user',
    content:
      'Summarize the latest execution run: success rate, failures, rollbacks, ' +
      'durations and validation issues.\n\nData:\n{{context}}\n\nQuestion: {{question}}',
  },
  {
    id: PROMPT_ACTIONS_ID,
    role: 'user',
    content:
      'From the data below, list safe actions the merchant could take now, ' +
      'each with its expected impact and whether it requires approval.\n\n' +
      'Data:\n{{context}}\n\nQuestion: {{question}}',
  },
];

// ---------------------------------------------------------------------------
// Intent classification
// ---------------------------------------------------------------------------

interface IntentRule {
  promptId: string;
  label: string;
  keywords: readonly string[];
}

const INTENT_RULES: readonly IntentRule[] = [
  { promptId: PROMPT_EXPLAIN_ID, label: 'explain', keywords: ['explain', 'why', 'what does', 'recommend', 'tell me about'] },
  { promptId: PROMPT_PLAN_ID, label: 'plan', keywords: ['plan', 'optimize', 'optimise', 'prioritize', 'prioritise', 'roadmap'] },
  { promptId: PROMPT_METRICS_ID, label: 'metrics', keywords: ['metric', 'kpi', 'score', 'performance', 'health', 'trend', 'compare'] },
  { promptId: PROMPT_CRAWL_ID, label: 'crawl', keywords: ['crawl', 'last crawl', 'scan'] },
  { promptId: PROMPT_EXECUTION_ID, label: 'execution', keywords: ['execution', 'executed', 'run summary', 'applied'] },
  { promptId: PROMPT_ACTIONS_ID, label: 'actions', keywords: ['action', 'change', 'fix', 'suggest', 'improve', 'safe'] },
];

/** Deterministically maps a user message to a topic prompt id. */
export function classifyIntent(message: string): TopicIntent {
  const normalized = message.trim().toLowerCase();
  for (const rule of INTENT_RULES) {
    if (rule.keywords.some((keyword) => normalized.includes(keyword))) {
      return { promptId: rule.promptId, label: rule.label };
    }
  }
  return { promptId: PROMPT_ANSWER_ID, label: 'answer' };
}
