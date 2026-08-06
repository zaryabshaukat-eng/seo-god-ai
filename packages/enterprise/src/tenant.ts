/**
 * Multi-tenancy: tenant lifecycle management and the isolation primitives
 * that guarantee data never crosses tenant boundaries. `withTenantScope`
 * establishes a per-request tenant context (via `AsyncLocalStorage`);
 * `assertSameTenant` / `TenantScopedCollection` reject any read or write that
 * touches another tenant's records.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import {
  EnterpriseConflictError,
  EnterpriseIsolationError,
  EnterpriseNotFoundError,
  EnterpriseValidationError,
} from './errors.js';
import type { Tenant, TenantInput } from './types.js';
import { newId } from './utils.js';

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/;

export interface TenantServiceOptions {
  now?: () => string;
  id?: () => string;
}

/** Platform-level tenant lifecycle. */
export class TenantService {
  private readonly tenants = new Map<string, Tenant>();
  private readonly now: () => string;
  private readonly id: () => string;

  constructor(options: TenantServiceOptions = {}) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.id = options.id ?? (() => newId('tnt'));
  }

  /** Provisions a new tenant; rejects duplicate slugs. */
  async provision(input: TenantInput): Promise<Tenant> {
    validateSlug(input.slug);
    if (this.slugTaken(input.slug)) {
      throw new EnterpriseConflictError(`Tenant slug '${input.slug}' is already in use.`, {
        tenantId: input.slug,
      });
    }
    const timestamp = this.now();
    const tenant: Tenant = {
      tenantId: this.id(),
      name: input.name.trim(),
      slug: input.slug,
      status: 'active',
      planId: input.planId ?? 'free',
      createdAt: timestamp,
      updatedAt: timestamp,
      metadata: input.metadata === undefined ? undefined : { ...input.metadata },
    };
    this.tenants.set(tenant.tenantId, tenant);
    return copyTenant(tenant);
  }

  async get(tenantId: string): Promise<Tenant> {
    const tenant = this.tenants.get(tenantId);
    if (tenant === undefined) {
      throw new EnterpriseNotFoundError(`Tenant '${tenantId}' not found.`, { tenantId });
    }
    return copyTenant(tenant);
  }

  async list(): Promise<Tenant[]> {
    return [...this.tenants.values()].map(copyTenant);
  }

  async suspend(tenantId: string): Promise<Tenant> {
    const tenant = this.getOrThrow(tenantId);
    if (tenant.status === 'suspended') {
      throw new EnterpriseConflictError(`Tenant '${tenantId}' is already suspended.`, { tenantId });
    }
    tenant.status = 'suspended';
    tenant.updatedAt = this.now();
    return copyTenant(tenant);
  }

  async activate(tenantId: string): Promise<Tenant> {
    const tenant = this.getOrThrow(tenantId);
    if (tenant.status === 'active') {
      throw new EnterpriseConflictError(`Tenant '${tenantId}' is already active.`, { tenantId });
    }
    tenant.status = 'active';
    tenant.updatedAt = this.now();
    return copyTenant(tenant);
  }

  /** Soft-deletes a tenant (records are retained but inaccessible). */
  async remove(tenantId: string): Promise<void> {
    const tenant = this.getOrThrow(tenantId);
    tenant.status = 'deleted';
    tenant.updatedAt = this.now();
  }

  /** Throws when the tenant is not provisioned or not active. */
  async assertActive(tenantId: string): Promise<void> {
    const tenant = await this.get(tenantId);
    if (tenant.status === 'suspended') {
      throw new EnterpriseValidationError(`Tenant '${tenantId}' is suspended.`, { tenantId });
    }
    if (tenant.status === 'deleted') {
      throw new EnterpriseValidationError(`Tenant '${tenantId}' has been deleted.`, { tenantId });
    }
  }

  private getOrThrow(tenantId: string): Tenant {
    const tenant = this.tenants.get(tenantId);
    if (tenant === undefined) {
      throw new EnterpriseNotFoundError(`Tenant '${tenantId}' not found.`, { tenantId });
    }
    return tenant;
  }

  private slugTaken(slug: string): boolean {
    return [...this.tenants.values()].some((tenant) => tenant.slug === slug);
  }
}

