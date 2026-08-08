/**
 * `@seogod/plugin-sdk` — plugin and extension SDK for SEO GOD AI.
 *
 * Secure plugin architecture: plugins declare a strict manifest (id, version,
 * permissions, contribution declarations) and implement the declared
 * contributions with sandboxed code that runs in an isolated `node:vm`
 * context with no access to `process`, `require`, `Buffer`, `fetch` or
 * timers. The registry enforces host permission policy, semver versioning,
 * plugin dependencies and lifecycle transitions, and dispatches contribution
 * calls with deep-cloned data so plugins can never mutate host state.
 */

export { PluginError, PluginErrorCode, isPluginError, asPluginError } from './errors.js';
export type { PluginErrorCodeValue, PluginErrorOptions } from './errors.js';

export {
  PluginPermissions,
  ALL_PLUGIN_PERMISSIONS,
  CONTRIBUTION_KINDS,
  approvePermissions,
  defaultPermissionFor,
  isPluginPermission,
  permissionFor,
  requireGranted,
} from './permissions.js';
export type { ContributionKind, PluginPermission } from './permissions.js';

export { createSandbox } from './sandbox.js';
export type { Sandbox, SandboxLogLevel, SandboxOptions } from './sandbox.js';

export { validateManifest, validateContributionDeclaration } from './manifest.js';
export type { NormalizedContributionDeclaration } from './manifest.js';

export {
  isHookName,
  loadPlugin,
  requiredPermission,
  formatEvent,
} from './runtime.js';
export type {
  LoadedPlugin,
  ResolvedAnalyzer,
  ResolvedContribution,
  ResolvedContributions,
  ResolvedEventSubscriber,
  ResolvedExecutionAction,
  ResolvedIntegration,
  ResolvedReportGenerator,
  ResolvedTool,
  ResolvedUiExtension,
} from './runtime.js';

export {
  PluginRegistry,
  PLUGIN_SDK_VERSION,
} from './registry.js';
export type {
  PluginInfo,
  PluginLogger,
  PluginRegistryOptions,
  PluginStateChange,
} from './registry.js';

export { PluginEventBridge } from './bridge.js';
export type { PluginEventBusLike } from './bridge.js';

export {
  compareVersions,
  isValidVersion,
  parseComparator,
  parseVersion,
  satisfies,
} from './versions.js';
export type { Comparator, ComparatorOperator, SemVer } from './versions.js';

export {
  PLUGIN_HOOK_NAMES,
} from './types.js';
export type {
  AnalyzerImpl,
  EventSubscriberImpl,
  ExecutionActionImpl,
  HookImpl,
  PluginActionInput,
  PluginActionResult,
  PluginAnalyzerContext,
  PluginAnalyzerDeclaration,
  PluginAnalyzerOutput,
  PluginBundle,
  PluginCode,
  PluginCodeContributions,
  PluginContributionDeclaration,
  PluginContributionsManifest,
  PluginEvent,
  PluginEventSubscriberDeclaration,
  PluginExecutionActionDeclaration,
  PluginHookName,
  PluginIntegrationDeclaration,
  PluginIntegrationImpl,
  PluginIssue,
  PluginManifest,
  PluginReportGeneratorDeclaration,
  PluginReportInput,
  PluginReportOutput,
  PluginState,
  PluginToolDeclaration,
  PluginUiExtensionDeclaration,
  ReportGeneratorImpl,
  ToolImpl,
  UiExtensionImpl,
} from './types.js';
