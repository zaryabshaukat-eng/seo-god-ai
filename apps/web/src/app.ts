import { createApiClient, type ApiClient } from './api/client.js';
import { createRealtime, type RealtimeClient } from './api/realtime.js';
import type { RealtimeTransport } from './types.js';
import { createAuthStore, createAuthApi, createMemoryAuthStorage, type AuthStore, type AuthStorage, type AuthApi } from './state/auth.js';
import { createNotificationsStore, createNotificationsApi, type NotificationsStore } from './state/notifications.js';
import { createThemeStore, type ThemeStore, type ThemeStorage } from './state/theme.js';
import { createUiStore, type UiStore } from './state/ui.js';
import { createChatStore, type ChatStore, type ChatState, type CopilotApi } from './features/copilot.js';
import { createRouter, type Router } from './nav/router.js';
import { groupedNav, landingRoute, visibleRoutes, AUTH_ROUTES } from './nav/routes.js';
import { Permissions } from './api/endpoints.js';
import { renderDashboardPage } from './features/dashboard.js';
import { renderCrawlsPage } from './features/crawl.js';
import { renderSeoPage } from './features/seo.js';
import { renderExecutionsPage } from './features/execution.js';
import { renderObservabilityPage } from './features/observability.js';
import { renderReportsPage } from './features/reports.js';
import { renderCopilotPage } from './features/copilot.js';
import { renderTenantsPage, renderMembersPage, renderAuditPage, renderApiKeysPage, renderWebhooksPage, renderBillingPage } from './features/enterprise.js';
import { renderSettingsPage, profileFromUser } from './features/settings.js';
import { renderNotificationsPage } from './features/notifications.js';
import { loginPageEl, registerPageEl, resetPageEl, validateLoginForm, validateRegisterForm, validateResetForm } from './features/auth.js';
import { appShellEl, navLinkEl, pageHeaderEl } from './ui/layout.js';
import { h } from './vdom.js';
import type {
  Alert,
  AuthResult,
  DashboardKpis,
  LoginForm,
  NotificationItem,
  RegisterForm,
  ReportDraft,
  ResetPasswordForm,
  Session,
  VNode,
} from './types.js';

export const CHANNELS = {
  notifications: 'notifications',
  alerts: 'alerts',
  executions: 'executions',
  system: 'system',
} as const;

export interface WebAppConfig {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  authStorage?: AuthStorage;
  themeStorage?: ThemeStorage;
  realtimeTransport?: RealtimeTransport;
  initialPath?: string;
  streamChat?: CopilotApi['chat'];
}

export interface WebApp {
  api: ApiClient;
  auth: AuthStore;
  notifications: NotificationsStore;
  theme: ThemeStore;
  ui: UiStore;
  chat: ChatStore;
  router: Router;
  realtime: RealtimeClient;
  nav: {
    groups(): ReturnType<typeof groupedNav>;
    visible(): ReturnType<typeof visibleRoutes>;
    landing(): ReturnType<typeof landingRoute>;
  };
  renderRoute(path?: string): VNode;
  render(): VNode;
  connectRealtime(): () => void;
  submitLogin(form: LoginForm): Promise<AuthResult>;
  submitRegister(form: RegisterForm): Promise<AuthResult>;
  submitReset(form: ResetPasswordForm): Promise<{ ok: boolean; error?: string }>;
  submitLogout(): Promise<void>;
}

const EMPTY_KPIS: DashboardKpis = {
  seoScore: 0,
  seoScoreChangePct: 0,
  traffic: 0,
  trafficChangePct: 0,
  conversions: 0,
  conversionsChangePct: 0,
  openRecommendations: 0,
  executionsPending: 0,
  issuesCritical: 0,
  crawlPages: 0,
};

const EMPTY_BREAKDOWN = { crawl: 0, content: 0, performance: 0, links: 0, technical: 0 };

const DEFAULT_REPORT_DRAFT: ReportDraft = { kind: 'seo-health', storeId: '', days: 30, compare: false };

