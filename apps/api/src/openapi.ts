/**
 * OpenAPI document generation. `buildOpenApi` renders the router's full route
 * table into a valid OpenAPI 3.0.3 document. Handlers carry no schema, so
 * each operation is described by a small metadata registry (operation ids,
 * tags, request bodies, security) with sensible generated fallbacks for the
 * rest. The document is served at `/api/v1/openapi.json`.
 */

import type { Platform } from './platform.js';
import type { Router } from './router.js';
import { guard } from './guards.js';
import { sendJson } from './http.js';

export interface OpenApiSchema {
  type?: string;
  format?: string;
  required?: string[];
  properties?: Record<string, OpenApiSchema>;
  items?: OpenApiSchema;
  enum?: readonly string[];
  additionalProperties?: boolean | OpenApiSchema;
}

export interface OpenApiOperationMeta {
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  /** Security requirement; `null` means anonymous. */
  auth?: boolean;
  requestBody?: OpenApiSchema;
  /** Query parameter name + schema for GET-style filters. */
  queryParams?: Array<{ name: string; schema: OpenApiSchema; required?: boolean }>;
  responses?: Record<string, OpenApiSchema>;
}

export interface OpenApiDocument {
  openapi: '3.0.3';
  info: { title: string; version: string; description?: string };
  servers: Array<{ url: string }>;
  tags: Array<{ name: string; description?: string }>;
  paths: Record<string, Record<string, unknown>>;
  components: { securitySchemes: Record<string, unknown> };
}

const ERROR_SCHEMA: OpenApiSchema = {
  type: 'object',
  properties: {
    error: {
      type: 'object',
      properties: {
        code: { type: 'string' },
        message: { type: 'string' },
        context: { type: 'object', additionalProperties: true },
        retryable: { type: 'boolean' },
      },
    },
  },
};

function operationMeta(path: string, method: string): OpenApiOperationMeta | undefined {
  const key = `${method} ${path}`;
  return OPERATION_META[key] ?? OPERATION_META[`${method} ${path.replace(/:([a-zA-Z]+)/g, '{$1}')}`];
}

/** Curated (or derived) operation id for a route; reused by the SDK generator. */
export function operationIdOf(method: string, path: string): string {
  return operationMeta(path, method)?.operationId ?? defaultOperationId(method, path);
}

/** Builds the OpenAPI document for the router's registered routes. */
export function buildOpenApi(router: Router, options: { version?: string; baseUrl?: string } = {}): OpenApiDocument {
  const paths: Record<string, Record<string, unknown>> = {};
  const tagNames = new Set<string>(['Auth', 'Dashboard', 'Crawls', 'SEO', 'Executions', 'Observability', 'Reports', 'Copilot', 'Admin', 'Settings', 'Notifications', 'Webhooks', 'Realtime', 'Plugins']);

  for (const route of router.list()) {
    const method = route.method.toLowerCase();
    const openApiPath = route.path.replace(/:([a-zA-Z]+)/g, '{$1}');
    const meta = operationMeta(route.path, route.method);
    const segments = route.path.split('/').filter((segment) => segment.startsWith(':'));
    const pathParams = segments.map((segment) => ({
      name: segment.slice(1),
      in: 'path',
      required: true,
      schema: { type: 'string' },
    }));
    const queryParams =
      meta?.queryParams?.map((parameter) => ({
        name: parameter.name,
        in: 'query',
        required: parameter.required ?? false,
        schema: parameter.schema,
      })) ?? [];
    const security = meta?.auth === false ? [] : [{ bearerAuth: [] }];
    const requestBody =
      meta?.requestBody === undefined
        ? undefined
        : {
            required: true,
            content: { 'application/json': { schema: meta.requestBody } },
          };

    const entry = paths[openApiPath] ?? {};
    entry[method] = {
      operationId: meta?.operationId ?? defaultOperationId(route.method, route.path),
      summary: meta?.summary,
      description: meta?.description,
      tags: meta?.tags ?? [defaultTag(route.path)],
      security,
      ...(requestBody === undefined ? {} : { requestBody }),
      parameters: [...pathParams, ...queryParams],
      responses: {
        ...defaultResponses(route.method),
        ...(meta?.responses === undefined
          ? {}
          : Object.fromEntries(
              Object.entries(meta.responses).map(([code, schema]) => [
                code,
                { description: `${code} response`, content: { 'application/json': { schema } } },
              ]),
            )),
      },
    };
    paths[openApiPath] = entry;
  }

  const tags = [...tagNames].sort().map((name) => ({ name }));

  return {
    openapi: '3.0.3',
    info: {
      title: 'SEO GOD AI API',
      version: options.version ?? '0.3.5',
      description:
        'REST + streaming API for the SEO GOD AI platform: auth, dashboards, crawls, SEO analysis, executions, observability, reports, AI Copilot, administration, plugins, settings, notifications, webhooks and real-time events.',
    },
    servers: [{ url: options.baseUrl ?? '/api/v1' }],
    tags,
    paths,
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
    },
  };
}

