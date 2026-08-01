import { describe, expect, it } from 'vitest';
import type { PrismaClient, Store } from '@prisma/client';
import { NotFoundError } from '@seogod/core';
import { StoreRepository } from './store.repository.js';

function makeStore(shopDomain: string, overrides: Partial<Store> = {}): Store {
  return {
    id: `store-${shopDomain}`,
    shopDomain,
    accessToken: null,
    scopes: [],
    installedAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function makeFakePrisma(): { prisma: PrismaClient; stores: Map<string, Store> } {
  const stores = new Map<string, Store>();
  const prisma = {
    store: {
      upsert: async (args: {
        where: { shopDomain: string };
        update: { accessToken?: string; scopes?: string[] };
        create: { shopDomain: string; accessToken?: string; scopes?: string[] };
      }): Promise<Store> => {
        const existing = stores.get(args.where.shopDomain);
        if (existing !== undefined) {
          const updated = { ...existing, ...args.update };
          stores.set(args.where.shopDomain, updated);
          return updated;
        }
        const created = makeStore(args.create.shopDomain, {
          accessToken: args.create.accessToken ?? null,
          scopes: args.create.scopes ?? [],
        });
        stores.set(created.shopDomain, created);
        return created;
      },
      findUnique: async (args: { where: { shopDomain: string } }): Promise<Store | null> =>
        stores.get(args.where.shopDomain) ?? null,
      delete: async (args: { where: { shopDomain: string } }): Promise<Store> => {
        const store = stores.get(args.where.shopDomain);
        if (store === undefined) throw new Error('Record not found');
        stores.delete(args.where.shopDomain);
        return store;
      },
      findMany: async (): Promise<Store[]> => [...stores.values()],
    },
  };
  return { prisma: prisma as unknown as PrismaClient, stores };
}

describe('StoreRepository', () => {
  it('creates a store on first install', async () => {
    const { prisma } = makeFakePrisma();
    const repo = new StoreRepository(prisma);
    const store = await repo.upsert({ shopDomain: 'acme.myshopify.com', accessToken: 'tok-1' });
    expect(store.shopDomain).toBe('acme.myshopify.com');
    expect(store.accessToken).toBe('tok-1');
  });

  it('updates token and scopes on reinstall', async () => {
    const { prisma } = makeFakePrisma();
    const repo = new StoreRepository(prisma);
    await repo.upsert({ shopDomain: 'acme.myshopify.com', accessToken: 'old' });
    const updated = await repo.upsert({
      shopDomain: 'acme.myshopify.com',
      accessToken: 'new',
      scopes: ['read_products'],
    });
    expect(updated.accessToken).toBe('new');
    expect(updated.scopes).toEqual(['read_products']);
  });

  it('gets a store by shop domain and null for unknown stores', async () => {
    const { prisma } = makeFakePrisma();
    const repo = new StoreRepository(prisma);
    await repo.upsert({ shopDomain: 'acme.myshopify.com' });
    expect((await repo.get('acme.myshopify.com'))?.shopDomain).toBe('acme.myshopify.com');
    expect(await repo.get('missing.myshopify.com')).toBeNull();
  });

  it('getOrThrow returns the store or throws NotFoundError', async () => {
    const { prisma } = makeFakePrisma();
    const repo = new StoreRepository(prisma);
    await repo.upsert({ shopDomain: 'acme.myshopify.com' });
    await expect(repo.getOrThrow('acme.myshopify.com')).resolves.toBeDefined();
    await expect(repo.getOrThrow('missing.myshopify.com')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('deletes a store', async () => {
    const { prisma } = makeFakePrisma();
    const repo = new StoreRepository(prisma);
    await repo.upsert({ shopDomain: 'acme.myshopify.com' });
    await repo.delete('acme.myshopify.com');
    expect(await repo.get('acme.myshopify.com')).toBeNull();
  });

  it('lists all stores', async () => {
    const { prisma } = makeFakePrisma();
    const repo = new StoreRepository(prisma);
    await repo.upsert({ shopDomain: 'a.myshopify.com' });
    await repo.upsert({ shopDomain: 'b.myshopify.com' });
    const stores = await repo.list();
    expect(stores).toHaveLength(2);
  });
});
