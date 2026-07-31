import { timingSafeEqual } from 'node:crypto';
import {
  ShopifyError,
  ShopifyHmacError,
  ShopifyInvalidStateError,
  ShopifyTokenError,
  ShopifyValidationError,
} from './errors.js';
import { ShopifyGraphQLClient, type GraphQLResult } from './graphql-client.js';
import { isValidShopDomain, validateHmac, buildAuthorizationUrl, exchangeAccessToken } from './oauth.js';
import { paginate } from './paginate.js';
import type { PageFetcher } from './paginate.js';
import { MUTATIONS, QUERIES } from './queries.js';
import { MemoryTokenStorage, type TokenStorage } from './token-storage.js';
import type {
  Article,
  Blog,
  BlogUpdateInput,
  Collection,
  Connection,
  ImageUploadInput,
  ListOptions,
  Metafield,
  Page,
  PageInfo,
  PageUpdateInput,
  Product,
  ProductUpdateInput,
  RawConnection,
  StoreToken,
  Theme,
  ThemeFileInput,
  UploadedImage,
} from './types.js';

/** Default API version for new clients. Override via `apiVersion`. */
export const DEFAULT_API_VERSION = '2026-07';

/** Minimal, safe scope set for SEO read/write. Widen deliberately, never blindly. */
export const DEFAULT_SCOPES = [
  'read_products',
  'write_products',
  'read_content',
  'write_content',
  'read_themes',
  'write_themes',
] as const;

export interface BuildAuthorizationUrlInput {
  shopDomain: string;
  /** Anti-CSRF value you persist and verify on the callback. */
  state: string;
  /** Overrides {@link DEFAULT_SCOPES}. Widen deliberately. */
  scopes?: string[];
  isOnline?: boolean;
  redirectUri?: string;
}

export interface ShopifyServiceOptions {
  /** Shopify app client ID. */
  clientId: string;
  /** Shopify app client secret. Never log or commit this. */
  clientSecret: string;
  /** Admin API version to target. Defaults to {@link DEFAULT_API_VERSION}. */
  apiVersion?: string;
  /** Redirect URI used when building authorization URLs. */
  redirectUri?: string;
  /** Token persistence. Defaults to in-memory (for tests/development). */
  tokenStorage?: TokenStorage;
  /** Injectable fetch for tests. Defaults to the global fetch. */
  fetchImpl?: typeof fetch;
  maxRetries?: number;
  retryBackoffMs?: number;
  /** Safety cap on pages fetched per list operation. Default 100. */
  maxPages?: number;
  /** Verify OAuth callback HMAC signatures. Default true. */
  validateHmac?: boolean;
}

interface UserError {
  field?: Array<string | number> | null;
  message: string;
}

/**
 * The single entry point for talking to Shopify.
 *
 * The rest of the application must never call the Shopify REST/GraphQL APIs
 * directly; everything goes through this service so tokens, rate limits,
 * retries and errors stay consistent.
 */
export class ShopifyService {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly apiVersion: string;
  private readonly redirectUri?: string;
  private readonly tokenStorage: TokenStorage;
  private readonly fetchImpl: typeof fetch;
  private readonly maxRetries: number;
  private readonly retryBackoffMs: number;
  private readonly maxPages: number;
  private readonly validateHmacEnabled: boolean;

  constructor(options: ShopifyServiceOptions) {
    if (!options.clientId || !options.clientSecret) {
      throw new ShopifyValidationError('clientId and clientSecret are required');
    }
    this.clientId = options.clientId;
    this.clientSecret = options.clientSecret;
    this.apiVersion = options.apiVersion ?? DEFAULT_API_VERSION;
    this.redirectUri = options.redirectUri;
    this.tokenStorage = options.tokenStorage ?? new MemoryTokenStorage();
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.maxRetries = options.maxRetries ?? 3;
    this.retryBackoffMs = options.retryBackoffMs ?? 500;
    this.maxPages = options.maxPages ?? 100;
    this.validateHmacEnabled = options.validateHmac ?? true;
  }

  // ------------------------------------------------------------------
  // OAuth / connection lifecycle
  // ------------------------------------------------------------------

  /**
   * Builds the URL to send a store owner to for OAuth consent.
   * Persist `state` yourself and verify it on the callback.
   */
  buildAuthorizationUrl(input: BuildAuthorizationUrlInput): string {
    const redirectUri = input.redirectUri ?? this.redirectUri;
    if (!redirectUri) {
      throw new ShopifyValidationError('redirectUri is required to build an authorization URL');
    }
    return buildAuthorizationUrl({
      clientId: this.clientId,
      redirectUri,
      shopDomain: input.shopDomain,
      state: input.state,
      scopes: input.scopes ?? [...DEFAULT_SCOPES],
      isOnline: input.isOnline,
    });
  }