function defaultResponses(method: string): Record<string, unknown> {
  const okStatus = method === 'POST' ? 201 : method === 'DELETE' ? 204 : 200;
  return {
    [okStatus]: { description: 'Success' },
    '400': { description: 'Bad request', content: { 'application/json': { schema: ERROR_SCHEMA } } },
    '401': { description: 'Unauthorized', content: { 'application/json': { schema: ERROR_SCHEMA } } },
    '403': { description: 'Forbidden', content: { 'application/json': { schema: ERROR_SCHEMA } } },
    '404': { description: 'Not found', content: { 'application/json': { schema: ERROR_SCHEMA } } },
    '429': { description: 'Rate limited', content: { 'application/json': { schema: ERROR_SCHEMA } } },
  };
}

function defaultOperationId(method: string, path: string): string {
  const segments = splitPathNoApi(path);
  const literals = segments.filter((segment) => !segment.startsWith(':')).map(capitalize);
  const base = literals.join('') || 'Root';
  const last = literals.at(-1) ?? '';
  if (method === 'POST') {
    const actions = ['cancel', 'approve', 'reject', 'rollback', 'run', 'read', 'read-all', 'acknowledge', 'invite', 'test', 'publish', 'generate'];
    if (actions.includes(last.toLowerCase())) {
      const prefix = base.slice(0, base.length - last.length);
      const verb = `${last.charAt(0).toLowerCase()}${last.slice(1)}`.replace('-', '');
      return `${verb}${prefix}`;
    }
    return `create${base}`;
  }
  if (method === 'GET') {
    return `${path.includes(':') ? 'get' : 'list'}${base}`;
  }
  if (method === 'DELETE') {
    return `delete${base}`;
  }
  return `update${base}`;
}

