/**
 * Publisher types. The Publisher is the ONLY component allowed to call
 * Shopify write methods; operations translate a step payload into concrete
 * writer calls, and the writer adapter hides the underlying ShopifyService.
 */

import type { ExecutionStep } from './execution.js';
import type { ExecutionMode } from './shared.js';

export type WriteCapability =
  | 'product'
  | 'page'
  | 'blog'
  | 'theme'
  | 'image'
  | 'collection'
  | 'article'
  | 'redirect'
  | 'metafield'
  | 'sitemap'
  | 'internal_links';

/**
 * The write surface the publisher may use. Every method is optional so future
 * operations stay pluggable; `has` reports which capabilities are live.
 */
export interface ShopifyWriter {
  readonly capabilities: ReadonlySet<WriteCapability>;
  updateProduct?(shopDomain: string, input: Record<string, unknown>): Promise<unknown>;
  updatePage?(shopDomain: string, input: Record<string, unknown>): Promise<unknown>;
  updateBlog?(shopDomain: string, input: Record<string, unknown>): Promise<unknown>;
  updateTheme?(
    shopDomain: string,
    themeId: string,
    files: Array<Record<string, unknown>>,
  ): Promise<unknown>;
  uploadImage?(shopDomain: string, input: Record<string, unknown>): Promise<unknown>;
  updateCollection?(shopDomain: string, input: Record<string, unknown>): Promise<unknown>;
  updateArticle?(shopDomain: string, input: Record<string, unknown>): Promise<unknown>;
  createRedirect?(shopDomain: string, input: Record<string, unknown>): Promise<unknown>;
  deleteRedirect?(shopDomain: string, redirectId: string): Promise<unknown>;
  upsertMetafield?(shopDomain: string, input: Record<string, unknown>): Promise<unknown>;
  writeSitemap?(shopDomain: string, input: Record<string, unknown>): Promise<unknown>;
  updateInternalLinks?(shopDomain: string, input: Record<string, unknown>): Promise<unknown>;
  has(capability: WriteCapability): boolean;
}

export interface OperationResult {
  /** Number of Shopify API calls made by this operation. */
  apiCalls: number;
  /** The resulting resource state (observed or expected). */
  after: Record<string, unknown> | null;
  /** Raw API responses, captured for the audit trail. */
  responses: Record<string, unknown>[];
}

export interface ExecutionOperation {
  /** Stable id, e.g. `product.update_title`. */
  readonly id: string;
  readonly actionType: string;
  readonly resourceType: string;
  /** True when this operation changes store data. */
  readonly mutating: boolean;
  /** True when this operation requires approval before any write. */
  readonly requiresApproval: boolean;
  /** Writer capability needed to execute, or null when it never writes. */
  readonly capability: WriteCapability | null;
  /** False when no writer can execute this operation yet. */
  readonly supportsWrite: boolean;
  /** False when the previous state cannot be restored on rollback. */
  readonly supportsRestore: boolean;
  readonly supportedModes: ExecutionMode[];
  summarize(step: ExecutionStep): string;
  expectedAfter(step: ExecutionStep): Record<string, unknown>;
  apply(
    step: ExecutionStep,
    writer: ShopifyWriter,
    shopDomain: string,
    mode: ExecutionMode,
  ): Promise<OperationResult>;
  restore(
    step: ExecutionStep,
    writer: ShopifyWriter,
    shopDomain: string,
    mode?: ExecutionMode,
  ): Promise<OperationResult>;
}

export interface Publisher {
  readonly operationCount: number;
  /** Cumulative number of Shopify API calls issued. */
  readonly callCount: number;
  publish(
    step: ExecutionStep,
    shopDomain: string,
    mode: ExecutionMode,
  ): Promise<OperationResult>;
  resetCalls(): void;
}

export interface OperationRegistry {
  register(operation: ExecutionOperation): void;
  get(actionType: string, resourceType: string): ExecutionOperation;
  has(actionType: string, resourceType: string): boolean;
  list(): ExecutionOperation[];
}
