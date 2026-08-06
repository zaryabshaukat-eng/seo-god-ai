/**
 * Role-based permission enforcement for copilot operations.
 *
 * Permission strings use the enterprise vocabulary (`tenant.read`, `org.read`,
 * `org.manage`, ...) so the copilot can be wired straight into the enterprise
 * `authorize` guard. The `Authorizer` is structural; the host decides who can
 * do what.
 */

import { CopilotAuthorizationError } from './errors.js';

/** Canonical copilot permission strings (enterprise vocabulary). */
export const COPILOT_PERMISSIONS = {
  /** Required just to start a conversation. */
  chat: 'tenant.read',
  /** Read-only data tools (recommendations, metrics, reports, alerts). */
  read: 'org.read',
  /** State-changing tools (plans, safe-action suggestions). */
  manage: 'org.manage',
  /** Audit trail access. */
  audit: 'audit.read',
} as const;

export type CopilotPermission = (typeof COPILOT_PERMISSIONS)[keyof typeof COPILOT_PERMISSIONS];

export interface PermissionContext {
  userId?: string;
  tenantId?: string;
}

/** Throws when the role lacks `permission`; no-op when no guard is wired. */
export type Authorizer = (
  role: string,
  permission: string,
  context?: PermissionContext,
) => void;

/** Role → permission sets for standalone deployments. */
export interface RolePolicy {
  role: string;
  permissions: readonly string[];
}

/**
 * Builds an authorizer from a simple role→permissions map. Owner/admin style
 * roles can be granted every copilot permission by passing `['*']`.
 */
export function fromRolePolicy(roles: readonly RolePolicy[]): Authorizer {
  const policy = new Map(roles.map((role) => [role.role, role.permissions]));
  return (role, permission) => {
    const granted = policy.get(role) ?? [];
    const allowed = granted.includes('*') || granted.includes(permission);
    if (!allowed) {
      throwDenied(role, permission);
    }
  };
}

/** Authorizes a tool call, throwing a copilot authorization error on denial. */
export function assertAuthorized(
  authorize: Authorizer | undefined,
  role: string,
  permission: string,
  context?: PermissionContext,
): void {
  if (authorize === undefined) return;
  authorize(role, permission, context);
}

export function throwDenied(role: string, permission: string): never {
  throw new CopilotAuthorizationError(`Role '${role}' is not allowed to perform '${permission}'.`, {
    context: { role, permission },
    operation: 'copilot.authorize',
  });
}

// ---------------------------------------------------------------------------
// Enterprise adapter
// ---------------------------------------------------------------------------

import type { EnterpriseService } from '@seogod/enterprise';
import type { Permission } from '@seogod/enterprise';

/**
 * Adapts the enterprise `authorize` guard into a copilot `Authorizer`.
 * Permission strings must already use the enterprise vocabulary.
 */
export function fromEnterprise(authorize: EnterpriseService['authorize']): Authorizer {
  return (role, permission, context) => {
    authorize(role, permission as Permission, context ?? {});
  };
}
