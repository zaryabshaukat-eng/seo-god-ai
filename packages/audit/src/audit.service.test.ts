import { describe, expect, it } from 'vitest';
import type { AuditLog, PrismaClient } from '@prisma/client';
import { ValidationError } from '@seogod/core';
import { AuditService } from './audit.service.js';

function makeLog(overrides: Partial<AuditLog> = {}): AuditLog {
  return {
    id: `log-${Math.random()}`,
    storeId: null,
    actorType: 'system',
    actorId: null,
    action: 'test',
    resourceType: null,
    resourceId: null,
    payload: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function makeFakePrisma(): { prisma: PrismaClient; logs: AuditLog[] } {
  const logs: AuditLog[] = [];
  const prisma = {
    auditLog: {
      create: async (args: {
        data: {
          action: string;
          actorType: string;
          actorId?: string;
          storeId?: string;
          resourceType?: string;
          resourceId?: string;
          payload?: unknown;
        };
      }): Promise<AuditLog> => {
        const entry = makeLog({
          action: args.data.action,
          actorType: args.data.actorType as AuditLog['actorType'],
          actorId: args.data.actorId ?? null,
          storeId: args.data.storeId ?? null,
          resourceType: args.data.resourceType ?? null,
          resourceId: args.data.resourceId ?? null,
          payload: (args.data.payload ?? null) as AuditLog['payload'],
        });
        logs.push(entry);
        return entry;
      },
      findMany: async (args: {
        where: { storeId?: string; action?: string };
        orderBy?: unknown;
        take?: number;
      }): Promise<AuditLog[]> =>
        [...logs]
          .filter((entry) => {
            if (args.where.storeId !== undefined && entry.storeId !== args.where.storeId) return false;
            if (args.where.action !== undefined && entry.action !== args.where.action) return false;
            return true;
          })
          .slice(0, args.take),
    },
  };
  return { prisma: prisma as unknown as PrismaClient, logs };
}

describe('AuditService', () => {
  it('appends an entry with all fields', async () => {
    const { prisma, logs } = makeFakePrisma();
    const service = new AuditService(prisma);
    const entry = await service.log({
      action: 'store.install',
      actorType: 'user',
      actorId: 'user-1',
      storeId: 'store-1',
      resourceType: 'store',
      resourceId: 'store-1',
      payload: { scope: 'read_products' },
    });
    expect(entry.action).toBe('store.install');
    expect(entry.actorType).toBe('user');
    expect(logs).toHaveLength(1);
  });

  it('trims the action and rejects empty actions', async () => {
    const { prisma, logs } = makeFakePrisma();
    const service = new AuditService(prisma);
    await service.log({ action: '  page.update  ', actorType: 'system' });
    expect(logs[0]?.action).toBe('page.update');
    await expect(service.log({ action: '   ', actorType: 'system' })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('rejects unsupported actor types', async () => {
    const { prisma } = makeFakePrisma();
    const service = new AuditService(prisma);
    await expect(
      service.log({ action: 'x', actorType: 'robot' as never }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('lists entries newest-first with store and action filters', async () => {
    const { prisma } = makeFakePrisma();
    const service = new AuditService(prisma);
    await service.log({ action: 'store.install', actorType: 'system', storeId: 'store-1' });
    await service.log({ action: 'page.update', actorType: 'agent', storeId: 'store-1' });
    await service.log({ action: 'store.uninstall', actorType: 'system', storeId: 'store-2' });

    const all = await service.list();
    expect(all).toHaveLength(3);

    const store1 = await service.list({ storeId: 'store-1' });
    expect(store1).toHaveLength(2);

    const updates = await service.list({ storeId: 'store-1', action: 'page.update' });
    expect(updates).toHaveLength(1);
    expect(updates[0]?.actorType).toBe('agent');

    const limited = await service.list({ limit: 2 });
    expect(limited).toHaveLength(2);
  });
});
