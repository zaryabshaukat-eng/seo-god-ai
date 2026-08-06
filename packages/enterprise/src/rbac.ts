/**
 * Role-based access control: canonical permissions, built-in roles and a
 * `RoleManager` that resolves role → permissions and enforces authorization
 * checks. Custom roles can be registered on top of the built-in set.
 */

import { EnterpriseAuthorizationError, EnterpriseValidationError } from './errors.js';
import type { CustomRole, Role } from './types.js';

/** Canonical permission strings. */
export const Permissions = {
  tenantRead: 'tenant.read',
  tenantManage: 'tenant.manage',
  orgRead: 'org.read',
  orgManage: 'org.manage',
  teamRead: 'team.read',
  teamManage: 'team.manage',
  memberManage: 'member.manage',
  auditRead: 'audit.read',
  apiKeyManage: 'apikey.manage',
  webhookManage: 'webhook.manage',
  billingRead: 'billing.read',
  billingManage: 'billing.manage',
} as const;

export type Permission = (typeof Permissions)[keyof typeof Permissions];

export const ALL_PERMISSIONS: readonly Permission[] = [
  Permissions.tenantRead,
  Permissions.tenantManage,
  Permissions.orgRead,
  Permissions.orgManage,
  Permissions.teamRead,
  Permissions.teamManage,
  Permissions.memberManage,
  Permissions.auditRead,
  Permissions.apiKeyManage,
  Permissions.webhookManage,
  Permissions.billingRead,
  Permissions.billingManage,
];

const READER_PERMISSIONS: readonly Permission[] = [
  Permissions.tenantRead,
  Permissions.orgRead,
  Permissions.teamRead,
  Permissions.auditRead,
];

/** Built-in role → permission mapping. The owner holds every permission. */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  owner: ALL_PERMISSIONS,
  admin: [
    Permissions.tenantRead,
    Permissions.tenantManage,
    Permissions.orgRead,
    Permissions.orgManage,
    Permissions.teamRead,
    Permissions.teamManage,
    Permissions.memberManage,
    Permissions.auditRead,
    Permissions.apiKeyManage,
    Permissions.webhookManage,
    Permissions.billingRead,
    Permissions.billingManage,
  ],
  member: READER_PERMISSIONS,
  viewer: [
    Permissions.tenantRead,
    Permissions.orgRead,
    Permissions.teamRead,
  ],
};

const BUILT_IN_ROLES: readonly Role[] = ['owner', 'admin', 'member', 'viewer'];

function assertKnownPermission(permission: string): asserts permission is Permission {
  if (!(ALL_PERMISSIONS as readonly string[]).includes(permission)) {
    throw new EnterpriseValidationError(`Unknown permission '${permission}'.`);
  }
}

/**
 * Resolves roles and enforces permissions. Keeps an optional registry of
 * custom roles so tenants can extend the built-in set.
 */
export class RoleManager {
  private readonly customRoles = new Map<string, readonly Permission[]>();

  constructor(customRoles: readonly CustomRole[] = []) {
    for (const role of customRoles) {
      this.defineRole(role);
    }
  }

  /** Registers (or replaces) a custom role definition. */
  defineRole(role: CustomRole): CustomRole {
    if (BUILT_IN_ROLES.includes(role.name as Role)) {
      throw new EnterpriseValidationError(`Cannot override built-in role '${role.name}'.`);
    }
    for (const permission of role.permissions) {
      assertKnownPermission(permission);
    }
    const permissions = role.permissions.slice() as Permission[];
    this.customRoles.set(role.name, permissions);
    return { name: role.name, permissions };
  }

  /** True when `role` is a known built-in or registered custom role. */
  isKnownRole(role: string): boolean {
    return BUILT_IN_ROLES.includes(role as Role) || this.customRoles.has(role);
  }

  /** All permissions granted to a role (built-in or custom). */
  permissionsFor(role: string): readonly Permission[] {
    const builtIn = ROLE_PERMISSIONS[role as Role];
    if (builtIn !== undefined) return builtIn;
    const custom = this.customRoles.get(role);
    return custom ?? [];
  }

  /** True when the role has the permission. */
  hasPermission(role: string, permission: Permission): boolean {
    return this.permissionsFor(role).includes(permission);
  }

  /** True when the role has any of the given permissions. */
  hasAnyPermission(role: string, permissions: readonly Permission[]): boolean {
    const granted = this.permissionsFor(role);
    return permissions.some((permission) => granted.includes(permission));
  }

  /** Throws `EnterpriseAuthorizationError` unless the role is allowed. */
  requirePermission(
    role: string,
    permission: Permission,
    context: { userId?: string; tenantId?: string } = {},
  ): void {
    if (!this.hasPermission(role, permission)) {
      throw new EnterpriseAuthorizationError(
        `Role '${role}' is not allowed to perform '${permission}'.`,
        { permission, userId: context.userId, tenantId: context.tenantId },
      );
    }
  }
}
