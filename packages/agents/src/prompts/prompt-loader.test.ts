import { ConflictError, NotFoundError, ValidationError } from '@seogod/core';
import { describe, expect, it } from 'vitest';
import { PROMPTS } from './templates.js';
import { PromptLoaderImpl, renderPrompt } from './prompt-loader.js';
import type { PromptTemplate } from './templates.js';

const template: PromptTemplate = {
  id: 'test',
  version: '1.0.0',
  name: 'Test',
  description: 'd',
  parameters: ['storeId', 'taskId'],
  template: 'Store {storeId} task {taskId}',
};

describe('PromptLoaderImpl', () => {
  it('loads built-in prompts by id', () => {
    const loader = new PromptLoaderImpl();
    const metadata = loader.load('metadata');
    expect(metadata.version).toBe('1.0.0');
    expect(loader.has('metadata')).toBe(true);
    expect(loader.has('missing')).toBe(false);
  });

  it('loads with a matching version', () => {
    expect(new PromptLoaderImpl().load('metadata', '1.0.0').id).toBe('metadata');
  });

  it('throws NotFoundError for unknown templates', () => {
    expect(() => new PromptLoaderImpl().load('missing')).toThrow(NotFoundError);
  });

  it('throws ConflictError on version mismatch', () => {
    expect(() => new PromptLoaderImpl().load('metadata', '9.9.9')).toThrow(ConflictError);
  });

  it('lists all templates', () => {
    const all = new PromptLoaderImpl().all();
    expect(all).toHaveLength(Object.keys(PROMPTS).length);
  });
});

describe('renderPrompt', () => {
  it('substitutes declared parameters', () => {
    expect(renderPrompt(template, { storeId: 's1', taskId: 't1' })).toBe('Store s1 task t1');
  });

  it('throws on unknown parameters', () => {
    expect(() =>
      renderPrompt(template, { storeId: 's1', taskId: 't1', extra: 1 }),
    ).toThrow(ValidationError);
  });

  it('throws on missing parameters', () => {
    expect(() => renderPrompt(template, { storeId: 's1' })).toThrow(ValidationError);
  });

  it('throws on unexpected placeholders in the body', () => {
    const bad: PromptTemplate = {
      ...template,
      template: 'Store {storeId} task {taskId} {surprise}',
    };
    expect(() => renderPrompt(bad, { storeId: 's1', taskId: 't1' })).toThrow(ValidationError);
  });

  it('renders all built-in templates without error', () => {
    const values = {
      storeId: 's1',
      workflowId: 'w1',
      taskId: 't1',
      entityCount: '1',
      entities: '[]',
      settings: '{}',
      context: '{}',
      allowedActions: 'update_title',
    };
    for (const template of Object.values(PROMPTS)) {
      if (template.parameters.length === 0) {
        expect(renderPrompt(template, {})).toContain('output contract');
      } else {
        expect(renderPrompt(template, values)).toContain('Store: s1');
      }
    }
  });
});