  /**
   * Completes the OAuth handshake from the Shopify callback: validates the
   * shop domain, the HMAC signature (anti-forgery), the `state` you issued,
   * exchanges the code, and persists the token.
   */
  async handleOAuthCallback(input: {
    query: URLSearchParams;
    /** The `state` value you stored when building the authorization URL. */
    expectedState?: string;
  }): Promise<StoreToken> {
    const { query } = input;
    const shopDomain = query.get('shop') ?? '';
    const code = query.get('code') ?? '';
    const state = query.get('state') ?? '';

    if (!shopDomain || !code) {
      throw new ShopifyValidationError('OAuth callback is missing shop or code', {
        operation: 'handleOAuthCallback',
      });
    }
    if (!isValidShopDomain(shopDomain)) {
      throw new ShopifyValidationError(`Invalid shop domain: ${shopDomain}`, {
        shopDomain,
        operation: 'handleOAuthCallback',
      });
    }
    if (this.validateHmacEnabled && !validateHmac(query, this.clientSecret)) {
      throw new ShopifyHmacError('OAuth callback HMAC validation failed', {
        shopDomain,
        operation: 'handleOAuthCallback',
      });
    }
    if (input.expectedState != null && !constantTimeEquals(state, input.expectedState)) {
      throw new ShopifyInvalidStateError('OAuth callback state mismatch', {
        shopDomain,
        operation: 'handleOAuthCallback',
      });
    }

    const exchanged = await exchangeAccessToken(
      { shopDomain, code, clientId: this.clientId, clientSecret: this.clientSecret },
      this.fetchImpl,
    );

    const token: StoreToken = {
      shopDomain,
      accessToken: exchanged.accessToken,
      scopes: exchanged.scope.split(',').filter(Boolean),
      installedAt: new Date().toISOString(),
      expiresAt:
        exchanged.expiresIn != null
          ? new Date(Date.now() + exchanged.expiresIn * 1000).toISOString()
          : null,
    };
    await this.tokenStorage.save(token);
    return token;
  }

  /** Returns the stored token for a shop, or null if the shop is not connected. */
  async getStoredToken(shopDomain: string): Promise<StoreToken | null> {
    return this.tokenStorage.get(shopDomain);
  }

  /** Removes a shop's stored credentials. */
  async disconnect(shopDomain: string): Promise<void> {
    await this.tokenStorage.delete(shopDomain);
  }

  // ------------------------------------------------------------------
  // Reads
  // ------------------------------------------------------------------

  async getProducts(shopDomain: string, options: ListOptions = {}): Promise<Connection<Product>> {
    return this.list(shopDomain, 'getProducts', async (after) => {
      const result = await this.request<{ products: RawConnection<Product> }>(
        shopDomain,
        'getProducts',
        QUERIES.products,
        { first: options.first ?? 50, after, query: options.query ?? undefined },
      );
      return {
        items: (result.data?.products.edges ?? []).map((edge) => edge.node),
        pageInfo: toPageInfo(result.data?.products.pageInfo),
      };
    });
  }

  async getCollections(
    shopDomain: string,
    options: ListOptions = {},
  ): Promise<Connection<Collection>> {
    return this.list(shopDomain, 'getCollections', async (after) => {
      const result = await this.request<{ collections: RawConnection<Collection> }>(
        shopDomain,
        'getCollections',
        QUERIES.collections,
        { first: options.first ?? 50, after, query: options.query ?? undefined },
      );
      return {
        items: (result.data?.collections.edges ?? []).map((edge) => edge.node),
        pageInfo: toPageInfo(result.data?.collections.pageInfo),
      };
    });
  }

  async getPages(shopDomain: string, options: ListOptions = {}): Promise<Connection<Page>> {
    return this.list(shopDomain, 'getPages', async (after) => {
      const result = await this.request<{ pages: RawConnection<Page> }>(
        shopDomain,
        'getPages',
        QUERIES.pages,
        { first: options.first ?? 50, after, query: options.query ?? undefined },
      );
      return {
        items: (result.data?.pages.edges ?? []).map((edge) => edge.node),
        pageInfo: toPageInfo(result.data?.pages.pageInfo),
      };
    });
  }

