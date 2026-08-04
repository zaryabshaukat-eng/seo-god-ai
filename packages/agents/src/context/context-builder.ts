import type { AgentContext, ContextBudget, ContextSection } from '../types/context.js';
import type { AgentInput } from '../types/input.js';

export interface BuildContextOptions {
  agentId: string;
  budget?: ContextBudget;
}

export interface ContextBuilder {
  build(input: AgentInput, options: BuildContextOptions): AgentContext;
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function serialize(value: unknown): string {
  return JSON.stringify(value);
}

function truncateString(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1))}\u2026`;
}

/** Deterministically shrinks a value until its JSON size fits `maxChars`. */
function truncateToBudget(content: unknown, maxChars: number): { content: unknown; truncated: boolean } {
  if (serialize(content).length <= maxChars) {
    return { content, truncated: false };
  }
  if (typeof content === 'string') {
    return { content: truncateString(content, maxChars), truncated: true };
  }
  if (Array.isArray(content)) {
    const items: unknown[] = [];
    for (const item of content) {
      if (serialize([...items, item]).length > maxChars) {
        break;
      }
      items.push(item);
    }
    return { content: items, truncated: items.length < content.length };
  }
  if (typeof content === 'object' && content !== null) {
    const result: Record<string, unknown> = {};
    let truncated = false;
    for (const [key, value] of Object.entries(content)) {
      if (serialize({ ...result, [key]: value }).length > maxChars) {
        truncated = true;
        break;
      }
      result[key] = value;
    }
    return { content: result, truncated };
  }
  return { content, truncated: true };
}

const LOW_PRIORITY_KINDS = ['context', 'settings', 'store'] as const;

/**
 * Builds a minimal agent context and compresses it deterministically to fit a
 * token budget: low-priority sections are dropped first, then values are
 * truncated. Only the data an agent needs survives.
 */
export class ContextBuilderImpl implements ContextBuilder {
  build(input: AgentInput, options: BuildContextOptions): AgentContext {
    const { agentId, budget } = options;
    const maxTokens = budget?.maxTokens ?? 4000;
    const maxSectionTokens = budget?.maxSectionTokens ?? 1200;

    let sections = this.buildSections(input, agentId);
    let tokenEstimate = this.tokenEstimate(sections);

    if (tokenEstimate > maxTokens) {
      sections = this.dropLowPrioritySections(sections);
      tokenEstimate = this.tokenEstimate(sections);
    }
    if (tokenEstimate > maxTokens) {
      sections = sections.map((section) => {
        const { content, truncated } = truncateToBudget(section.content, maxSectionTokens);
        return { ...section, content, size: serialize(content).length, truncated };
      });
      tokenEstimate = this.tokenEstimate(sections);
    }

    return {
      agentId,
      taskId: input.taskId,
      workflowId: input.workflowId,
      storeId: input.storeId,
      sections,
      tokenEstimate,
    };
  }

  private buildSections(input: AgentInput, agentId: string): ContextSection[] {
    const sections: ContextSection[] = [
      this.section('task', 'task', {
        agentId,
        taskId: input.taskId,
        workflowId: input.workflowId,
        storeId: input.storeId,
      }),
      this.section('entities', 'entities', input.entities),
    ];
    if (input.storeId !== '') {
      sections.push(this.section('store', 'store', { storeId: input.storeId }));
    }
    if (input.settings !== undefined) {
      sections.push(this.section('settings', 'settings', input.settings));
    }
    if (input.context !== undefined) {
      sections.push(this.section('context', 'context', input.context));
    }
    return sections;
  }

  private section(id: string, kind: string, content: unknown): ContextSection {
    return { id, kind, content, size: serialize(content).length, truncated: false };
  }

  private tokenEstimate(sections: ContextSection[]): number {
    return estimateTokens(serialize(sections.map((section) => section.content)));
  }

  private dropLowPrioritySections(sections: ContextSection[]): ContextSection[] {
    return sections.filter((section) => !(LOW_PRIORITY_KINDS as readonly string[]).includes(section.kind));
  }
}
