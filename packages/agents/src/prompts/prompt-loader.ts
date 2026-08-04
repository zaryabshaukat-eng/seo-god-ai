import { ConflictError, NotFoundError, ValidationError } from '@seogod/core';
import { PROMPTS, type PromptTemplate } from './templates.js';

export interface PromptLoader {
  load(id: string, version?: string): PromptTemplate;
  has(id: string): boolean;
  all(): PromptTemplate[];
}

const PARAMETER_PATTERN = /^[A-Za-z0-9_.-]+$/;

/**
 * Loads versioned prompt templates and renders them strictly: every declared
 * parameter must be supplied, and no unknown parameter may be passed.
 */
export class PromptLoaderImpl implements PromptLoader {
  constructor(
    private readonly templates: Readonly<Record<string, PromptTemplate>> = PROMPTS,
  ) {}

  load(id: string, version?: string): PromptTemplate {
    const template = this.templates[id];
    if (template === undefined) {
      throw new NotFoundError(`Prompt template "${id}" was not found`, {
        module: 'agents',
        operation: 'prompts.load',
      });
    }
    if (version !== undefined && template.version !== version) {
      throw new ConflictError(
        `Prompt template "${id}" version "${version}" does not match "${template.version}"`,
        { module: 'agents', operation: 'prompts.load' },
      );
    }
    return template;
  }

  has(id: string): boolean {
    return this.templates[id] !== undefined;
  }

  all(): PromptTemplate[] {
    return Object.values(this.templates);
  }
}

/**
 * Renders a template by substituting `{param}` placeholders. Strict about
 * unknown and missing parameters so prompt drift fails loudly and early.
 */
export function renderPrompt(
  template: PromptTemplate,
  values: Readonly<Record<string, unknown>>,
): string {
  const declared = new Set(template.parameters);
  const unknown = Object.keys(values).filter((key) => !declared.has(key));
  if (unknown.length > 0) {
    throw new ValidationError(
      `Unknown parameters "${unknown.join(', ')}" for prompt "${template.id}"`,
      { module: 'agents', operation: 'prompts.render' },
    );
  }
  const missing = template.parameters.filter((param) => values[param] === undefined);
  if (missing.length > 0) {
    throw new ValidationError(
      `Missing parameters "${missing.join(', ')}" for prompt "${template.id}"`,
      { module: 'agents', operation: 'prompts.render' },
    );
  }
  return template.template.replace(/\{([A-Za-z0-9_.-]+)\}/g, (match, name: string) => {
    if (!PARAMETER_PATTERN.test(name) || !declared.has(name)) {
      throw new ValidationError(`Unexpected placeholder "{${name}}" in prompt "${template.id}"`, {
        module: 'agents',
        operation: 'prompts.render',
      });
    }
    return String(values[name]);
  });
}
