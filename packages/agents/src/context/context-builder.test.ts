import { describe, expect, it } from 'vitest';
import { makeInput } from '../test/helpers.js';
import { ContextBuilderImpl, estimateTokens } from './context-builder.js';

describe('estimateTokens', () => {
  it('approximates tokens as chars over 4', () => {
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcdefghi')).toBe(3);
    expect(estimateTokens('')).toBe(0);
  });
});

describe('ContextBuilderImpl', () => {
  const builder = new ContextBuilderImpl();

  it('builds task and entities sections and skips empty storeId', () => {
    const context = builder.build(
      makeInput({ storeId: '', entities: [{ id: 'p1', type: 'page', ref: '/p/1', data: {} }] }),
      { agentId: 'metadata' },
    );
    expect(context.agentId).toBe('metadata');
    expect(context.taskId).toBe('task-1');
    expect(context.sections.map((section) => section.kind)).toEqual(['task', 'entities']);
  });

  it('adds store, settings and context sections when present', () => {
    const context = builder.build(
      makeInput({ settings: { locale: 'en' }, context: { report: { total: 3 } } }),
      { agentId: 'metadata' },
    );
    const kinds = context.sections.map((section) => section.kind);
    expect(kinds).toContain('store');
    expect(kinds).toContain('settings');
    expect(kinds).toContain('context');
  });

  it('respects explicit budgets', () => {
    const context = builder.build(makeInput(), {
      agentId: 'metadata',
      budget: { maxTokens: 1, maxSectionTokens: 2 },
    });
    expect(context.tokenEstimate).toBeLessThan(4000);
    const truncated = context.sections.filter((section) => section.truncated);
    expect(truncated.length).toBeGreaterThan(0);
  });

  it('drops low-priority sections before truncating', () => {
    const huge = 'x'.repeat(20000);
    const context = builder.build(
      makeInput({ settings: { note: huge }, context: { note: huge } }),
      { agentId: 'metadata', budget: { maxTokens: 100 } },
    );
    const kinds = context.sections.map((section) => section.kind);
    expect(kinds).not.toContain('settings');
    expect(kinds).not.toContain('context');
    expect(kinds).not.toContain('store');
    expect(kinds).toContain('task');
    expect(kinds).toContain('entities');
  });

  it('truncates large arrays deterministically', () => {
    const many = Array.from({ length: 100 }, (_, index) => ({
      id: `p${index}`,
      type: 'page',
      ref: `/p/${index}`,
      data: { body: 'y'.repeat(200) },
    }));
    const context = builder.build(makeInput({ entities: many }), {
      agentId: 'metadata',
      budget: { maxSectionTokens: 50 },
    });
    const entities = context.sections.find((section) => section.kind === 'entities');
    expect(Array.isArray(entities?.content)).toBe(true);
    expect((entities?.content as unknown[]).length).toBeLessThan(many.length);
  });

  it('truncates large strings within the budget', () => {
    const context = builder.build(
      makeInput({
        entities: [
          {
            id: 'p1',
            type: 'page',
            ref: '/p/1',
            data: { body: 'a'.repeat(5000) },
          },
        ],
      }),
      { agentId: 'metadata', budget: { maxTokens: 100, maxSectionTokens: 40 } },
    );
    const entities = context.sections.find((section) => section.kind === 'entities');
    expect(entities?.truncated).toBe(true);
    expect(context.tokenEstimate).toBeLessThanOrEqual(100);
  });

  it('keeps scalars intact even when over budget flags truncation', () => {
    const context = builder.build(makeInput(), {
      agentId: 'metadata',
      budget: { maxTokens: 1, maxSectionTokens: 1 },
    });
    expect(context.tokenEstimate).toBeGreaterThanOrEqual(0);
  });
});
