import type { ShopifyService } from '@seogod/shopify';
import type {
  BlogUpdateInput,
  ImageUploadInput,
  PageUpdateInput,
  ProductUpdateInput,
  ThemeFileInput,
} from '@seogod/shopify';
import type { ShopifyWriter, WriteCapability } from '../types/publisher.js';
import { newId } from '../utils/ids.js';

/**
 * Adapts the real {@link ShopifyService} into the writer surface the publisher
 * may use. The execution engine is the ONLY package allowed to call these
 * write methods, and this adapter is the only bridge.
 */
export class ShopifyServiceWriter implements ShopifyWriter {
  readonly capabilities: ReadonlySet<WriteCapability> = new Set([
    'product',
    'page',
    'blog',
    'theme',
    'image',
  ]);

  constructor(private readonly service: ShopifyService) {}

  has(capability: WriteCapability): boolean {
    return this.capabilities.has(capability);
  }

  updateProduct(shopDomain: string, input: Record<string, unknown>): Promise<unknown> {
    return this.service.updateProduct(shopDomain, input as unknown as ProductUpdateInput);
  }

  updatePage(shopDomain: string, input: Record<string, unknown>): Promise<unknown> {
    return this.service.updatePage(shopDomain, input as unknown as PageUpdateInput);
  }

  updateBlog(shopDomain: string, input: Record<string, unknown>): Promise<unknown> {
    return this.service.updateBlog(shopDomain, input as unknown as BlogUpdateInput);
  }

  updateTheme(
    shopDomain: string,
    themeId: string,
    files: Array<Record<string, unknown>>,
  ): Promise<unknown> {
    return this.service.updateTheme(shopDomain, themeId, files as unknown as ThemeFileInput[]);
  }

  uploadImage(shopDomain: string, input: Record<string, unknown>): Promise<unknown> {
    return this.service.uploadImage(shopDomain, input as unknown as ImageUploadInput);
  }
}

export interface RecordedWrite {
  capability: WriteCapability;
  method: string;
  args: unknown[];
}

/**
 * Scriptable in-memory writer for tests and dry runs. Records every call,
 * throws configured failures, and returns the input merged with a generated id
 * so diffs can be asserted deterministically.
 */
export class MemoryShopifyWriter implements ShopifyWriter {
  readonly capabilities: ReadonlySet<WriteCapability>;
  readonly calls: RecordedWrite[] = [];
  readonly failures = new Map<string, string>();
  readonly presets = new Map<string, unknown>();

  constructor(capabilities: WriteCapability[] = ['product', 'page', 'blog', 'theme', 'image']) {
    this.capabilities = new Set(capabilities);
  }

  has(capability: WriteCapability): boolean {
    return this.capabilities.has(capability);
  }

  updateProduct(shopDomain: string, input: Record<string, unknown>): Promise<unknown> {
    return this.record('product', 'updateProduct', shopDomain, input);
  }

  updatePage(shopDomain: string, input: Record<string, unknown>): Promise<unknown> {
    return this.record('page', 'updatePage', shopDomain, input);
  }

  updateBlog(shopDomain: string, input: Record<string, unknown>): Promise<unknown> {
    return this.record('blog', 'updateBlog', shopDomain, input);
  }

  updateTheme(
    shopDomain: string,
    themeId: string,
    files: Array<Record<string, unknown>>,
  ): Promise<unknown> {
    return this.record('theme', 'updateTheme', shopDomain, themeId, files);
  }

  uploadImage(shopDomain: string, input: Record<string, unknown>): Promise<unknown> {
    return this.record('image', 'uploadImage', shopDomain, input);
  }

  private async record(
    capability: WriteCapability,
    method: string,
    ...args: unknown[]
  ): Promise<unknown> {
    this.calls.push({ capability, method, args });
    const failure = this.failures.get(method);
    if (failure !== undefined) throw new Error(failure);
    const preset = this.presets.get(method);
    if (preset !== undefined) return preset;
    const input = args.length > 1 ? (args[1] as Record<string, unknown> | undefined) : undefined;
    return { id: input?.id ?? newId(), ...(input ?? {}) };
  }
}
