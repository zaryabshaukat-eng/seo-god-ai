import { describe, expect, it } from 'vitest';
import { ORIGIN, task } from '../test/fixtures.js';
import { RollbackPlanGenerator } from './rollback.js';

const generator = new RollbackPlanGenerator();

describe('RollbackPlanGenerator', () => {
  it('returns no rollback for non-mutating tasks', () => {
    const plan = generator.generate(task({ actionType: 'custom', isMutating: false }));
    expect(plan.available).toBe(false);
    expect(plan.reason).toContain('not mutating');
  });

  it('never rolls back deleted pages', () => {
    const plan = generator.generate(task({ actionType: 'delete_page', isMutating: true }));
    expect(plan.available).toBe(false);
    expect(plan.reason).toContain('cannot be restored');
  });

  describe('field updates', () => {
    it('restores captured field values', () => {
      const plan = generator.generate(task({ actionType: 'update_title' }), {
        title: 'Old title',
      });
      expect(plan.available).toBe(true);
      expect(plan.steps).toEqual([
        {
          action: 'restore_field',
          resourceType: 'page',
          resourceId: `${ORIGIN}/p/1`,
          payload: { field: 'title', value: 'Old title' },
        },
      ]);
    });

    it('is unavailable when previous values are missing', () => {
      const plan = generator.generate(task({ actionType: 'update_meta_description' }), {});
      expect(plan.available).toBe(false);
      expect(plan.reason).toContain('metaDescription');
    });
  });

  it('removes created pages on rollback', () => {
    const plan = generator.generate(task({ actionType: 'create_page' }));
    expect(plan.available).toBe(true);
    expect(plan.steps[0]?.action).toBe('revert');
    expect(plan.steps[0]?.payload).toMatchObject({ operation: 'delete_created' });
  });

  it('removes added content on rollback', () => {
    for (const actionType of ['add_structured_data', 'add_image', 'add_internal_links'] as const) {
      const plan = generator.generate(task({ actionType }));
      expect(plan.available).toBe(true);
      expect(plan.steps[0]?.payload).toMatchObject({ operation: 'remove_added' });
    }
  });

  it('restores captured values for removal actions', () => {
    const plan = generator.generate(
      task({ actionType: 'remove_structured_data', payload: { captured: { schemaType: 'Product' } } }),
    );
    expect(plan.available).toBe(true);
    expect(plan.steps[0]).toMatchObject({ action: 'restore' });
  });

  it('is unavailable when removal captured values are missing', () => {
    const plan = generator.generate(task({ actionType: 'remove_redirect', payload: {} }));
    expect(plan.available).toBe(false);
    expect(plan.reason).toContain('was not captured');
  });

  it('is unavailable for actions without a safe rollback', () => {
    const plan = generator.generate(task({ actionType: 'fix_internal_links' }));
    expect(plan.available).toBe(false);
    expect(plan.reason).toContain('no safe rollback');
  });
});
