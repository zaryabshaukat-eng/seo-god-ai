import type { ValidationCheck, ValidationContext } from '../types/validation.js';
import { fail, ok } from './result.js';

const KNOWN_RESOURCE_TYPES = new Set(['product', 'collection', 'page', 'blog', 'article', 'store']);

const REQUIRED_FIELDS: Record<string, Array<[string, 'string' | 'object' | 'array']>> = {
  update_title: [['title', 'string']],
  update_meta_description: [['description', 'string']],
  update_description: [['description', 'string']],
  update_body: [['body', 'string']],
  update_url: [['url', 'string']],
  add_image: [['url', 'string']],
  update_theme: [
    ['themeId', 'string'],
    ['files', 'array'],
  ],
  update_product: [['product', 'object']],
  update_blog: [['blog', 'object']],
};

function matches(expected: 'string' | 'object' | 'array', value: unknown): boolean {
  if (expected === 'string') return typeof value === 'string';
  if (expected === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
  return Array.isArray(value);
}

/** Validates the step's structural schema before anything else runs. */
export class SchemaValidator implements ValidationCheck {
  readonly id = 'schema';

  check(ctx: ValidationContext) {
    const { step } = ctx;
    if (step.resourceId.length === 0) {
      return fail('schema', 'resource_id_required', 'step resourceId must not be empty', { stepId: step.id });
    }
    if (!KNOWN_RESOURCE_TYPES.has(step.resourceType)) {
      return fail('schema', 'unknown_resource_type', `unknown resourceType "${step.resourceType}"`, {
        stepId: step.id,
      });
    }
    if (step.payload === null || typeof step.payload !== 'object' || Array.isArray(step.payload)) {
      return fail('schema', 'payload_object', 'step payload must be an object', { stepId: step.id });
    }
    const requirements = REQUIRED_FIELDS[step.actionType];
    if (requirements !== undefined) {
      for (const [field, type] of requirements) {
        const value = step.payload[field];
        if (!matches(type, value)) {
          return fail('schema', 'missing_required_field', `payload.${field} must be a ${type}`, {
            stepId: step.id,
            field,
          });
        }
      }
    }
    return ok();
  }
}
