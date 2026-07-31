/**
 * GraphQL documents used by the service layer.
 *
 * Read queries sort by `UPDATED_AT` descending so cursor pagination is
 * stable while the store is being edited during a crawl.
 */

const PRODUCT_FIELDS = /* GraphQL */ `
    id
    title
    handle
    status
    tags
    vendor
    productType
    descriptionHtml
    updatedAt
    seo {
      title
      description
    }
`;

const COLLECTION_FIELDS = /* GraphQL */ `
    id
    title
    handle
    descriptionHtml
    updatedAt
    seo {
      title
      description
    }
`;

const PAGE_FIELDS = /* GraphQL */ `
    id
    title
    handle
    bodyHtml
    updatedAt
    seo {
      title
      description
    }
`;

const BLOG_FIELDS = /* GraphQL */ `
    id
    title
    handle
    updatedAt
    seo {
      title
      description
    }
`;

const ARTICLE_FIELDS = /* GraphQL */ `
    id
    title
    handle
    bodyHtml
    publishedAt
    updatedAt
    seo {
      title
      description
    }
`;

export const QUERIES = {
  products: /* GraphQL */ `
    query Products($first: Int!, $after: String, $query: String) {
      products(first: $first, after: $after, query: $query, sortKey: UPDATED_AT, reverse: true) {
        pageInfo {
          hasNextPage
          endCursor
        }
        edges {
          cursor
          node {
            ${PRODUCT_FIELDS}
          }
        }
      }
    }
  `,
  collections: /* GraphQL */ `
    query Collections($first: Int!, $after: String, $query: String) {
      collections(first: $first, after: $after, query: $query, sortKey: UPDATED_AT, reverse: true) {
        pageInfo {
          hasNextPage
          endCursor
        }
        edges {
          cursor
          node {
            ${COLLECTION_FIELDS}
          }
        }
      }
    }
  `,
  pages: /* GraphQL */ `
    query Pages($first: Int!, $after: String, $query: String) {
      pages(first: $first, after: $after, query: $query, sortKey: UPDATED_AT, reverse: true) {
        pageInfo {
          hasNextPage
          endCursor
        }
        edges {
          cursor
          node {
            ${PAGE_FIELDS}
          }
        }
      }
    }
  `,
  blogs: /* GraphQL */ `
    query Blogs($first: Int!, $after: String, $query: String) {
      blogs(first: $first, after: $after, query: $query, sortKey: UPDATED_AT, reverse: true) {
        pageInfo {
          hasNextPage
          endCursor
        }
        edges {
          cursor
          node {
            ${BLOG_FIELDS}
          }
        }
      }
    }
  `,
  articles: /* GraphQL */ `
    query Articles($first: Int!, $after: String, $query: String, $blogId: ID) {
      articles(first: $first, after: $after, query: $query, blogId: $blogId, sortKey: UPDATED_AT, reverse: true) {
        pageInfo {
          hasNextPage
          endCursor
        }
        edges {
          cursor
          node {
            ${ARTICLE_FIELDS}
          }
        }
      }
    }
  `,
  themes: /* GraphQL */ `
    query Themes {
      themes {
        id
        name
        role
        updatedAt
      }
    }
  `,
  metafields: /* GraphQL */ `
    query Metafields($first: Int!, $after: String, $namespace: String, $ownerId: ID) {
      metafields(first: $first, after: $after, namespace: $namespace, ownerId: $ownerId) {
        pageInfo {
          hasNextPage
          endCursor
        }
        edges {
          cursor
          node {
            id
            namespace
            key
            value
            type
            ownerType
          }
        }
      }
    }
  `,
} as const;

export const MUTATIONS = {
  productUpdate: /* GraphQL */ `
    mutation ProductUpdate($input: ProductInput!) {
      productUpdate(input: $input) {
        product {
          ${PRODUCT_FIELDS}
        }
        userErrors {
          field
          message
        }
      }
    }
  `,
  pageUpdate: /* GraphQL */ `
    mutation PageUpdate($input: PageInput!) {
      pageUpdate(input: $input) {
        page {
          ${PAGE_FIELDS}
        }
        userErrors {
          field
          message
        }
      }
    }
  `,
  blogUpdate: /* GraphQL */ `
    mutation BlogUpdate($input: BlogInput!) {
      blogUpdate(input: $input) {
        blog {
          ${BLOG_FIELDS}
        }
        userErrors {
          field
          message
        }
      }
    }
  `,
  themeFilesUpsert: /* GraphQL */ `
    mutation ThemeFilesUpsert($themeId: ID!, $files: [ThemeFileInput!]!) {
      themeFilesUpsert(themeId: $themeId, files: $files) {
        upsertedThemeFiles {
          filename
        }
        userErrors {
          field
          message
        }
      }
    }
  `,
  fileCreate: /* GraphQL */ `
    mutation FileCreate($files: [FileCreateInput!]!) {
      fileCreate(files: $files) {
        files {
          id
          alt
          ... on MediaImage {
            image {
              url
            }
          }
        }
        userErrors {
          field
          message
        }
      }
    }
  `,
} as const;
