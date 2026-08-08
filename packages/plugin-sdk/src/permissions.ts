/**
 * Plugin capability model. Every contribution kind maps to a required
 * permission; a plugin must declare the permission in its manifest and the
 * host must approve it before the plugin is installed. At dispatch time the
 * registry re-checks the granted (effective) permission set so a plugin can
 * never run a contribution it was not approved for.
 */

import { PluginError, PluginErrorCode } from './errors.js';

export const PluginPermissions = {
  /** Contribute and run custom SEO analyzers. */
  analyzers: 'plugin.analyzers.run',
  /** Contribute AI Copilot tools and execute them. */
  tools: 'plugin.tools.execute',
  /** Declare and call external service integrations. */
  integrations: 'plugin.integrations.use',
  /** Register custom report generators. */
  reports: 'plugin.reports.generate',
  /** Subscribe to platform events. */
  events: 'plugin.events.subscribe',
  /** Register execution actions. */
  actions: 'plugin.execution.actions',
  /** Declare UI extension points. */
  ui: 'plugin.ui.extensions',
} as const;

export type PluginPermission = (typeof PluginPermissions)[keyof typeof PluginPermissions];

export const ALL_PLUGIN_PERMISSIONS: readonly PluginPermission[] = Object.values(PluginPermissions);

/** Contribution kinds a plugin can declare. */
export type ContributionKind =
  | 'analyzers'
  | 'tools'
  | 'integrations'
  | 'reportGenerators'
  | 'eventSubscribers'
  | 'executionActions'
  | 'uiExtensions';

export const CONTRIBUTION_KINDS: readonly ContributionKind[] = [
  'analyzers',
  'tools',
  'integrations',
  'reportGenerators',
  'eventSubscribers',
  'executionActions',
  'uiExtensions',
];

const DEFAULT_PERMISSIONS: Record<ContributionKind, PluginPermission> = {
  analyzers: PluginPermissions.analyzers,
  tools: PluginPermissions.tools,
  integrations: PluginPermissions.integrations,
  reportGenerators: PluginPermissions.reports,
  eventSubscribers: PluginPermissions.events,
  executionActions: PluginPermissions.actions,
  uiExtensions: PluginPermissions.ui,
};

/** The permission a contribution of `kind` requires by default. */
export function defaultPermissionFor(kind: ContributionKind): PluginPermission {
  return DEFAULT_PERMISSIONS[kind];
}

/** The permission required by a contribution with an explicit override. */
export function permissionFor(kind: ContributionKind, declared?: string): string {
  return declared ?? defaultPermissionFor(kind);
}

/** True when `permission` is a known plugin permission string. */
export function isPluginPermission(permission: string): boolean {
  return (ALL_PLUGIN_PERMISSIONS as readonly string[]).includes(permission);
}

/**
 * Intersects the permissions a plugin requests with the permissions the host
 * allows. An install whose request exceeds the host policy is rejected.
 */
export function approvePermissions(requested: readonly string[], allowed: readonly string[]): string[] {
  const allow = new Set(allowed);
  return [...new Set(requested)].filter((permission) => allow.has(permission));
}

/**
 * Ensures every requested permission is granted; throws with the first
 * ungranted one otherwise. Returns the deduplicated granted list.
 */
export function requireGranted(requested: readonly string[], allowed: readonly string[]): string[] {
  const unique = [...new Set(requested)];
  const granted = approvePermissions(unique, allowed);
  const missing = unique.find((permission) => !granted.includes(permission));
  if (missing === undefined) return granted;
  throw new PluginError(PluginErrorCode.permissionNotGranted, `Permission '${missing}' was not granted by the host.`, {
    context: { requested: unique, granted },
  });
}
