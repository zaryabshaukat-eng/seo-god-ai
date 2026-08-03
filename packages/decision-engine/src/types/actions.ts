/**
 * Shared action primitives. Extracted so both the plan and result type
 * modules can reference them without forming a circular import.
 */

export type ResourceType = 'product' | 'collection' | 'page' | 'blog' | 'article' | 'store';

export type TaskActionType =
  | 'update_title'
  | 'update_meta_description'
  | 'update_description'
  | 'update_body'
  | 'update_url'
  | 'update_meta'
  | 'add_structured_data'
  | 'remove_structured_data'
  | 'fix_internal_links'
  | 'add_internal_links'
  | 'remove_internal_links'
  | 'update_alt_text'
  | 'add_image'
  | 'remove_image'
  | 'update_robots'
  | 'update_canonical'
  | 'remove_redirect'
  | 'create_page'
  | 'delete_page'
  | 'update_collection'
  | 'update_product'
  | 'update_blog'
  | 'update_article'
  | 'custom';