/** Builds a full Web UI application instance. */
export function createWebApp(config: WebAppConfig): WebApp {
  const authStorage = config.authStorage ?? createMemoryAuthStorage();
  const themeStorage = config.themeStorage ?? { getPref: () => undefined as undefined, savePref: () => undefined };

  const api = createApiClient({
    baseUrl: config.baseUrl,
    fetchImpl: config.fetchImpl,
    getToken: () => authStore.getToken(),
  });
  const authApi: AuthApi = createAuthApi(api);
  const authStore = createAuthStore(authApi, authStorage);

  const notifications = createNotificationsStore(createNotificationsApi(api));
  const theme = createThemeStore(themeStorage);
  const ui = createUiStore();
  const chat = createChatStore({ streamChat: config.streamChat ?? (() => emptyStream()) });
  const realtime = createRealtime({ transport: config.realtimeTransport ?? createNoopTransport() });

  const router = createRouter({
    routes: [...AUTH_ROUTES, ...visibleRoutes(ALL_PERMISSIONS)],
    getPermissions: () => authStore.getSession()?.permissions ?? [],
    isAuthenticated: () => authStore.isAuthenticated(),
    onUnauthorized: () => {
      // The shell renders the login page when anonymous.
    },
    initialPath: config.initialPath,
  });

  function connectRealtime(): () => void {
    const unsubscribeNotifications = realtime.subscribe(CHANNELS.notifications, (payload) => {
      notifications.add(payload as NotificationItem);
    });
    const unsubscribeAlerts = realtime.subscribe(CHANNELS.alerts, (payload) => {
      const alert = payload as Alert;
      ui.pushToast(`${alert.severity}: ${alert.title}`, 'alert');
    });
    void realtime.connect();
    return () => {
      unsubscribeNotifications();
      unsubscribeAlerts();
      realtime.disconnect();
    };
  }

  async function submitLogin(form: LoginForm): Promise<AuthResult> {
    const errors = validateLoginForm(form);
    if (Object.keys(errors).length > 0) {
      return { ok: false, error: errors.email ?? errors.password ?? 'Please fix the highlighted fields.' };
    }
    const result = await authStore.login(form);
    if (!result.ok) {
      return { ok: false, error: result.error ?? 'Authentication failed.' };
    }
    const session = authStore.getSession();
    const target = result.redirectTo ?? landingRoute(authStore.getSession()?.permissions ?? []).path;
    router.navigate(target);
    return { ok: true, session: session as Session, redirectTo: target };
  }

  async function submitRegister(form: RegisterForm): Promise<AuthResult> {
    const errors = validateRegisterForm(form);
    if (Object.keys(errors).length > 0) {
      return { ok: false, error: 'Please fix the highlighted fields.' };
    }
    const result = await authStore.register(form);
    if (!result.ok) {
      return { ok: false, error: result.error ?? 'Registration failed.' };
    }
    const session = authStore.getSession();
    const target = result.redirectTo ?? landingRoute(authStore.getSession()?.permissions ?? []).path;
    router.navigate(target);
    return { ok: true, session: session as Session, redirectTo: target };
  }

  async function submitReset(form: ResetPasswordForm): Promise<{ ok: boolean; error?: string }> {
    const errors = validateResetForm(form);
    if (Object.keys(errors).length > 0) {
      return { ok: false, error: errors.email };
    }
    try {
      await api.post('/api/v1/auth/reset-password', { email: form.email.trim() });
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Reset failed.' };
    }
  }

  async function submitLogout(): Promise<void> {
    await authStore.logout();
    router.navigate('/login');
  }

  function renderRoute(path = router.getPath()): VNode {
    if (!authStore.isAuthenticated()) {
      return renderPublicRoute(path);
    }
    const session = authStore.getSession();
    const permissions = session?.permissions ?? [];
    const role = session?.user.role ?? 'viewer';
    switch (path) {
      case '/dashboard':
        return renderDashboardPage({ kpis: EMPTY_KPIS, trend: [], alerts: [], recentAlertsCount: 3, permissions });
      case '/crawls':
        return renderCrawlsPage({ crawls: [], canWrite: permissions.includes(Permissions.crawlWrite), startInput: { storeId: '' }, startErrors: {}, error: undefined });
      case '/seo':
        return renderSeoPage({ recommendations: [], breakdown: EMPTY_BREAKDOWN, filters: {}, canWrite: permissions.includes(Permissions.seoWrite) });
      case '/executions':
        return renderExecutionsPage({ executions: [], userRole: role, permissions });
      case '/observability':
        return renderObservabilityPage({ series: {}, alerts: [], timeline: [], canAcknowledge: permissions.includes(Permissions.observabilityRead) });
      case '/reports':
        return renderReportsPage({ reports: [], canWrite: permissions.includes(Permissions.reportsWrite), draft: DEFAULT_REPORT_DRAFT, draftErrors: {}, error: undefined });
      case '/copilot':
        return renderCopilotPage({ messages: chat.getMessages(), sessions: [], isStreaming: chat.isStreaming(), canWrite: permissions.includes(Permissions.copilotWrite), input: chat.getInput(), error: undefined });
      case '/admin':
        return renderTenantsPage({ tenants: [], canWrite: permissions.includes(Permissions.adminWrite) });
      case '/admin/members':
        return renderMembersPage({ members: [], canWrite: permissions.includes(Permissions.adminWrite) });
      case '/admin/audit':
        return renderAuditPage({ entries: [] });
      case '/admin/api-keys':
        return renderApiKeysPage({ keys: [], canWrite: permissions.includes(Permissions.adminWrite) });
      case '/admin/webhooks':
        return renderWebhooksPage({ webhooks: [], canWrite: permissions.includes(Permissions.adminWrite) });
      case '/admin/billing':
        return renderBillingPage({ entitlements: { plan: 'free', seats: 0, usedSeats: 0, storesLimit: 0, storesUsed: 0, nextBillingAt: Date.now() } });
      case '/settings':
        return renderSettingsPage({
          profile: session ? profileFromUser(session.user) : { name: '', email: '' },
          store: { name: '', domain: '' },
          prefs: { theme: 'system', locale: session?.user.locale ?? 'en', timezone: session?.user.timezone ?? 'UTC', notifications: { email: true, realtime: true, alerts: true, digests: false } },
          canWrite: permissions.includes(Permissions.settingsWrite),
          profileErrors: {},
          storeErrors: {},
          error: undefined,
        });
      case '/notifications':
        return renderNotificationsPage({ items: notifications.getItems(), canMarkAll: true });
      default:
        return renderNotFoundPage(path);
    }
  }

  function renderPublicRoute(path: string): VNode {
    if (path === '/register') {
      return registerPageEl({ form: { name: '', email: '', password: '', storeName: '' }, errors: {}, error: undefined });
    }
    if (path === '/reset') {
      return resetPageEl({ form: { email: '' }, errors: {}, error: undefined });
    }
    return loginPageEl({ form: { email: '', password: '', remember: false }, errors: {}, error: undefined });
  }

  function render(): VNode {
    const permissions = authStore.getSession()?.permissions ?? [];
    if (!authStore.isAuthenticated()) {
      return renderPublicRoute(router.getPath());
    }
    const groups = groupedNav(permissions);
    const sidebar = [
      h('div', { class: 'app-brand' }, 'SEO GOD AI'),
      ...groups.map((group) =>
        h('nav', { class: 'nav', 'aria-label': group.group, key: group.group }, ...group.items.map((item) =>
          navLinkEl({ href: item.route.path, label: item.route.label, icon: item.route.icon, active: router.getPath() === item.route.path }),
        )),
      ),
    ];
    const topbar = [
      h('div', { class: 'topbar__title' }, 'SEO GOD AI'),
      h('div', { class: 'topbar__actions' },
        h('button', { class: 'btn btn--ghost', 'data-action': 'theme:toggle', 'aria-label': 'Toggle theme' }, theme.getTheme() === 'dark' ? 'Light' : 'Dark'),
        h('a', { class: 'btn btn--ghost', href: '/notifications', 'data-action': 'navigate:/notifications', 'aria-label': 'Notifications' }, 'Notifications'),
        h('button', { class: 'btn btn--ghost', 'data-action': 'auth:logout', 'aria-label': 'Sign out' }, 'Sign out'),
      ),
    ];
    return appShellEl({ sidebar, topbar, main: [renderRoute()] });
  }

  return {
    api,
    auth: authStore,
    notifications,
    theme,
    ui,
    chat,
    router,
    realtime,
    nav: {
      groups: () => groupedNav(authStore.getSession()?.permissions ?? []),
      visible: () => visibleRoutes(authStore.getSession()?.permissions ?? []),
      landing: () => landingRoute(authStore.getSession()?.permissions ?? []),
    },
    renderRoute,
    render,
    connectRealtime,
    submitLogin,
    submitRegister,
    submitReset,
    submitLogout,
  };
}

function renderNotFoundPage(path: string): VNode {
  return h(
    'main',
    { id: 'main', class: 'page' },
    pageHeaderEl({ title: 'Page not found', subtitle: `No page exists at ${path}.` }),
    h('a', { class: 'btn btn--primary', href: '/dashboard', 'data-action': 'navigate:/dashboard' }, 'Go to dashboard'),
  );
}

function emptyStream(): AsyncIterable<never> {
  return [] as unknown as AsyncIterable<never>;
}

function createNoopTransport(): RealtimeTransport {
  return {
    connect() {
      return Promise.resolve();
    },
    disconnect() {
      return undefined;
    },
    onMessage(_handler: (channel: string, payload: unknown) => void) {
      return undefined;
    },
    send(_channel: string, _payload: unknown) {
      return undefined;
    },
  };
}

const ALL_PERMISSIONS = Object.values(Permissions);

export type { ChatState };
