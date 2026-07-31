import { defineConfig } from 'vitest/config';
import { workspaceAliases } from '../../vitest.aliases.js';

export default defineConfig({
  resolve: { alias: workspaceAliases() },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      reporter: ['text', 'json', 'html'],
      include: ['src/**'],
      exclude: ['src/**/*.test.ts', 'src/index.ts'],
    },
  },
});
