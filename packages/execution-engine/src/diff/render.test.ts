import { describe, expect, it } from 'vitest';
import { buildExecutionDiff } from './diff-engine.js';
import { oneLineSummary, renderDiff } from './render.js';

function sampleDiff() {
  return buildExecutionDiff({
    id: 'diff-1',
    executionId: 'exec-1',
    stepId: 'step-1',
    storeId: 'store-1',
    resourceType: 'product',
    resourceId: 'p1',
    actionType: 'update_title',
    entityId: 'p1',
    before: { title: 'Old title', seo: { title: 'Old seo' } },
    after: { title: 'New title', seo: { title: 'New seo' } },
  });
}

describe('diff render', () => {
  it('renderDiff prints a multi-line human-readable diff', () => {
    const rendered = renderDiff(sampleDiff());
    expect(rendered).toContain('product p1 (update_title)');
    expect(rendered).toContain('~ title:');
    expect(rendered).toContain('~ seo.title:');
  });

  it('renderDiff distinguishes added and removed fields', () => {
    const diff = buildExecutionDiff({
      id: 'd',
      executionId: 'e',
      stepId: 's',
      storeId: 'st',
      resourceType: 'page',
      resourceId: 'p',
      actionType: 'update_meta_description',
      entityId: 'p',
      before: { description: 'old' },
      after: { description: 'new', extra: 1 },
    });
    const rendered = renderDiff(diff);
    expect(rendered).toContain('+ extra:');
    expect(rendered).toContain('~ description:');
  });

  it('renderDiff handles empty changes', () => {
    const diff = buildExecutionDiff({
      id: 'd',
      executionId: 'e',
      stepId: 's',
      storeId: 'st',
      resourceType: 'page',
      resourceId: 'p',
      actionType: 'update_title',
      entityId: 'p',
      before: { a: 1 },
      after: { a: 1 },
    });
    expect(renderDiff(diff)).toContain('No changes for page p.');
  });

  it('renderDiff prints removed fields', () => {
    const diff = buildExecutionDiff({
      id: 'd',
      executionId: 'e',
      stepId: 's',
      storeId: 'st',
      resourceType: 'page',
      resourceId: 'p',
      actionType: 'update_title',
      entityId: 'p',
      before: { gone: 1 },
      after: {},
    });
    expect(renderDiff(diff)).toContain('- gone:');
  });

  it('oneLineSummary condenses the diff', () => {
    const summary = oneLineSummary(sampleDiff());
    expect(summary).toBe('product:p1 2 field(s) changed');
    const unchanged = oneLineSummary(
      buildExecutionDiff({
        id: 'd2',
        executionId: 'e',
        stepId: 's',
        storeId: 'st',
        resourceType: 'blog',
        resourceId: 'b',
        actionType: 'update_title',
        entityId: 'b',
        before: { title: 'same' },
        after: { title: 'same' },
      }),
    );
    expect(unchanged).toBe('blog:b unchanged');
  });
});
