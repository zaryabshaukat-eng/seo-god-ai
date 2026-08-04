import type { AgentActionType } from '../types/output.js';

/**
 * Action types an agent may never propose: they destroy content, remove
 * redirects or publish new pages directly.
 */
export const DESTRUCTIVE_ACTION_TYPES: readonly AgentActionType[] = [
  'delete_page',
  'remove_redirect',
];

/** Action types that publish directly (bypassing review/decision gates). */
export const PUBLISHING_ACTION_TYPES: readonly AgentActionType[] = ['create_page'];

/** Any action in this set is rejected outright by the safety guard. */
export const REJECTED_ACTION_TYPES: readonly AgentActionType[] = [
  ...DESTRUCTIVE_ACTION_TYPES,
  ...PUBLISHING_ACTION_TYPES,
];

/** Actions that materially change existing store content/config; these force `approvalRequired`. */
export const SENSITIVE_ACTION_TYPES: readonly AgentActionType[] = [
  'remove_structured_data',
  'remove_internal_links',
  'remove_image',
  'update_robots',
  'update_url',
  'update_canonical',
  'update_collection',
  'update_product',
  'update_blog',
  'update_article',
  'add_internal_links',
];

export function isRejectedActionType(actionType: AgentActionType): boolean {
  return REJECTED_ACTION_TYPES.includes(actionType);
}

export function isSensitiveActionType(actionType: AgentActionType): boolean {
  return SENSITIVE_ACTION_TYPES.includes(actionType);
}
