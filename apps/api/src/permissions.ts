/**
 * Platform permissions and RBAC. The API exposes feature-level permissions
 * (`dashboard.read`, `crawl.write`, ...) that map to the platform routes;
 * user roles resolve to the permission sets below, mirroring the web client's
 * permission vocabulary while delegating tenant/org administration to
 * `@seogod/enterprise`.
 */

import { ForbiddenError, UnauthorizedError } from './errors.js';

export const PlatformPermissions = {
  dashboardRead: 'dashboard.read',
  crawlRead: 'crawl.read',
  crawlWrite: 'crawl.write',
  seoRead: 'seo.read',
  seoWrite: 'seo.write',
  executionRead: 'execution.read',
  executionWrite: 'execution.write',
  observabilityRead: 'observability.read',
  reportsRead: 'reports.read',
  reportsWrite: 'reports.write',
  copilotRead: 'copilot.read',
  copilotWrite: 'copilot.write',
  adminRead: 'admin.read',
  adminWrite: 'admin.write',
  settingsRead: 'settings.read',
  settingsWrite: 'settings.write',
  notificationsRead: 'notifications.read',
} as const;

export type PlatformPermission = (typeof PlatformPermissions)[keyof typeof PlatformPermissions];

export const ALL_PLATFORM_PERMISSIONS: readonly PlatformPermission[] = Object.values(PlatformPermissions);

export type Role = 'owner' | 'admin' | 'member' | 'viewer';

const READ_PERMISSIONS: readonly PlatformPermission[] = [
  PlatformPermissions.dashboardRead,
  PlatformPermissions.crawlRead,
  PlatformPermissions.seoRead,
  PlatformPermissions.executionRead,
  PlatformPermissions.observabilityRead,
  PlatformPermissions.reportsRead,
  PlatformPermissions.copilotRead,
  PlatformPermissions.settingsRead,
  PlatformPermissions.notificationsRead,
];

export const ROLE_PERMISSIONS: Record<Role, readonly PlatformPermission[]> = {
  owner: ALL_PLATFORM_PERMISSIONS,
  admin: ALL_PLATFORM_PERMISSIONS,
  member: [...READ_PERMISSIONS, PlatformPermissions.copilotWrite, PlatformPermissions.reportsWrite],
  viewer: READ_PERMISSIONS,
};

/** Resolves the platform permissions granted to a role. */
export function permissionsForRole(role: string): readonly PlatformPermission[] {
  return ROLE_PERMISSIONS[role as Role] ?? [];
}

/** True when `role` grants `permission`. */
export function roleHasPermission(role: string, permission: PlatformPermission): boolean {
  return permissionsForRole(role).includes(permission);
}

/** True when `principal` may perform `permission`; false otherwise. */
export function principalHasPermission(
  principal: { role: string; permissions?: readonly string[] },
  permission: PlatformPermission,
): boolean {
  if (principal.permissions !== undefined && principal.permissions.length > 0) {
    return principal.permissions.includes(permission);
  }
  return roleHasPermission(principal.role, permission);
}

/** Throws unless `principal` is authorized for `permission`. */
export function requirePlatformPermission(
  principal: { role: string; permissions?: readonly string[] } | undefined,
  permission: PlatformPermission,
): void {
  if (principal === undefined) {
    throw new UnauthorizedError('Authentication is required.');
  }
  if (!principalHasPermission(principal, permission)) {
    throw new ForbiddenError(`Role '${principal.role}' is not allowed to perform '${permission}'.`);
  }
}
