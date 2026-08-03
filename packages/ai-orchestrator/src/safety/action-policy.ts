import type { TaskActionType } from '@seogod/decision-engine';

/** Mutating actions the safety guard treats as always-unsafe without approval. */
const UNSAFE_ACTIONS: ReadonlySet<string> = new Set([
  'delete_page',
  'remove_redirect',
  'remove_internal_links',
  'remove_image',
  'remove_structured_data',
]);

const SUPPORTED_ACTIONS: ReadonlySet<string> = new Set<TaskActionType>([
  'update_title',
  'update_meta_description',
  'update_description',
  'update_body',
  'update_url',
  'update_meta',
  'add_structured_data',
  'fix_internal_links',
  'add_internal_links',
  'update_alt_text',
  'add_image',
  'update_robots',
  'update_canonical',
  'create_page',
  'update_collection',
  'update_product',
  'update_blog',
  'update_article',
]);

/** Whether an action is part of the supported, allow-listed action set. */
export function isSupportedAction(action: string): boolean {
  return SUPPORTED_ACTIONS.has(action);
}

/** Whether an action is destructive enough to always warrant extra scrutiny. */
export function isUnsafeAction(action: string): boolean {
  return UNSAFE_ACTIONS.has(action);
}
