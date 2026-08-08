/**
 * Plugin loader. Turns a `{ manifest, code }` bundle into a `LoadedPlugin`
 * whose hooks and contribution implementations are sandboxed functions. The
 * loader enforces that every declared contribution is implemented (and no
 * undeclared implementation ships), that hooks reference real functions and
 * that every contribution's required permission was declared in the manifest.
 */

import { PluginError, PluginErrorCode } from './errors.js';
import { validateManifest, type NormalizedContributionDeclaration } from './manifest.js';
import { CONTRIBUTION_KINDS, defaultPermissionFor, type ContributionKind } from './permissions.js';
import type { Sandbox } from './sandbox.js';
import {
  PLUGIN_HOOK_NAMES,
  type AnalyzerImpl,
  type EventSubscriberImpl,
  type ExecutionActionImpl,
  type HookImpl,
  type PluginBundle,
  type PluginCode,
  type PluginCodeContributions,
  type PluginEvent,
  type PluginHookName,
  type PluginIntegrationImpl,
  type ReportGeneratorImpl,
  type ToolImpl,
  type UiExtensionImpl,
} from './types.js';

// ---------------------------------------------------------------------------
// Resolved contribution types (declaration + sandboxed implementation)
// ---------------------------------------------------------------------------

export interface ResolvedAnalyzer extends NormalizedContributionDeclaration {
  kind: 'analyzers';
  impl: AnalyzerImpl;
}
export interface ResolvedTool extends NormalizedContributionDeclaration {
  kind: 'tools';
  impl: ToolImpl;
}
export interface ResolvedIntegration extends NormalizedContributionDeclaration {
  kind: 'integrations';
  impl: PluginIntegrationImpl;
}
export interface ResolvedReportGenerator extends NormalizedContributionDeclaration {
  kind: 'reportGenerators';
  impl: ReportGeneratorImpl;
}
export interface ResolvedEventSubscriber extends NormalizedContributionDeclaration {
  kind: 'eventSubscribers';
  impl: EventSubscriberImpl;
}
export interface ResolvedExecutionAction extends NormalizedContributionDeclaration {
  kind: 'executionActions';
  impl: ExecutionActionImpl;
}
export interface ResolvedUiExtension extends NormalizedContributionDeclaration {
  kind: 'uiExtensions';
  impl: UiExtensionImpl;
}

export type ResolvedContribution =
  | ResolvedAnalyzer
  | ResolvedTool
  | ResolvedIntegration
  | ResolvedReportGenerator
  | ResolvedEventSubscriber
  | ResolvedExecutionAction
  | ResolvedUiExtension;

export interface ResolvedContributions {
  analyzers: ResolvedAnalyzer[];
  tools: ResolvedTool[];
  integrations: ResolvedIntegration[];
  reportGenerators: ResolvedReportGenerator[];
  eventSubscribers: ResolvedEventSubscriber[];
  executionActions: ResolvedExecutionAction[];
  uiExtensions: ResolvedUiExtension[];
}

export interface LoadedPlugin {
  manifest: ReturnType<typeof validateManifest>;
  hooks: Record<PluginHookName, HookImpl>;
  contributions: ResolvedContributions;
}

const EMPTY_RESOLVED: ResolvedContributions = {
  analyzers: [],
  tools: [],
  integrations: [],
  reportGenerators: [],
  eventSubscribers: [],
  executionActions: [],
  uiExtensions: [],
};

const KIND_KEY: Record<ContributionKind, keyof PluginCodeContributions> = {
  analyzers: 'analyzers',
  tools: 'tools',
  integrations: 'integrations',
  reportGenerators: 'reportGenerators',
  eventSubscribers: 'eventSubscribers',
  executionActions: 'executionActions',
  uiExtensions: 'uiExtensions',
};

const IMPL_TYPE: Record<ContributionKind, 'function' | 'object'> = {
  analyzers: 'function',
  tools: 'function',
  integrations: 'object',
  reportGenerators: 'function',
  eventSubscribers: 'function',
  executionActions: 'function',
  uiExtensions: 'function',
};

function codeOf(value: unknown): PluginCode {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new PluginError(PluginErrorCode.invalidCode, 'Plugin code must evaluate to a PluginCode object.', {
      context: { actual: value === null ? 'null' : typeof value },
    });
  }
  return value as PluginCode;
}

function implementationOf(
  kind: ContributionKind,
  id: string,
  impls: PluginCodeContributions,
): (AnalyzerImpl | ToolImpl | PluginIntegrationImpl | ReportGeneratorImpl | EventSubscriberImpl | ExecutionActionImpl | UiExtensionImpl) | undefined {
  const map = impls[KIND_KEY[kind]] ?? {};
  const impl = map[id];
  if (impl === undefined) return undefined;
  if (IMPL_TYPE[kind] === 'function') {
    return typeof impl === 'function' ? impl : undefined;
  }
  if (kind === 'integrations' && typeof impl === 'object' && impl !== null) {
    return impl as PluginIntegrationImpl;
  }
  return undefined;
}

