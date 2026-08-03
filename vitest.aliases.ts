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
  'crawler',
  'reports',
  'safety',
  'seo-engine',
  'knowledge-graph',
  'ui',
];

/**
 * Maps `@seogod/<package>` to each package's TypeScript source entry point so
 * Vitest runs against source (not stale `dist` output).
 */
export function workspaceAliases(): Record<string, string> {
  return Object.fromEntries(
    PACKAGES.map((pkg) => [`@seogod/${pkg}`, resolve(ROOT_DIR, 'packages', pkg, 'src', 'index.ts')]),
  );
}
