import type { PrismaClient, Store } from '@prisma/client';
import { NotFoundError } from '@seogod/core';

export interface StoreUpsertInput {
  shopDomain: string;
  accessToken?: string;
  scopes?: string[];
}

/**
 * Persistence for connected Shopify stores. `accessToken` is always stored
 * already encrypted (see `@seogod/shared` / `@seogod/shopify`).
 */
export class StoreRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /** Creates the store on install or updates its token/scopes on reinstall. */
  async upsert(input: StoreUpsertInput): Promise<Store> {
    return this.prisma.store.upsert({
      where: { shopDomain: input.shopDomain },
      update: {
        accessToken: input.accessToken,
        scopes: input.scopes,
      },
      create: {
        shopDomain: input.shopDomain,
        accessToken: input.accessToken,
        scopes: input.scopes ?? [],
      },
    });
  }

  async get(shopDomain: string): Promise<Store | null> {
    return this.prisma.store.findUnique({ where: { shopDomain } });
  }

  async getOrThrow(shopDomain: string): Promise<Store> {
    const store = await this.get(shopDomain);
    if (store === null) {
      throw new NotFoundError(`Store "${shopDomain}" not found`, {
        module: 'database',
        operation: 'store.getOrThrow',
        context: { shopDomain },
      });
    }
    return store;
  }

  async delete(shopDomain: string): Promise<void> {
    await this.prisma.store.delete({ where: { shopDomain } });
  }

  async list(): Promise<Store[]> {
    return this.prisma.store.findMany({ orderBy: { installedAt: 'desc' } });
  }
}
