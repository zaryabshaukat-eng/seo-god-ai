/**
 * Shared types for the Web UI client: domain models, view-model inputs,
 * rendering primitives and API contracts. Kept free of logic so it can be
 * excluded from coverage like every other package's `types.ts`.
 */

// ─── Authentication & identity ────────────────────────────────────────────────

export type Role = 'owner' | 'admin' | 'member' | 'viewer';

/** Dot-notation permission, e.g. `tenant.read`. Mirrors `@seogod/enterprise`. */
export type Permission = string;

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  tenantId: string;
  orgIds: string[];
  locale: string;
  timezone: string;
  avatarUrl?: string;
}

export type AuthStatus = 'anonymous' | 'authenticating' | 'authenticated';

export interface Session {
  user: User;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  /** Effective permissions granted to this session (computed server-side). */
  permissions: Permission[];
}

export type AuthResult =
  | { ok: true; session: Session; redirectTo: string }
  | { ok: false; error: string };

// ─── Theme ────────────────────────────────────────────────────────────────────

export type ThemeName = 'light' | 'dark';
export type ThemePref = ThemeName | 'system';

export interface UserPreferences {
  theme: ThemePref;
  locale: string;
  timezone: string;
  notifications: NotificationPreferences;
}

export interface NotificationPreferences {
  email: boolean;
  realtime: boolean;
  alerts: boolean;
  digests: boolean;
}

// ─── Navigation & routing ─────────────────────────────────────────────────────

export type RouteGroup = 'overview' | 'operations' | 'intelligence' | 'platform';

export interface Route {
  path: string;
  label: string;
  group: RouteGroup;
  icon?: string;
  /** Permission required to see/visit the route. */
  permission?: Permission;
  /** Marks the shell route used after login. */
  isLanding?: boolean;
}

export interface NavItem {
  route: Route;
  group: RouteGroup;
}

// ─── Rendering (tiny virtual DOM) ─────────────────────────────────────────────

export interface VNode {
  tag: string;
  attrs: Record<string, string | number | boolean | undefined>;
  children: VChild[];
  key?: string | number;
}

export type VChild = VNode | string | number | boolean | null | undefined;

// ─── Notifications & toasts ───────────────────────────────────────────────────

export type NotificationKind = 'info' | 'success' | 'warning' | 'error' | 'alert';

/** Semantic tone used for badges, KPIs and status colors. */
export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

export interface NotificationItem {
  id: string;
  title: string;
  message?: string;
  kind: NotificationKind;
  read: boolean;
  createdAt: number;
}

export interface Toast {
  id: string;
  message: string;
  kind: NotificationKind;
  autoDismissMs?: number;
}

// ─── API ──────────────────────────────────────────────────────────────────────

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface EndpointSpec {
  method: HttpMethod;
  path: string;
  /** Permission required to call the endpoint. */
  permission?: Permission;
  /** True when the endpoint requires an authenticated session. */
  auth: boolean;
  /** True when the endpoint may 204 with no body. */
  empty?: boolean;
}

export interface ApiErrorBody {
  code?: string;
  message?: string;
  context?: Record<string, unknown>;
  retryable?: boolean;
}

/** Pluggable transport backing the real-time client (WebSocket, SSE, stub...). */
export interface RealtimeTransport {
  connect(): Promise<void> | void;
  disconnect(): void;
  /** Registers the handler for inbound channel events. */
  onMessage(handler: (channel: string, payload: unknown) => void): void;
  send(channel: string, payload: unknown): void;
}

// ─── Feature domain models ────────────────────────────────────────────────────

export type CrawlStatus = 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';

export interface Crawl {
  id: string;
  storeId: string;
  status: CrawlStatus;
  pages: number;
  issues: number;
  startedAt: number;
  finishedAt?: number;
  error?: string;
}

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface SeoRecommendation {
  id: string;
  storeId: string;
  rule: string;
  severity: Severity;
  url: string;
  title: string;
  description: string;
  score: number;
  impact: 'revenue' | 'traffic' | 'ranking' | 'crawl' | 'ux';
  status: 'open' | 'planned' | 'resolved';
  createdAt: number;
}

