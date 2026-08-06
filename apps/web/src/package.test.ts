import { describe, expect, it } from 'vitest';
import { packageName } from './package.js';

describe('package', () => {
  it('identifies the web package', () => {
    expect(packageName).toBe('@seogod/web');
  });
});
