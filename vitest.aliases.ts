import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const ROOT_DIR = fileURLToPath(new URL('.', import.meta.url));

const PACKAGES = [
  'core',
  'config',
  'logging',
  'shared',
  'database',
  'audit',
  'events',
  'monitoring',
  'shopify',
  'agents',
  'ai',
  'ai-copilot',
  'crawler',
  'reports',
  'safety',
  'seo-engine',
  'knowledge-graph',
  'decision-engine',
  'ai-orchestrator',
  'execution-engine',
  'observability',
  'google-integrations',
  'learning-engine',
  'scheduler',
  'enterprise',
  'ui',
];

/** Workspace applications (under `apps/`). */
const APPS = ['web'];

/**
 * Maps `@seogod/<package>` to each workspace package/application's TypeScript
 * source entry point so that Vitest runs against source (not stale `dist`).
 */
export function workspaceAliases(): Record<string, string> {
  return Object.fromEntries([
    ...PACKAGES.map((pkg) => [`@seogod/${pkg}`, resolve(ROOT_DIR, 'packages', pkg, 'src', 'index.ts')]),
    ...APPS.map((app) => [`@seogod/${app}`, resolve(ROOT_DIR, 'apps', app, 'src', 'index.ts')]),
  ]);
}
