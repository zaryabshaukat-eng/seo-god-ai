import { describe, expect, it } from 'vitest';
import { CopilotNotFoundError, CopilotValidationError } from './errors.js';
import {
  classifyIntent,
  DEFAULT_PROMPTS,
  PromptLibrary,
  PROMPT_ACTIONS_ID,
  PROMPT_ANSWER_ID,
  PROMPT_CRAWL_ID,
  PROMPT_EXECUTION_ID,
  PROMPT_EXPLAIN_ID,
  PROMPT_METRICS_ID,
  PROMPT_PLAN_ID,
  PROMPT_SYSTEM_ID,
  renderTemplate,
} from './prompts.js';

describe('renderTemplate', () => {
  it('fills placeholders', () => {
    expect(renderTemplate('Hello {{name}}!', { name: 'Ada' })).toBe('Hello Ada!');
  });

  it('replaces every occurrence', () => {
    expect(renderTemplate('{{a}} and {{a}}', { a: 'x' })).toBe('x and x');
  });

  it('throws on missing variables', () => {
    expect(() => renderTemplate('Hi {{who}}', {})).toThrow(CopilotValidationError);
  });

  it('throws on leftover placeholders', () => {
    expect(() => renderTemplate('Hi {{a}} {{b}}', { a: 'x' })).toThrow(CopilotValidationError);
  });

  it('tolerates whitespace inside placeholders', () => {
    expect(renderTemplate('{{ name }}', { name: 'Ada' })).toBe('Ada');
  });
});

describe('PromptLibrary', () => {
  it('registers, lists and gets templates', () => {
    const library = new PromptLibrary([{ id: 'a', role: 'user', content: 'A {{x}}' }]);
    expect(library.has('a')).toBe(true);
    expect(library.list()).toEqual(['a']);
    expect(library.get('a').content).toBe('A {{x}}');
    expect(library.render('a', { x: '1' })).toBe('A 1');
  });

  it('supports chained registration', () => {
    const library = new PromptLibrary();
    expect(library.register({ id: 'b', role: 'system', content: 'B' })).toBe(library);
    expect(library.has('b')).toBe(true);
  });

  it('throws when getting an unknown template', () => {
    expect(() => new PromptLibrary().get('nope')).toThrow(CopilotNotFoundError);
  });

  it('validates registration input', () => {
    expect(() => new PromptLibrary().register({ id: '  ', role: 'user', content: 'x' })).toThrow(
      CopilotValidationError,
    );
    expect(() => new PromptLibrary().register({ id: 'a', role: 'user', content: '  ' })).toThrow(
      CopilotValidationError,
    );
  });
});

describe('DEFAULT_PROMPTS', () => {
  it('includes the system and topic prompts', () => {
    const ids = DEFAULT_PROMPTS.map((template) => template.id);
    expect(ids).toContain(PROMPT_SYSTEM_ID);
    expect(ids).toContain(PROMPT_ANSWER_ID);
    expect(ids).toContain(PROMPT_EXPLAIN_ID);
    expect(ids).toContain(PROMPT_PLAN_ID);
    expect(ids).toContain(PROMPT_METRICS_ID);
    expect(ids).toContain(PROMPT_CRAWL_ID);
    expect(ids).toContain(PROMPT_EXECUTION_ID);
    expect(ids).toContain(PROMPT_ACTIONS_ID);
  });

  it('renders the system prompt with capabilities', () => {
    const library = new PromptLibrary(DEFAULT_PROMPTS);
    const content = library.render(PROMPT_SYSTEM_ID, { capabilities: 'list_recommendations' });
    expect(content).toContain('list_recommendations');
    expect(content).toContain('Copilot');
  });

  it('renders topic prompts with question and context', () => {
    const library = new PromptLibrary(DEFAULT_PROMPTS);
    for (const id of [PROMPT_ANSWER_ID, PROMPT_EXPLAIN_ID, PROMPT_PLAN_ID, PROMPT_METRICS_ID]) {
      const content = library.render(id, { question: 'q', context: 'c' });
      expect(content).toContain('q');
      expect(content).toContain('c');
    }
  });
});

describe('classifyIntent', () => {
  it('detects each topic', () => {
    expect(classifyIntent('why is this recommended?').promptId).toBe(PROMPT_EXPLAIN_ID);
    expect(classifyIntent('build me an optimization plan').promptId).toBe(PROMPT_PLAN_ID);
    expect(classifyIntent('what are my KPIs?').promptId).toBe(PROMPT_METRICS_ID);
    expect(classifyIntent('summary of the last crawl').promptId).toBe(PROMPT_CRAWL_ID);
    expect(classifyIntent('how did the last execution go?').promptId).toBe(PROMPT_EXECUTION_ID);
    expect(classifyIntent('suggest safe actions').promptId).toBe(PROMPT_ACTIONS_ID);
  });

  it('falls back to the generic answer prompt', () => {
    const intent = classifyIntent('hello there');
    expect(intent).toEqual({ promptId: PROMPT_ANSWER_ID, label: 'answer' });
  });

  it('is case-insensitive', () => {
    expect(classifyIntent('EXPLAIN this').promptId).toBe(PROMPT_EXPLAIN_ID);
  });
});
