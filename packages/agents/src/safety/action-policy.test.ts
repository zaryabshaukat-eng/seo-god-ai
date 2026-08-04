import { describe, expect, it } from 'vitest';
import {
  DESTRUCTIVE_ACTION_TYPES,
  isRejectedActionType,
  isSensitiveActionType,
  PUBLISHING_ACTION_TYPES,
  REJECTED_ACTION_TYPES,
  SENSITIVE_ACTION_TYPES,
} from './action-policy.js';

describe('action policy', () => {
  it('flags destructive and publishing types as rejected', () => {
    expect(isRejectedActionType('delete_page')).toBe(true);
    expect(isRejectedActionType('remove_redirect')).toBe(true);
    expect(isRejectedActionType('create_page')).toBe(true);
    expect(isRejectedActionType('update_title')).toBe(false);
  });

  it('flags content-modifying types as sensitive', () => {
    expect(isSensitiveActionType('update_robots')).toBe(true);
    expect(isSensitiveActionType('update_canonical')).toBe(true);
    expect(isSensitiveActionType('remove_structured_data')).toBe(true);
    expect(isSensitiveActionType('update_title')).toBe(false);
  });

  it('composes the sets correctly', () => {
    expect(REJECTED_ACTION_TYPES).toEqual([...DESTRUCTIVE_ACTION_TYPES, ...PUBLISHING_ACTION_TYPES]);
    expect(REJECTED_ACTION_TYPES).toContain('delete_page');
    expect(SENSITIVE_ACTION_TYPES).not.toContain('delete_page');
  });
});
