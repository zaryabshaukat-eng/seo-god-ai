/**
 * Plugin SDK public types: the manifest contract, the seven contribution
 * surfaces (analyzers, AI tools, integrations, report generators, event
 * subscribers, execution actions, UI extensions) and the lifecycle hooks.
 * Every contribution is declared in the manifest and implemented by the
 * sandboxed plugin code keyed by its id.
 */

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export type PluginState = 'installed' | 'enabled' | 'disabled' | 'uninstalled';

export type PluginHookName = 'install' | 'activate' | 'deactivate' | 'uninstall' | 'update';

export const PLUGIN_HOOK_NAMES: readonly PluginHookName[] = [
  'install',
  'activate',
  'deactivate',
  'uninstall',
  'update',
];

// ---------------------------------------------------------------------------
// Contribution declarations (manifest metadata, no functions)
// ---------------------------------------------------------------------------

export interface PluginAnalyzerDeclaration {
  id: string;
  name: string;
  description?: string;
  permission?: string;
}

export interface PluginToolDeclaration {
  id: string;
  name: string;
  description?: string;
  /** JSON-Schema-ish argument contract surfaced to the model. */
  parameters?: Record<string, unknown>;
  permission?: string;
}

export interface PluginIntegrationDeclaration {
  id: string;
  name: string;
  description?: string;
  /** Operations the integration exposes, e.g. `[ 'lookup' ]`. */
  endpoints?: string[];
  permission?: string;
}

export interface PluginReportGeneratorDeclaration {
  id: string;
  name: string;
  description?: string;
  /** Report kind id this generator produces. */
  kind: string;
  permission?: string;
}

export interface PluginEventSubscriberDeclaration {
  id: string;
  /** Dot-separated event types, e.g. `crawl.completed`. */
  events: string[];
  permission?: string;
}

export interface PluginExecutionActionDeclaration {
  id: string;
  name: string;
  description?: string;
  permission?: string;
}

export interface PluginUiExtensionDeclaration {
  id: string;
  /** Named UI mount point, e.g. `dashboard.top`. */
  extensionPoint: string;
  title?: string;
  type?: string;
  permission?: string;
}

/** Union of every contribution declaration a manifest can contain. */
export type PluginContributionDeclaration =
  | PluginAnalyzerDeclaration
  | PluginToolDeclaration
  | PluginIntegrationDeclaration
  | PluginReportGeneratorDeclaration
  | PluginEventSubscriberDeclaration
  | PluginExecutionActionDeclaration
  | PluginUiExtensionDeclaration;

export interface PluginContributionsManifest {
  analyzers?: PluginAnalyzerDeclaration[];
  tools?: PluginToolDeclaration[];
  integrations?: PluginIntegrationDeclaration[];
  reportGenerators?: PluginReportGeneratorDeclaration[];
  eventSubscribers?: PluginEventSubscriberDeclaration[];
  executionActions?: PluginExecutionActionDeclaration[];
  uiExtensions?: PluginUiExtensionDeclaration[];
}

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

export interface PluginManifest {
  schemaVersion: 1;
  /** Stable plugin id, e.g. `@acme/seo-extra`. */
  id: string;
  /** Human-readable plugin name. */
  name: string;
  /** Semantic version, e.g. `1.2.3`. */
  version: string;
  description?: string;
  author?: string;
  /** Permissions the plugin requests; must be approved by the host. */
  permissions: readonly string[];
  /** Runtime version constraints, e.g. `{ pluginSdk: '^0.3.0' }`. */
  engines?: { pluginSdk?: string; api?: string };
  /** Constraints on other plugins, e.g. `{ '@acme/base': '^1.0.0' }`. */
  dependencies?: Record<string, string>;
  /** Maps lifecycle hooks to function ids implemented in the plugin code. */
  hooks?: Partial<Record<PluginHookName, string>>;
  /** Declared contributions; implementations come from the plugin code. */
  contributions: PluginContributionsManifest;
}

// ---------------------------------------------------------------------------
// Contribution implementation inputs/outputs
// ---------------------------------------------------------------------------

export interface PluginAnalyzerContext {
  storeId?: string;
  pages?: Array<Record<string, unknown> & { url: string }>;
  settings?: Record<string, unknown>;
}

export interface PluginIssue {
  rule: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  url?: string;
  evidence?: unknown;
}

export interface PluginAnalyzerOutput {
  score?: number;
  issues?: PluginIssue[];
  recommendations?: Array<{ title: string; description?: string; impact?: string }>;
}

export interface PluginReportInput {
  storeId?: string;
  periodDays?: number;
  data?: Record<string, unknown>;
}

export interface PluginReportOutput {
  summary?: string;
  sections: Array<Record<string, unknown>>;
  format?: 'json' | 'pdf' | 'csv';
}

export interface PluginEvent {
  type: string;
  aggregateType?: string;
  aggregateId?: string;
  payload?: unknown;
}

export interface PluginActionInput {
  action: string;
  resourceType?: string;
  resourceId?: string;
  payload?: unknown;
}

export interface PluginActionResult {
  ok: boolean;
  output?: unknown;
  error?: string;
}

// ---------------------------------------------------------------------------
// Plugin code shape (the sandboxed script's completion value)
// ---------------------------------------------------------------------------

export type AnalyzerImpl = (context: PluginAnalyzerContext) => PluginAnalyzerOutput | Promise<PluginAnalyzerOutput>;
export type ToolImpl = (args: Record<string, unknown>) => unknown | Promise<unknown>;
export type ReportGeneratorImpl = (input: PluginReportInput) => PluginReportOutput | string | Promise<PluginReportOutput | string>;
export type EventSubscriberImpl = (event: PluginEvent) => void | Promise<void>;
export type ExecutionActionImpl = (input: PluginActionInput) => PluginActionResult | Promise<PluginActionResult>;
export type UiExtensionImpl = (context: Record<string, unknown>) => unknown;
export type HookImpl = () => void | Promise<void>;

export interface PluginIntegrationImpl {
  connect?: (config: Record<string, unknown>) => unknown | Promise<unknown>;
  call?: (operation: string, args: Record<string, unknown>) => unknown | Promise<unknown>;
}

/** Map of function ids to implementations, one map per contribution kind. */
export interface PluginCodeContributions {
  analyzers?: Record<string, AnalyzerImpl>;
  tools?: Record<string, ToolImpl>;
  integrations?: Record<string, PluginIntegrationImpl>;
  reportGenerators?: Record<string, ReportGeneratorImpl>;
  eventSubscribers?: Record<string, EventSubscriberImpl>;
  executionActions?: Record<string, ExecutionActionImpl>;
  uiExtensions?: Record<string, UiExtensionImpl>;
}

export interface PluginCode {
  hooks?: Record<string, HookImpl>;
  contributions: PluginCodeContributions;
}

export interface PluginBundle {
  manifest: PluginManifest;
  /** Sandboxed JS whose completion value is a `PluginCode` object. */
  code: string;
}
