import { ValidationError } from '@seogod/core';
import type { PromptTemplate, RenderPromptOptions } from '../types/prompt.js';
import { DEFAULT_TEMPLATES } from './templates.js';

const PLACEHOLDER_PATTERN = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

/**
 * Central, versioned prompt registry. All prompts live here as templates;
 * no module builds prompts inline. `render` substitutes `{{placeholders}}`,
 * fails on missing parameters, and fails when placeholders remain.
 */
export class PromptBuilder {
  private readonly templates = new Map<string, PromptTemplate[]>();

  constructor(templates: readonly PromptTemplate[] = DEFAULT_TEMPLATES) {
    for (const template of templates) {
      this.register(template);
    }
  }

  register(template: PromptTemplate): void {
    if (template.id.trim() === '') {
      throw new ValidationError('Prompt template id must not be empty', {
        module: 'ai-orchestrator',
        operation: 'prompt.register',
      });
    }
    if (template.version.trim() === '') {
      throw new ValidationError('Prompt template version must not be empty', {
        module: 'ai-orchestrator',
        operation: 'prompt.register',
      });
    }
    const versions = this.templates.get(template.id) ?? [];
    versions.push(template);
    this.templates.set(template.id, versions);
  }

  has(id: string): boolean {
    return this.templates.has(id);
  }

  list(): PromptTemplate[] {
    const all: PromptTemplate[] = [];
    for (const versions of this.templates.values()) {
      for (const template of versions) {
        all.push(template);
      }
    }
    return all;
  }

  get(id: string, options: RenderPromptOptions = {}): PromptTemplate {
    const versions = this.templates.get(id);
    if (versions === undefined || versions.length === 0) {
      throw new ValidationError(`Prompt template "${id}" is not registered`, {
        module: 'ai-orchestrator',
        operation: 'prompt.get',
      });
    }
    if (options.version !== undefined) {
      const match = versions.find((template) => template.version === options.version);
      if (match === undefined) {
        throw new ValidationError(`Prompt template "${id}@${options.version}" is not registered`, {
          module: 'ai-orchestrator',
          operation: 'prompt.get',
        });
      }
      return match;
    }
    const latest = versions.at(-1);
    if (latest === undefined) {
      throw new ValidationError(`Prompt template "${id}" has no versions`, {
        module: 'ai-orchestrator',
        operation: 'prompt.get',
      });
    }
    return latest;
  }

  /** Renders a template with parameters; throws on missing params/placeholders. */
  render(id: string, params: Record<string, string>, options: RenderPromptOptions = {}): string {
    const template = this.get(id, options);
    const rendered = template.content.replace(PLACEHOLDER_PATTERN, (match, name: string) => {
      const value = params[name];
      if (value === undefined) {
        throw new ValidationError(
          `Prompt template "${id}" is missing parameter "${name}"`,
          { module: 'ai-orchestrator', operation: 'prompt.render', context: { templateId: id } },
        );
      }
      return value;
    });
    const remaining = [...rendered.matchAll(PLACEHOLDER_PATTERN)];
    if (remaining.length > 0) {
      throw new ValidationError(
        `Prompt template "${id}" left ${remaining.length} placeholder(s) unresolved`,
        { module: 'ai-orchestrator', operation: 'prompt.render', context: { templateId: id } },
      );
    }
    return rendered;
  }
}