  async getBlogs(shopDomain: string, options: ListOptions = {}): Promise<Connection<Blog>> {
    return this.list(shopDomain, 'getBlogs', async (after) => {
      const result = await this.request<{ blogs: RawConnection<Blog> }>(
        shopDomain,
        'getBlogs',
        QUERIES.blogs,
        { first: options.first ?? 50, after, query: options.query ?? undefined },
      );
      return {
        items: (result.data?.blogs.edges ?? []).map((edge) => edge.node),
        pageInfo: toPageInfo(result.data?.blogs.pageInfo),
      };
    });
  }

  async getArticles(
    shopDomain: string,
    options: ListOptions & { blogId?: string } = {},
  ): Promise<Connection<Article>> {
    return this.list(shopDomain, 'getArticles', async (after) => {
      const result = await this.request<{ articles: RawConnection<Article> }>(
        shopDomain,
        'getArticles',
        QUERIES.articles,
        {
          first: options.first ?? 50,
          after,
          query: options.query ?? undefined,
          blogId: options.blogId ?? undefined,
        },
      );
      return {
        items: (result.data?.articles.edges ?? []).map((edge) => edge.node),
        pageInfo: toPageInfo(result.data?.articles.pageInfo),
      };
    });
  }

  async getMetafields(
    shopDomain: string,
    options: ListOptions & { namespace?: string; ownerId?: string } = {},
  ): Promise<Connection<Metafield>> {
    return this.list(shopDomain, 'getMetafields', async (after) => {
      const result = await this.request<{ metafields: RawConnection<Metafield> }>(
        shopDomain,
        'getMetafields',
        QUERIES.metafields,
        {
          first: options.first ?? 50,
          after,
          namespace: options.namespace ?? undefined,
          ownerId: options.ownerId ?? undefined,
        },
      );
      return {
        items: (result.data?.metafields.edges ?? []).map((edge) => edge.node),
        pageInfo: toPageInfo(result.data?.metafields.pageInfo),
      };
    });
  }

  /** Themes are returned in full (the Admin API does not paginate them). */
  async getThemes(shopDomain: string): Promise<Theme[]> {
    const result = await this.request<{ themes: Theme[] }>(shopDomain, 'getThemes', QUERIES.themes);
    return result.data?.themes ?? [];
  }

  // ------------------------------------------------------------------
  // Writes
  // ------------------------------------------------------------------

  async updateProduct(shopDomain: string, input: ProductUpdateInput): Promise<Product> {
    if (!input.id) {
      throw new ShopifyValidationError('Product id is required', { operation: 'updateProduct' });
    }
    const result = await this.request<{ productUpdate: { product?: Product; userErrors: UserError[] } }>(
      shopDomain,
      'updateProduct',
      MUTATIONS.productUpdate,
      { input },
    );
    assertNoUserErrors(result.data?.productUpdate.userErrors, 'updateProduct', shopDomain);
    const product = result.data?.productUpdate.product;
    if (!product) {
      throw new ShopifyError('Product update returned no product', {
        code: 'API_ERROR',
        context: { shopDomain, operation: 'updateProduct' },
      });
    }
    return product;
  }

  async updatePage(shopDomain: string, input: PageUpdateInput): Promise<Page> {
    if (!input.id) {
      throw new ShopifyValidationError('Page id is required', { operation: 'updatePage' });
    }
    const result = await this.request<{ pageUpdate: { page?: Page; userErrors: UserError[] } }>(
      shopDomain,
      'updatePage',
      MUTATIONS.pageUpdate,
      { input },
    );
    assertNoUserErrors(result.data?.pageUpdate.userErrors, 'updatePage', shopDomain);
    const page = result.data?.pageUpdate.page;
    if (!page) {
      throw new ShopifyError('Page update returned no page', {
        code: 'API_ERROR',
        context: { shopDomain, operation: 'updatePage' },
      });
    }
    return page;
  }

  async updateBlog(shopDomain: string, input: BlogUpdateInput): Promise<Blog> {
    if (!input.id) {
      throw new ShopifyValidationError('Blog id is required', { operation: 'updateBlog' });
    }
    const result = await this.request<{ blogUpdate: { blog?: Blog; userErrors: UserError[] } }>(
      shopDomain,
      'updateBlog',
      MUTATIONS.blogUpdate,
      { input },
    );
    assertNoUserErrors(result.data?.blogUpdate.userErrors, 'updateBlog', shopDomain);
    const blog = result.data?.blogUpdate.blog;
    if (!blog) {
      throw new ShopifyError('Blog update returned no blog', {
        code: 'API_ERROR',
        context: { shopDomain, operation: 'updateBlog' },
      });
    }
    return blog;
  }

