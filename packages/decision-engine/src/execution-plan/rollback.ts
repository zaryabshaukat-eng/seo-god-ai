import type { ExecutionTask, TaskActionType } from '../types/plan.js';
import type { RollbackPlan } from '../types/result.js';

/** Actions that restore a set of named fields from captured values. */
const FIELD_ACTIONS: ReadonlySet<TaskActionType> = new Set<TaskActionType>([
  'update_title',
  'update_meta_description',
  'update_description',
  'update_meta',
  'update_url',
  'update_alt_text',
  'update_canonical',
  'update_robots',
  'update_collection',
  'update_product',
  'update_blog',
  'update_article',
]);

/** Actions that add content which can be removed again on rollback. */
const ADD_ACTIONS: ReadonlySet<TaskActionType> = new Set<TaskActionType>([
  'add_structured_data',
  'add_image',
  'add_internal_links',
]);

/** Actions that remove content which can be restored when captured. */
const REMOVE_ACTIONS: ReadonlySet<TaskActionType> = new Set<TaskActionType>([
  'remove_structured_data',
  'remove_image',
  'remove_internal_links',
  'remove_redirect',
]);

/** Field names each field-update action captures and restores on rollback. */
const FIELD_ACTION_KEYS: Partial<Record<TaskActionType, string[]>> = {
  update_title: ['title'],
  update_meta_description: ['metaDescription'],
  update_description: ['description'],
  update_meta: ['meta'],
  update_url: ['url'],
  update_alt_text: ['alt'],
  update_canonical: ['canonical'],
  update_robots: ['robots'],
  update_collection: ['collection'],
  update_product: ['product'],
  update_blog: ['blog'],
  update_article: ['article'],
};

/**
 * Generates a deterministic {@link RollbackPlan} for every mutating task.
 * Field updates need the previous values (from a captured snapshot); additive
 * actions always know what they added; destructive removals need the captured
 * value; deleting a page is never safely reversible.
 */
export class RollbackPlanGenerator {
  generate(task: ExecutionTask, beforeState: Record<string, unknown> = {}): RollbackPlan {
    const base = {
      taskId: task.id,
      storeId: task.storeId,
      planId: task.planId,
      actionType: task.actionType,
      resourceType: task.resourceType,
      resourceId: task.resourceId,
    };

    if (!task.isMutating) {
      return { ...base, available: false, reason: 'task is not mutating; no rollback needed', steps: [] };
    }
    if (task.actionType === 'delete_page') {
      return { ...base, available: false, reason: 'deleted pages cannot be restored', steps: [] };
    }
    if (FIELD_ACTIONS.has(task.actionType)) {
      return this.fieldRollback(task, beforeState, base);
    }
    if (task.actionType === 'create_page') {
      return {
        ...base,
        available: true,
        reason: 'created page will be removed on rollback',
        steps: [
          {
            action: 'revert',
            resourceType: task.resourceType,
            resourceId: task.resourceId,
            payload: { operation: 'delete_created', createdId: task.payload['createdId'] ?? null },
          },
        ],
      };
    }
    if (ADD_ACTIONS.has(task.actionType)) {
      return {
        ...base,
        available: true,
        reason: 'added content will be removed on rollback',
        steps: [
          {
            action: 'revert',
            resourceType: task.resourceType,
            resourceId: task.resourceId,
            payload: { operation: 'remove_added' },
          },
        ],
      };
    }
    if (REMOVE_ACTIONS.has(task.actionType)) {
      const captured = task.payload['captured'];
      if (captured === undefined) {
        return {
          ...base,
          available: false,
          reason: `previous value for ${task.actionType} was not captured`,
          steps: [],
        };
      }
      return {
        ...base,
        available: true,
        reason: 'removed value will be restored on rollback',
        steps: [
          {
            action: 'restore',
            resourceType: task.resourceType,
            resourceId: task.resourceId,
            payload: { value: captured },
          },
        ],
      };
    }
    return { ...base, available: false, reason: `no safe rollback exists for ${task.actionType}`, steps: [] };
  }

  private fieldRollback(
    task: ExecutionTask,
    beforeState: Record<string, unknown>,
    base: Omit<RollbackPlan, 'available' | 'reason' | 'steps'>,
  ): RollbackPlan {
    const fields = FIELD_ACTION_KEYS[task.actionType] ?? [];
    const missing = fields.filter((field) => beforeState[field] === undefined);
    if (missing.length > 0) {
      return {
        ...base,
        available: false,
        reason: `previous values missing for: ${missing.join(', ')}`,
        steps: [],
      };
    }
    return {
      ...base,
      available: true,
      reason: 'previous field values will be restored',
      steps: fields.map((field) => ({
        action: 'restore_field',
        resourceType: task.resourceType,
        resourceId: task.resourceId,
        payload: { field, value: beforeState[field] },
      })),
    };
  }
}
