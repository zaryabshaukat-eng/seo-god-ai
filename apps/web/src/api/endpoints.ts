import type { EndpointSpec, Permission } from '../types.js';

/** Canonical UI-side permissions. Mirrors the `@seogod/enterprise` vocabulary. */
export const Permissions = {
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
} as const satisfies Record<string, Permission>;

export type UiPermission = (typeof Permissions)[keyof typeof Permissions];

export const ALL_UI_PERMISSIONS: readonly Permission[] = Object.values(Permissions);

/** Registry of every endpoint the Web UI can call. */
export const ENDPOINTS = {
  // Auth
  login: { method: 'POST', path: '/api/v1/auth/login', auth: false },
  register: { method: 'POST', path: '/api/v1/auth/register', auth: false },
  resetPassword: { method: 'POST', path: '/api/v1/auth/reset-password', auth: false },
  refresh: { method: 'POST', path: '/api/v1/auth/refresh', auth: false },
  me: { method: 'GET', path: '/api/v1/auth/me', auth: true },
  logout: { method: 'POST', path: '/api/v1/auth/logout', auth: true },

  // Dashboard
  dashboardOverview: {
    method: 'GET',
    path: '/api/v1/dashboard/overview',
    auth: true,
    permission: Permissions.dashboardRead,
  },
  dashboardTrends: {
    method: 'GET',
    path: '/api/v1/dashboard/trends',
    auth: true,
    permission: Permissions.dashboardRead,
  },

  // Crawl management
  crawlsList: { method: 'GET', path: '/api/v1/crawls', auth: true, permission: Permissions.crawlRead },
  crawlsStart: { method: 'POST', path: '/api/v1/crawls', auth: true, permission: Permissions.crawlWrite },
  crawlsGet: { method: 'GET', path: '/api/v1/crawls/:id', auth: true, permission: Permissions.crawlRead },
  crawlsCancel: {
    method: 'POST',
    path: '/api/v1/crawls/:id/cancel',
    auth: true,
    permission: Permissions.crawlWrite,
  },

  // SEO analysis
  seoRecommendations: {
    method: 'GET',
    path: '/api/v1/seo/recommendations',
    auth: true,
    permission: Permissions.seoRead,
  },
  seoBreakdown: { method: 'GET', path: '/api/v1/seo/breakdown', auth: true, permission: Permissions.seoRead },
  seoRecommendationUpdate: {
    method: 'PATCH',
    path: '/api/v1/seo/recommendations/:id',
    auth: true,
    permission: Permissions.seoWrite,
  },

  // Execution management
  executionsList: {
    method: 'GET',
    path: '/api/v1/executions',
    auth: true,
    permission: Permissions.executionRead,
  },
  executionsGet: { method: 'GET', path: '/api/v1/executions/:id', auth: true, permission: Permissions.executionRead },
  executionsApprove: {
    method: 'POST',
    path: '/api/v1/executions/:id/approve',
    auth: true,
    permission: Permissions.executionWrite,
  },
  executionsReject: {
    method: 'POST',
    path: '/api/v1/executions/:id/reject',
    auth: true,
    permission: Permissions.executionWrite,
  },
  executionsRollback: {
    method: 'POST',
    path: '/api/v1/executions/:id/rollback',
    auth: true,
    permission: Permissions.executionWrite,
  },
  executionsRun: {
    method: 'POST',
    path: '/api/v1/executions/:id/run',
    auth: true,
    permission: Permissions.executionWrite,
  },

  // Observability
  obsOverview: {
    method: 'GET',
    path: '/api/v1/observability/overview',
    auth: true,
    permission: Permissions.observabilityRead,
  },
  obsMetrics: {
    method: 'GET',
    path: '/api/v1/observability/metrics',
    auth: true,
    permission: Permissions.observabilityRead,
  },
  obsAlerts: {
    method: 'GET',
    path: '/api/v1/observability/alerts',
    auth: true,
    permission: Permissions.observabilityRead,
  },
  obsTimeline: {
    method: 'GET',
    path: '/api/v1/observability/timeline',
    auth: true,
    permission: Permissions.observabilityRead,
  },
  alertsAcknowledge: {
    method: 'POST',
    path: '/api/v1/observability/alerts/:id/acknowledge',
    auth: true,
    permission: Permissions.observabilityRead,
  },

  // Reports
  reportsList: { method: 'GET', path: '/api/v1/reports', auth: true, permission: Permissions.reportsRead },
  reportsGenerate: {
    method: 'POST',
    path: '/api/v1/reports',
    auth: true,
    permission: Permissions.reportsWrite,
  },
  reportsGet: { method: 'GET', path: '/api/v1/reports/:id', auth: true, permission: Permissions.reportsRead },

  // AI Copilot
  copilotSessions: {
    method: 'GET',
    path: '/api/v1/copilot/sessions',
    auth: true,
    permission: Permissions.copilotRead,
  },
  copilotChat: {
    method: 'POST',
    path: '/api/v1/copilot/chat',
    auth: true,
    permission: Permissions.copilotWrite,
  },

  // Enterprise administration
  tenantsList: { method: 'GET', path: '/api/v1/admin/tenants', auth: true, permission: Permissions.adminRead },
  tenantsCreate: {
    method: 'POST',
    path: '/api/v1/admin/tenants',
    auth: true,
    permission: Permissions.adminWrite,
  },
  orgsList: { method: 'GET', path: '/api/v1/admin/orgs', auth: true, permission: Permissions.adminRead },
  teamsList: { method: 'GET', path: '/api/v1/admin/teams', auth: true, permission: Permissions.adminRead },
  membersList: { method: 'GET', path: '/api/v1/admin/members', auth: true, permission: Permissions.adminRead },
  membersInvite: {
    method: 'POST',
    path: '/api/v1/admin/members/invite',
    auth: true,
    permission: Permissions.adminWrite,
  },
  membersUpdateRole: {
    method: 'PATCH',
    path: '/api/v1/admin/members/:id/role',
    auth: true,
    permission: Permissions.adminWrite,
  },
  auditList: { method: 'GET', path: '/api/v1/admin/audit', auth: true, permission: Permissions.adminRead },
  apiKeysList: { method: 'GET', path: '/api/v1/admin/api-keys', auth: true, permission: Permissions.adminRead },
  apiKeysCreate: {
    method: 'POST',
    path: '/api/v1/admin/api-keys',
    auth: true,
    permission: Permissions.adminWrite,
  },
  apiKeysRevoke: {
    method: 'DELETE',
    path: '/api/v1/admin/api-keys/:id',
    auth: true,
    permission: Permissions.adminWrite,
  },
  webhooksList: { method: 'GET', path: '/api/v1/admin/webhooks', auth: true, permission: Permissions.adminRead },
  webhooksCreate: {
    method: 'POST',
    path: '/api/v1/admin/webhooks',
    auth: true,
    permission: Permissions.adminWrite,
  },
  billingGet: { method: 'GET', path: '/api/v1/admin/billing', auth: true, permission: Permissions.adminRead },

  // Settings
  settingsGet: { method: 'GET', path: '/api/v1/settings', auth: true, permission: Permissions.settingsRead },
  settingsUpdate: {
    method: 'PUT',
    path: '/api/v1/settings',
    auth: true,
    permission: Permissions.settingsWrite,
  },
  profileUpdate: { method: 'PATCH', path: '/api/v1/settings/profile', auth: true, permission: Permissions.settingsWrite },

  // Notifications
  notificationsList: {
    method: 'GET',
    path: '/api/v1/notifications',
    auth: true,
    permission: Permissions.notificationsRead,
  },
  notificationsMarkRead: {
    method: 'POST',
    path: '/api/v1/notifications/:id/read',
    auth: true,
    permission: Permissions.notificationsRead,
  },
  notificationsMarkAllRead: {
    method: 'POST',
    path: '/api/v1/notifications/read-all',
    auth: true,
    permission: Permissions.notificationsRead,
  },
} as const satisfies Record<string, EndpointSpec>;

export type EndpointName = keyof typeof ENDPOINTS;

/** Looks up the endpoint spec by name. */
export function endpoint(name: EndpointName): EndpointSpec {
  return ENDPOINTS[name] as unknown as EndpointSpec;
}

/** Returns the permission required to call an endpoint, if any. */
export function endpointPermission(name: EndpointName): Permission | undefined {
  return endpoint(name).permission;
}

/** Returns whether an endpoint requires authentication. */
export function endpointAuth(name: EndpointName): boolean {
  return ENDPOINTS[name].auth;
}

/**
 * Interpolates `:param` placeholders in an endpoint path.
 * Unknown placeholders are left untouched so typos surface loudly.
 */
export function endpointPath(name: EndpointName, params: Record<string, string | number> = {}): string {
  return ENDPOINTS[name].path.replace(/:([a-zA-Z]+)/g, (match, key: string) => {
    return key in params ? String(params[key]) : match;
  });
}