  /**
   * Upserts theme files (e.g. `templates/product.json`, `layout/theme.liquid`)
   * for the given theme. Returns the list of filenames that were upserted.
   */
  async updateTheme(shopDomain: string, themeId: string, files: ThemeFileInput[]): Promise<string[]> {
    if (!themeId) {
      throw new ShopifyValidationError('themeId is required', { operation: 'updateTheme' });
    }
    if (files.length === 0) {
      throw new ShopifyValidationError('At least one theme file is required', {
        operation: 'updateTheme',
      });
    }
    const result = await this.request<{
      themeFilesUpsert: { upsertedThemeFiles?: Array<{ filename: string }>; userErrors: UserError[] };
    }>(shopDomain, 'updateTheme', MUTATIONS.themeFilesUpsert, { themeId, files });
    assertNoUserErrors(result.data?.themeFilesUpsert.userErrors, 'updateTheme', shopDomain);
    return result.data?.themeFilesUpsert.upsertedThemeFiles?.map((file) => file.filename) ?? [];
  }

  /** Uploads an image from a publicly reachable URL into the store's files. */
  async uploadImage(shopDomain: string, input: ImageUploadInput): Promise<UploadedImage> {
    if (!input.url) {
      throw new ShopifyValidationError('Image url is required', { operation: 'uploadImage' });
    }
    const file: { originalSource: string; alt?: string; filename?: string; contentType: 'IMAGE' } = {
      originalSource: input.url,
      contentType: 'IMAGE',
    };
    if (input.alt) {
      file.alt = input.alt;
    }
    if (input.filename) {
      file.filename = input.filename;
    }

    const result = await this.request<{
      fileCreate: {
        files?: Array<{ id: string; alt: string | null; image?: { url: string | null } | null }>;
        userErrors: UserError[];
      };
    }>(shopDomain, 'uploadImage', MUTATIONS.fileCreate, { files: [file] });
    assertNoUserErrors(result.data?.fileCreate.userErrors, 'uploadImage', shopDomain);
    const uploaded = result.data?.fileCreate.files?.[0];
    if (!uploaded) {
      throw new ShopifyError('Image upload returned no file', {
        code: 'API_ERROR',
        context: { shopDomain, operation: 'uploadImage' },
      });
    }
    return { id: uploaded.id, alt: uploaded.alt, url: uploaded.image?.url ?? null };
  }

  // ------------------------------------------------------------------
  // Internals
  // ------------------------------------------------------------------

  private async list<T>(
    shopDomain: string,
    operation: string,
    fetchPage: (after: string | null) => Promise<{ items: T[]; pageInfo: PageInfo }>,
  ): Promise<Connection<T>> {
    return paginate<T>({ fetchPage } satisfies PageFetcher<T>, { maxPages: this.maxPages });
  }

  private async request<T>(
    shopDomain: string,
    operation: string,
    query: string,
    variables?: Record<string, unknown>,
  ): Promise<GraphQLResult<T>> {
    const token = await this.requireToken(shopDomain);
    const client = new ShopifyGraphQLClient({
      shopDomain,
      accessToken: token.accessToken,
      apiVersion: this.apiVersion,
      fetchImpl: this.fetchImpl,
      maxRetries: this.maxRetries,
      retryBackoffMs: this.retryBackoffMs,
    });
    const result = await client.request<T>({ query, variables });
    if (result.errors && result.errors.length > 0) {
      const messages = result.errors.map((error) => error.message).join('; ');
      throw new ShopifyError(`Shopify GraphQL error: ${messages}`, {
        code: 'API_ERROR',
        context: { shopDomain, operation },
      });
    }
    return result;
  }

  private async requireToken(shopDomain: string): Promise<StoreToken> {
    const token = await this.tokenStorage.get(shopDomain);
    if (!token) {
      throw new ShopifyTokenError('No access token stored for this shop', 'TOKEN_NOT_FOUND', {
        shopDomain,
      });
    }
    return token;
  }
}

function toPageInfo(info: PageInfo | undefined): PageInfo {
  return info ?? { hasNextPage: false, endCursor: null };
}

function assertNoUserErrors(
  userErrors: UserError[] | undefined,
  operation: string,
  shopDomain: string,
): void {
  if (userErrors && userErrors.length > 0) {
    const messages = userErrors
      .map((error) => `${error.field?.join('.') ?? 'input'}: ${error.message}`)
      .join('; ');
    throw new ShopifyError(messages, {
      code: 'API_ERROR',
      context: { shopDomain, operation, userErrors },
    });
  }
}

function constantTimeEquals(actual: string, expected: string): boolean {
  const a = Buffer.from(actual, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}