function splitPathNoApi(path: string): string[] {
  const stripped = path.replace(/^\/api\/v1\//, '');
  return stripped.split('/').filter((segment) => segment.length > 0);
}

function defaultTag(path: string): string {
  const segment = path.replace(/^\/api\/v1\//, '').split('/')[0] || 'Auth';
  return capitalize(segment);
}

function capitalize(value: string): string {
  return value.length === 0 ? value : (value[0] ?? '').toUpperCase() + value.slice(1);
}

/** Registers the OpenAPI discovery endpoint. */
export function registerOpenApiRoutes(platform: Platform, router: Router): void {
  router.on('GET', '/api/v1/openapi.json', guard(platform, { auth: false }, async (ctx) => {
    sendJson(ctx.res, 200, buildOpenApi(router, { version: '0.3.5' }));
  }));
}

const OBJECT_SCHEMA: OpenApiSchema = { type: 'object', additionalProperties: true };

/** Metadata registry enriching the generated OpenAPI operations. */
const OPERATION_META: Record<string, OpenApiOperationMeta> = {
  'POST /api/v1/auth/register': {
    operationId: 'register',
    tags: ['Auth'],
    auth: false,
    summary: 'Register a new tenant and owner account.',
    requestBody: {
      type: 'object',
      required: ['name', 'email', 'password', 'storeName'],
      properties: { name: { type: 'string' }, email: { type: 'string', format: 'email' }, password: { type: 'string' }, storeName: { type: 'string' } },
    },
  },
  'POST /api/v1/auth/login': {
    operationId: 'login',
    tags: ['Auth'],
    auth: false,
    summary: 'Log in and receive access + refresh tokens.',
    requestBody: { type: 'object', required: ['email', 'password'], properties: { email: { type: 'string' }, password: { type: 'string' } } },
  },
  'POST /api/v1/auth/refresh': {
    operationId: 'refresh',
    tags: ['Auth'],
    auth: false,
    summary: 'Rotate a refresh token into a new session pair.',
    requestBody: { type: 'object', required: ['refreshToken'], properties: { refreshToken: { type: 'string' } } },
  },
  'POST /api/v1/auth/reset-password': {
    operationId: 'requestPasswordReset',
    tags: ['Auth'],
    auth: false,
    summary: 'Request a password reset for an email.',
    requestBody: { type: 'object', required: ['email'], properties: { email: { type: 'string' } } },
  },
  'GET /api/v1/auth/me': {
    operationId: 'me',
    tags: ['Auth'],
    summary: 'Return the authenticated caller.',
    responses: {
      '200': {
        type: 'object',
        properties: {
          user: { type: 'object', properties: { id: { type: 'string' }, email: { type: 'string' }, role: { type: 'string' } } },
          permissions: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
  'POST /api/v1/auth/logout': { operationId: 'logout', tags: ['Auth'], summary: 'Revoke the current session.' },

  'GET /api/v1/dashboard/overview': { operationId: 'dashboardOverview', tags: ['Dashboard'], summary: 'Dashboard KPIs plus settings and unread notifications.', queryParams: [{ name: 'storeId', schema: { type: 'string' } }] },
  'GET /api/v1/dashboard/trends': { operationId: 'dashboardTrends', tags: ['Dashboard'], summary: 'SEO, execution and performance trend timelines.', queryParams: [{ name: 'storeId', schema: { type: 'string' } }, { name: 'limit', schema: { type: 'number' } }] },

  'GET /api/v1/crawls': { operationId: 'listCrawls', tags: ['Crawls'], summary: 'List crawl jobs.', queryParams: [{ name: 'storeId', schema: { type: 'string' } }] },
  'POST /api/v1/crawls': { operationId: 'startCrawl', tags: ['Crawls'], summary: 'Start a crawl.', requestBody: { type: 'object', required: ['storeId'], properties: { storeId: { type: 'string' }, seeds: { type: 'array', items: { type: 'string' } } } } },
  'GET /api/v1/crawls/{id}': { operationId: 'getCrawl', tags: ['Crawls'], summary: 'Fetch a crawl job.' },
  'POST /api/v1/crawls/{id}/cancel': { operationId: 'cancelCrawl', tags: ['Crawls'], summary: 'Cancel a crawl job.' },

  'GET /api/v1/seo/recommendations': { operationId: 'listRecommendations', tags: ['SEO'], summary: 'SEO recommendations from the latest snapshot.', queryParams: [{ name: 'storeId', schema: { type: 'string' } }] },
  'GET /api/v1/seo/breakdown': { operationId: 'seoBreakdown', tags: ['SEO'], summary: 'Per-category score breakdown.', queryParams: [{ name: 'storeId', schema: { type: 'string' } }] },
  'PATCH /api/v1/seo/recommendations/{id}': { operationId: 'updateRecommendationStatus', tags: ['SEO'], summary: 'Set recommendation status.', requestBody: { type: 'object', required: ['status'], properties: { status: { type: 'string', enum: ['open', 'planned', 'resolved'] } } } },

  'GET /api/v1/executions': { operationId: 'listExecutions', tags: ['Executions'], summary: 'List execution records.', queryParams: [{ name: 'storeId', schema: { type: 'string' } }] },
  'GET /api/v1/executions/{id}': { operationId: 'getExecution', tags: ['Executions'], summary: 'Fetch one execution.' },
  'POST /api/v1/executions/{id}/approve': { operationId: 'approveExecution', tags: ['Executions'], summary: 'Approve an execution.' },
  'POST /api/v1/executions/{id}/reject': { operationId: 'rejectExecution', tags: ['Executions'], summary: 'Reject an execution.' },
  'POST /api/v1/executions/{id}/rollback': { operationId: 'rollbackExecution', tags: ['Executions'], summary: 'Roll back an execution.' },
  'POST /api/v1/executions/{id}/run': { operationId: 'runExecution', tags: ['Executions'], summary: 'Run an execution.' },

  'GET /api/v1/observability/overview': { operationId: 'observabilityOverview', tags: ['Observability'], summary: 'Observability overview.', queryParams: [{ name: 'storeId', schema: { type: 'string' } }] },
  'GET /api/v1/observability/metrics': { operationId: 'executionMetrics', tags: ['Observability'], summary: 'Execution metrics summary.', queryParams: [{ name: 'storeId', schema: { type: 'string' } }] },
  'GET /api/v1/observability/alerts': { operationId: 'listAlerts', tags: ['Observability'], summary: 'List alerts.', queryParams: [{ name: 'storeId', schema: { type: 'string' } }, { name: 'limit', schema: { type: 'number' } }] },
  'GET /api/v1/observability/timeline': { operationId: 'observabilityTimeline', tags: ['Observability'], summary: 'Immutable history timeline.', queryParams: [{ name: 'storeId', schema: { type: 'string' } }, { name: 'limit', schema: { type: 'number' } }] },
  'POST /api/v1/observability/alerts/{id}/acknowledge': { operationId: 'acknowledgeAlert', tags: ['Observability'], summary: 'Acknowledge or un-acknowledge an alert.', requestBody: { type: 'object', properties: { acknowledged: { type: 'boolean' } } } },

  'GET /api/v1/reports': { operationId: 'listReports', tags: ['Reports'], summary: 'List generated reports.' },
  'POST /api/v1/reports': { operationId: 'generateReport', tags: ['Reports'], summary: 'Generate a report.', requestBody: { type: 'object', required: ['kind'], properties: { kind: { type: 'string', enum: ['executive-dashboard', 'seo', 'kpi', 'trends', 'alerts'] }, storeId: { type: 'string' }, days: { type: 'number' }, compare: { type: 'boolean' } } } },
  'GET /api/v1/reports/{id}': { operationId: 'getReport', tags: ['Reports'], summary: 'Fetch a generated report.' },

  'GET /api/v1/copilot/sessions': { operationId: 'listCopilotSessions', tags: ['Copilot'], summary: 'List copilot sessions.', queryParams: [{ name: 'storeId', schema: { type: 'string' } }, { name: 'limit', schema: { type: 'number' } }] },
  'POST /api/v1/copilot/chat': { operationId: 'copilotChat', tags: ['Copilot'], summary: 'Stream a copilot conversation (SSE).', requestBody: { type: 'object', required: ['message'], properties: { message: { type: 'string' }, storeId: { type: 'string' }, sessionId: { type: 'string' }, model: { type: 'string' }, temperature: { type: 'number' } } } },

  'GET /api/v1/admin/tenants': { operationId: 'listTenants', tags: ['Admin'], summary: 'List tenants visible to the caller.' },
  'POST /api/v1/admin/tenants': { operationId: 'createTenant', tags: ['Admin'], summary: 'Provision a tenant.', requestBody: { type: 'object', required: ['name'], properties: { name: { type: 'string' }, planId: { type: 'string' }, slug: { type: 'string' } } } },
  'GET /api/v1/admin/orgs': { operationId: 'listOrgs', tags: ['Admin'], summary: 'List organizations.' },
  'GET /api/v1/admin/teams': { operationId: 'listTeams', tags: ['Admin'], summary: 'List teams.', queryParams: [{ name: 'organizationId', schema: { type: 'string' } }] },
  'GET /api/v1/admin/members': { operationId: 'listMembers', tags: ['Admin'], summary: 'List tenant members.' },
  'POST /api/v1/admin/members/invite': { operationId: 'inviteMember', tags: ['Admin'], summary: 'Invite a member.', requestBody: { type: 'object', required: ['email', 'role'], properties: { email: { type: 'string' }, name: { type: 'string' }, role: { type: 'string', enum: ['owner', 'admin', 'member', 'viewer'] }, organizationId: { type: 'string' } } } },
  'PATCH /api/v1/admin/members/{id}/role': { operationId: 'updateMemberRole', tags: ['Admin'], summary: 'Change a member role.', requestBody: { type: 'object', required: ['role'], properties: { role: { type: 'string', enum: ['owner', 'admin', 'member', 'viewer'] } } } },
  'GET /api/v1/admin/audit': { operationId: 'listAudit', tags: ['Admin'], summary: 'Query the audit log.', queryParams: [{ name: 'limit', schema: { type: 'number' } }, { name: 'action', schema: { type: 'string' } }] },
  'GET /api/v1/admin/api-keys': { operationId: 'listApiKeys', tags: ['Admin'], summary: 'List API keys.' },
  'POST /api/v1/admin/api-keys': { operationId: 'createApiKey', tags: ['Admin'], summary: 'Issue an API key.', requestBody: { type: 'object', required: ['label'], properties: { label: { type: 'string' }, scopes: { type: 'string' }, expiresInDays: { type: 'number' } } } },
  'DELETE /api/v1/admin/api-keys/{id}': { operationId: 'revokeApiKey', tags: ['Admin'], summary: 'Revoke an API key.' },
  'GET /api/v1/admin/billing': { operationId: 'getBilling', tags: ['Admin'], summary: 'Billing entitlements for the tenant.' },

  'GET /api/v1/admin/webhooks': { operationId: 'listWebhooks', tags: ['Webhooks'], summary: 'List webhook endpoints.' },
  'POST /api/v1/admin/webhooks': { operationId: 'createWebhook', tags: ['Webhooks'], summary: 'Register a webhook endpoint.', requestBody: { type: 'object', required: ['url'], properties: { url: { type: 'string' }, events: { type: 'array', items: { type: 'string' } }, description: { type: 'string' } } } },
  'PATCH /api/v1/admin/webhooks/{id}': { operationId: 'updateWebhook', tags: ['Webhooks'], summary: 'Update a webhook endpoint.', requestBody: OBJECT_SCHEMA },
  'DELETE /api/v1/admin/webhooks/{id}': { operationId: 'deleteWebhook', tags: ['Webhooks'], summary: 'Delete a webhook endpoint.' },
  'GET /api/v1/admin/webhooks/deliveries': { operationId: 'listWebhookDeliveries', tags: ['Webhooks'], summary: 'Webhook delivery history.' },
  'POST /api/v1/admin/webhooks/{id}/test': { operationId: 'testWebhook', tags: ['Webhooks'], summary: 'Send a test event to an endpoint.', requestBody: { type: 'object', properties: { type: { type: 'string' }, payload: { type: 'object', additionalProperties: true } } } },

  'GET /api/v1/settings': { operationId: 'getSettings', tags: ['Settings'], summary: 'Workspace settings.' },
  'PUT /api/v1/settings': { operationId: 'updateSettings', tags: ['Settings'], summary: 'Update workspace settings.', requestBody: OBJECT_SCHEMA },
  'PATCH /api/v1/settings/profile': { operationId: 'updateProfile', tags: ['Settings'], summary: 'Update the caller profile.', requestBody: OBJECT_SCHEMA },

  'GET /api/v1/notifications': { operationId: 'listNotifications', tags: ['Notifications'], summary: 'List notifications with unread count.' },
  'POST /api/v1/notifications': { operationId: 'createNotification', tags: ['Notifications'], summary: 'Create a notification.', requestBody: { type: 'object', required: ['type', 'title', 'message'], properties: { type: { type: 'string' }, title: { type: 'string' }, message: { type: 'string' }, severity: { type: 'string', enum: ['info', 'warning', 'critical'] } } } },
  'POST /api/v1/notifications/{id}/read': { operationId: 'markNotificationRead', tags: ['Notifications'], summary: 'Mark one notification read.' },
  'POST /api/v1/notifications/read-all': { operationId: 'markAllNotificationsRead', tags: ['Notifications'], summary: 'Mark all notifications read.' },

  'GET /api/v1/realtime/events': { operationId: 'realtimeEvents', tags: ['Realtime'], summary: 'Server-Sent Events stream.', queryParams: [{ name: 'channel', schema: { type: 'string' } }] },
  'POST /api/v1/realtime/publish': { operationId: 'realtimePublish', tags: ['Realtime'], summary: 'Publish an event to a channel.', requestBody: { type: 'object', required: ['channel'], properties: { channel: { type: 'string' }, payload: { type: 'object', additionalProperties: true } } } },

  'GET /api/v1/admin/plugins': { operationId: 'listPlugins', tags: ['Plugins'], summary: 'List installed plugins.' },
  'POST /api/v1/admin/plugins': { operationId: 'installPlugin', tags: ['Plugins'], summary: 'Install a plugin bundle.', requestBody: { type: 'object', required: ['manifest', 'code'], properties: { manifest: { type: 'object', additionalProperties: true }, code: { type: 'string' } } } },
  'GET /api/v1/admin/plugins/{id}': { operationId: 'getPlugin', tags: ['Plugins'], summary: 'Fetch one installed plugin.' },
  'PUT /api/v1/admin/plugins/{id}': { operationId: 'updatePlugin', tags: ['Plugins'], summary: 'Update a plugin bundle.', requestBody: { type: 'object', required: ['manifest', 'code'], properties: { manifest: { type: 'object', additionalProperties: true }, code: { type: 'string' } } } },
  'DELETE /api/v1/admin/plugins/{id}': { operationId: 'uninstallPlugin', tags: ['Plugins'], summary: 'Uninstall a plugin.' },
  'POST /api/v1/admin/plugins/{id}/enable': { operationId: 'enablePlugin', tags: ['Plugins'], summary: 'Enable an installed plugin.' },
  'POST /api/v1/admin/plugins/{id}/disable': { operationId: 'disablePlugin', tags: ['Plugins'], summary: 'Disable an enabled plugin.' },
  'POST /api/v1/admin/plugins/dispatch/tools/{toolId}': { operationId: 'executePluginTool', tags: ['Plugins'], summary: 'Execute a plugin tool.', requestBody: { type: 'object', properties: { args: { type: 'object', additionalProperties: true } } } },
  'POST /api/v1/admin/plugins/dispatch/analyzers/{analyzerId}': { operationId: 'runPluginAnalyzer', tags: ['Plugins'], summary: 'Run a plugin analyzer.', requestBody: { type: 'object', properties: { context: { type: 'object', additionalProperties: true } } } },
  'POST /api/v1/admin/plugins/dispatch/actions/{actionId}': { operationId: 'runPluginAction', tags: ['Plugins'], summary: 'Execute a plugin execution action.', requestBody: { type: 'object', required: ['action'], properties: { action: { type: 'string' }, payload: { type: 'object', additionalProperties: true } } } },
};