export interface ScoreBreakdown {
  crawl: number;
  content: number;
  performance: number;
  links: number;
  technical: number;
}

export type ExecutionStatus =
  | 'draft'
  | 'awaiting-approval'
  | 'approved'
  | 'running'
  | 'rolled-back'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type ExecutionAction = 'approve' | 'reject' | 'rollback' | 'run' | 'cancel';

export interface Execution {
  id: string;
  storeId: string;
  title: string;
  status: ExecutionStatus;
  risk: 'low' | 'medium' | 'high';
  changes: number;
  approvalRole: Role;
  createdBy: string;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  error?: string;
}

export interface TimelineEvent {
  id: string;
  at: number;
  type: 'execution' | 'seo' | 'crawl' | 'alert';
  title: string;
  status: 'success' | 'warning' | 'error' | 'running' | 'info';
}

export interface MetricPoint {
  t: number;
  value: number;
}

export interface Alert {
  id: string;
  storeId: string;
  severity: Severity;
  title: string;
  message: string;
  acknowledged: boolean;
  createdAt: number;
}

export type ReportKind = 'seo-health' | 'crawl' | 'execution' | 'rankings' | 'traffic';

export interface Report {
  id: string;
  kind: ReportKind;
  storeId: string;
  title: string;
  status: 'generating' | 'ready' | 'failed';
  createdAt: number;
  sections: ReportSection[];
}

export interface ReportSection {
  id: string;
  title: string;
  kpis: Kpi[];
  summary: string;
}

export interface Kpi {
  label: string;
  value: string;
  changePct?: number;
}

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

export type ChatMessageKind = 'text' | 'tool-call' | 'tool-result' | 'error';

export interface ChatMessage {
  id: string;
  role: ChatRole;
  kind: ChatMessageKind;
  content: string;
  at: number;
  toolName?: string;
}

export type CopilotStreamEvent =
  | { type: 'start' }
  | { type: 'delta'; text: string }
  | { type: 'tool-call'; id: string; tool: string; args: string }
  | { type: 'tool-result'; id: string; result: string }
  | { type: 'done'; messageId: string }
  | { type: 'error'; message: string };

export interface CopilotSession {
  id: string;
  title: string;
  createdAt: number;
  messageCount: number;
}

export interface Tenant {
  id: string;
  name: string;
  plan: PlanName;
  status: 'active' | 'suspended' | 'trial';
  users: number;
  stores: number;
  createdAt: number;
}

export type PlanName = 'free' | 'pro' | 'business' | 'enterprise';

export interface Org {
  id: string;
  tenantId: string;
  name: string;
}

export interface Team {
  id: string;
  orgId: string;
  name: string;
  memberCount: number;
}

export interface Member {
  id: string;
  email: string;
  name: string;
  role: Role;
  lastActiveAt?: number;
  status: 'active' | 'invited' | 'disabled';
}

export interface ApiKey {
  id: string;
  label: string;
  prefix: string;
  scopes: Permission[];
  createdAt: number;
  lastUsedAt?: number;
  enabled: boolean;
}

export interface Webhook {
  id: string;
  url: string;
  events: string[];
  enabled: boolean;
  createdAt: number;
}

export interface AuditEntry {
  id: string;
  at: number;
  actor: string;
  action: string;
  target: string;
  outcome: 'success' | 'failure';
}

export interface BillingEntitlements {
  plan: PlanName;
  seats: number;
  usedSeats: number;
  storesLimit: number;
  storesUsed: number;
  nextBillingAt: number;
}

export interface DashboardKpis {
  seoScore: number;
  seoScoreChangePct: number;
  traffic: number;
  trafficChangePct: number;
  conversions: number;
  conversionsChangePct: number;
  openRecommendations: number;
  executionsPending: number;
  issuesCritical: number;
  crawlPages: number;
}

export interface LoginForm {
  email: string;
  password: string;
  remember: boolean;
}

export interface RegisterForm {
  name: string;
  email: string;
  password: string;
  storeName: string;
}

export interface ResetPasswordForm {
  email: string;
}

export interface ReportDraft {
  kind: ReportKind;
  storeId: string;
  days: number;
  compare: boolean;
}
