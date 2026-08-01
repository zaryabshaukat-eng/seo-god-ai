import { Prisma, type AuditLog, type PrismaClient } from '@prisma/client';
import { ValidationError } from '@seogod/core';

export type AuditActorType = 'system' | 'user' | 'agent';

export interface AuditEntryInput {
  /** Imperative action, e.g. `store.install`, `page.update`, `approval.requested`. */
  action: string;
  actorType: AuditActorType;
  actorId?: string;
  storeId?: string;
  resourceType?: string;
  resourceId?: string;
  payload?: Prisma.InputJsonValue;
}

export interface AuditQueryOptions {
  storeId?: string;
  action?: string;
  limit?: number;
}

const ACTOR_TYPES: readonly AuditActorType[] = ['system', 'user', 'agent'];

/**
 * Appends to the immutable audit trail. Entries are never updated or
 * deleted; query them newest-first via {@link AuditService.list}.
 */
export class AuditService {
  constructor(private readonly prisma: PrismaClient) {}

  async log(input: AuditEntryInput): Promise<AuditLog> {
    const action = input.action.trim();
    if (action === '') {
      throw new ValidationError('Audit action must not be empty', {
        module: 'audit',
        operation: 'audit.log',
      });
    }
    if (!ACTOR_TYPES.includes(input.actorType)) {
      throw new ValidationError(`Unsupported actor type "${input.actorType}"`, {
        module: 'audit',
        operation: 'audit.log',
      });
    }
    return this.prisma.auditLog.create({
      data: {
        action,
        actorType: input.actorType,
        actorId: input.actorId,
        storeId: input.storeId,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        payload: input.payload ?? Prisma.JsonNull,
      },
    });
  }

  async list(options: AuditQueryOptions = {}): Promise<AuditLog[]> {
    const { storeId, action, limit = 100 } = options;
    return this.prisma.auditLog.findMany({
      where: { storeId, action },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }
}
