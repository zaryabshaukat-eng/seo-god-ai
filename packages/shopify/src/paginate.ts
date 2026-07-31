import type { Connection, PageInfo } from './types.js';

/** Fetches a single page; receives the cursor to resume from (null for the first page). */
export interface PageFetcher<T> {
  fetchPage(after: string | null): Promise<{ items: T[]; pageInfo: PageInfo }>;
}

export interface PaginateOptions {
  /**
   * Safety cap on the number of pages fetched. Prevents runaway loops if a
   * store returns an endless `hasNextPage`. Default 100.
   */
  maxPages?: number;
}

/**
 * Follows cursor-based pagination until `hasNextPage` is false, collecting
 * all items. Stops early if the end cursor repeats (infinite-loop guard).
 */
export async function paginate<T>(
  fetcher: PageFetcher<T>,
  options: PaginateOptions = {},
): Promise<Connection<T>> {
  const maxPages = options.maxPages ?? 100;
  const items: T[] = [];
  let after: string | null = null;
  let pageInfo: PageInfo = { hasNextPage: false, endCursor: null };

  for (let page = 0; page < maxPages; page += 1) {
    const result = await fetcher.fetchPage(after);
    items.push(...result.items);
    pageInfo = result.pageInfo;
    if (
      !result.pageInfo.hasNextPage ||
      result.pageInfo.endCursor == null ||
      result.pageInfo.endCursor === after
    ) {
      break;
    }
    after = result.pageInfo.endCursor;
  }

  return { items, pageInfo };
}