function validateSlug(slug: string): void {
  if (!SLUG_PATTERN.test(slug)) {
    throw new EnterpriseValidationError(
      `Invalid tenant slug '${slug}'; use 3-32 lowercase letters, digits and hyphens.`,
    );
  }
}

function copyTenant(tenant: Tenant): Tenant {
  return {
    ...tenant,
    metadata: tenant.metadata === undefined ? undefined : { ...tenant.metadata },
  };
}

// ---------------------------------------------------------------------------
// Isolation primitives
// ---------------------------------------------------------------------------

const tenantContext = new AsyncLocalStorage<string | null>();

/**
 * Runs `fn` inside a tenant context. Services read `currentTenantId()` to
 * scope their work; `assertTenantContext` rejects mismatched access.
 */
export function withTenantScope<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
  return tenantContext.run(tenantId, fn);
}

/** The tenant id bound to the current async context, or `null`. */
export function currentTenantId(): string | null {
  return tenantContext.getStore() ?? null;
}

/**
 * Throws `EnterpriseIsolationError` when the current tenant context belongs to
 * a different tenant than the one being accessed.
 */
export function assertTenantContext(tenantId: string): void {
  const current = currentTenantId();
  if (current !== null && current !== tenantId) {
    throw new EnterpriseIsolationError(
      `Tenant '${tenantId}' is not accessible from the '${current}' tenant context.`,
      { tenantId },
    );
  }
}

/** Throws when two tenant ids differ — the core cross-tenant guard. */
export function assertSameTenant(recordTenantId: string, scopeTenantId: string): void {
  if (recordTenantId !== scopeTenantId) {
    throw new EnterpriseIsolationError(
      `Cross-tenant access denied: record belongs to tenant '${recordTenantId}', scope is '${scopeTenantId}'.`,
      { tenantId: scopeTenantId },
    );
  }
}

/** Filter a list to a single tenant (defensive; guards already enforce). */
export function scopeRecords<T extends { tenantId: string }>(records: readonly T[], tenantId: string): T[] {
  return records.filter((record) => record.tenantId === tenantId);
}

/**
 * An in-memory collection hard-bound to a single tenant. Every `save`/`find`
 * verifies the record belongs to the bound tenant and throws on any mismatch.
 */
export class TenantScopedCollection<T extends { tenantId: string }> {
  private readonly items = new Map<string, T>();

  constructor(
    private readonly tenantId: string,
    private readonly idOf: (item: T) => string,
  ) {}

  /** Saves a record, rejecting records bound to another tenant. */
  save(item: T): void {
    assertSameTenant(item.tenantId, this.tenantId);
    this.items.set(this.idOf(item), { ...item });
  }

  /** Looks up by id; missing records return `null`. */
  find(id: string): T | null {
    const item = this.items.get(id);
    if (item === undefined) return null;
    assertSameTenant(item.tenantId, this.tenantId);
    return { ...item };
  }

  /** All records for the bound tenant, newest first. */
  list(): T[] {
    return [...this.items.values()]
      .filter((item) => item.tenantId === this.tenantId)
      .sort((a, b) => {
        const aKey = this.idOf(a);
        const bKey = this.idOf(b);
        return aKey.localeCompare(bKey);
      })
      .map((item) => ({ ...item }));
  }

  /** Removes a record; returns true when it existed. */
  delete(id: string): boolean {
    const item = this.items.get(id);
    if (item === undefined) return false;
    assertSameTenant(item.tenantId, this.tenantId);
    return this.items.delete(id);
  }

  get size(): number {
    return [...this.items.values()].filter((item) => item.tenantId === this.tenantId).length;
  }
}
