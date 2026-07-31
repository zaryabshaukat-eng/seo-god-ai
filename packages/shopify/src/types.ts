/**
 * Public domain types for the Shopify Admin API.
 *
 * All IDs are Shopify global IDs (GIDs), e.g. `gid://shopify/Product/123`.
 */

/** Shopify store connection token stored securely by the platform. */
export interface StoreToken {
  shopDomain: string;
  accessToken: string;
  scopes: string[];
  installedAt: string;
  expiresAt?: string | null;
}

/** SEO title/description override as surfaced by the Admin API. */
export interface Seo {
  title?: string | null;
  description?: string | null;
}

export interface PageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}

/** Single edge in a Shopify GraphQL `Connection`. */
export interface Edge<T> {
  cursor: string;
  node: T;
}

/** Raw Shopify GraphQL `Connection` shape (edges + pageInfo). */
export interface RawConnection<T> {
  edges: Edge<T>[];
  pageInfo: PageInfo;
}

/** A paginated connection of items, mirroring the Shopify GraphQL `Connection` type. */
export interface Connection<T> {
  items: T[];
  pageInfo: PageInfo;
}

/** Pagination/filter options accepted by list methods. */
export interface ListOptions {
  first?: number;
  after?: string | null;
  query?: string;
}

export interface Product {
  id: string;
  title: string;
  handle: string;
  status: string;
  tags: string[];
  vendor: string | null;
  productType: string | null;
  descriptionHtml: string | null;
  updatedAt: string;
  seo: Seo | null;
}

export interface Collection {
  id: string;
  title: string;
  handle: string;
  descriptionHtml: string | null;
  updatedAt: string;
  seo: Seo | null;
}

export interface Page {
  id: string;
  title: string;
  handle: string;
  bodyHtml: string | null;
  updatedAt: string;
  seo: Seo | null;
}

export interface Blog {
  id: string;
  title: string;
  handle: string;
  updatedAt: string;
  seo: Seo | null;
}

export interface Article {
  id: string;
  title: string;
  handle: string;
  bodyHtml: string | null;
  publishedAt: string | null;
  updatedAt: string;
  seo: Seo | null;
}

export interface Theme {
  id: string;
  name: string;
  role: string;
  updatedAt: string;
}

export interface Metafield {
  id: string;
  namespace: string;
  key: string;
  value: string;
  type: string;
  ownerType: string;
}

export interface ProductUpdateInput {
  id: string;
  title?: string;
  handle?: string;
  descriptionHtml?: string;
  tags?: string[];
  productType?: string;
  vendor?: string;
  seo?: Seo;
}

export interface PageUpdateInput {
  id: string;
  title?: string;
  handle?: string;
  bodyHtml?: string;
  seo?: Seo;
}

export interface BlogUpdateInput {
  id: string;
  title?: string;
  handle?: string;
  seo?: Seo;
}

/** A file (body is a string) to upsert into a theme, e.g. `templates/product.json`. */
export interface ThemeFileInput {
  filename: string;
  body: string;
}

export interface ImageUploadInput {
  /** Publicly reachable URL of the image to upload. */
  url: string;
  alt?: string;
  filename?: string;
}

export interface UploadedImage {
  id: string;
  alt: string | null;
  url: string | null;
}