/** Resolves the contributions for one kind from the evaluated plugin code. */
function resolveKind(
  kind: ContributionKind,
  pluginId: string,
  declarations: readonly NormalizedContributionDeclaration[],
  impls: PluginCodeContributions,
): ResolvedContribution[] {
  const resolved: ResolvedContribution[] = [];
  for (const declaration of declarations) {
    const impl = implementationOf(kind, declaration.id, impls);
    if (impl === undefined) {
      throw new PluginError(PluginErrorCode.missingImplementation, `Plugin '${pluginId}' did not implement declared ${kind} '${declaration.id}'.`, {
        context: { id: declaration.id, kind },
      });
    }
    resolved.push({ ...declaration, kind, impl } as ResolvedContribution);
  }
  return resolved;
}

/**
 * Loads a plugin bundle: validates the manifest, evaluates the code in the
 * sandbox and resolves every declared contribution and hook.
 */
export function loadPlugin(bundle: PluginBundle, sandbox: Sandbox): LoadedPlugin {
  const manifest = validateManifest(bundle.manifest);
  const evaluated = codeOf(sandbox.evaluate<unknown>(bundle.code));
  const hooksRaw = evaluated.hooks ?? {};
  const contributions = evaluated.contributions ?? {};

  const hooks = {} as Record<PluginHookName, HookImpl>;
  for (const hookName of PLUGIN_HOOK_NAMES) {
    const fnId = manifest.hooks?.[hookName];
    if (fnId === undefined) continue;
    const impl = hooksRaw[fnId];
    if (typeof impl !== 'function') {
      throw new PluginError(PluginErrorCode.missingImplementation, `Plugin '${manifest.id}' hook '${hookName}' references missing function '${fnId}'.`, {
        context: { hook: hookName, fnId },
      });
    }
    hooks[hookName] = impl as HookImpl;
  }

  const declaredKinds: ResolvedContribution[] = [];
  for (const kind of CONTRIBUTION_KINDS) {
    declaredKinds.push(...resolveKind(kind, manifest.id, (manifest.contributions[kind] ?? []) as readonly NormalizedContributionDeclaration[], contributions));
  }

  const byKind = (kind: ContributionKind): ResolvedContribution[] =>
    declaredKinds.filter((contribution) => contribution.kind === kind);

  const loaded: ResolvedContributions = {
    analyzers: byKind('analyzers') as ResolvedAnalyzer[],
    tools: byKind('tools') as ResolvedTool[],
    integrations: byKind('integrations') as ResolvedIntegration[],
    reportGenerators: byKind('reportGenerators') as ResolvedReportGenerator[],
    eventSubscribers: byKind('eventSubscribers') as ResolvedEventSubscriber[],
    executionActions: byKind('executionActions') as ResolvedExecutionAction[],
    uiExtensions: byKind('uiExtensions') as ResolvedUiExtension[],
  };

  // Reject implementations for contributions that were never declared.
  for (const kind of CONTRIBUTION_KINDS) {
    const implMap = contributions[KIND_KEY[kind]] ?? {};
    for (const id of Object.keys(implMap)) {
      const declared = declaredKinds.some((contribution) => contribution.kind === kind && contribution.id === id);
      if (!declared) {
        throw new PluginError(PluginErrorCode.invalidCode, `Plugin '${manifest.id}' implements undeclared ${kind} '${id}'.`, {
          context: { id, kind },
        });
      }
    }
  }

  return { manifest, hooks, contributions: loaded };
}

/** Whether a hook function id maps to a known lifecycle hook name. */
export function isHookName(value: string): value is PluginHookName {
  return (PLUGIN_HOOK_NAMES as readonly string[]).includes(value);
}

/** The permission a resolved contribution requires at dispatch time. */
export function requiredPermission(contribution: ResolvedContribution): string {
  return contribution.permission ?? defaultPermissionFor(contribution.kind);
}

/** Formats a plugin event for delivery (plain object with safe keys). */
export function formatEvent(event: PluginEvent): PluginEvent {
  return {
    type: event.type,
    ...(event.aggregateType === undefined ? {} : { aggregateType: event.aggregateType }),
    ...(event.aggregateId === undefined ? {} : { aggregateId: event.aggregateId }),
    ...(event.payload === undefined ? {} : { payload: event.payload }),
  };
}

export { EMPTY_RESOLVED };
