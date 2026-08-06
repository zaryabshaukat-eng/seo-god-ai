import { describe, expect, it } from 'vitest';
import {
  ALL_UI_PERMISSIONS,
  ENDPOINTS,
  Permissions,
  endpoint,
  endpointAuth,
  endpointPath,
  endpointPermission,
} from './endpoints.js';

describe('endpoints registry', () => {
  it('exposes every endpoint with method, path and auth metadata', () => {
    expect(endpoint('login')).toEqual({ method: 'POST', path: '/api/v1/auth/login', auth: false });
    expect(endpoint('me')).toMatchObject({ method: 'GET', path: '/api/v1/auth/me', auth: true });
  });

  it('permission metadata is present on gated endpoints and absent on auth endpoints', () => {
    expect(endpointPermission('crawlsStart')).toBe(Permissions.crawlWrite);
    expect(endpointPermission('login')).toBeUndefined();
    expect(endpointAuth('dashboardOverview')).toBe(true);
    expect(endpointAuth('register')).toBe(false);
  });

  it('interpolates path parameters', () => {
    expect(endpointPath('crawlsGet', { id: 42 })).toBe('/api/v1/crawls/42');
    expect(endpointPath('executionsApprove', { id: 'e1' })).toBe('/api/v1/executions/e1/approve');
  });

  it('leaves unknown placeholders untouched', () => {
    expect(endpointPath('alertsAcknowledge', {})).toBe('/api/v1/observability/alerts/:id/acknowledge');
  });

  it('interpolates without params safely', () => {
    expect(endpointPath('reportsList')).toBe('/api/v1/reports');
  });

  it('exposes the full permission vocabulary', () => {
    expect(Permissions.dashboardRead).toBe('dashboard.read');
    expect(Permissions.executionWrite).toBe('execution.write');
    expect(ALL_UI_PERMISSIONS).toContain(Permissions.adminRead);
  });

  it('registers endpoints for every feature area', () => {
    const paths = Object.values(ENDPOINTS).map((spec) => spec.path);
    expect(paths.some((path) => path.includes('/crawls'))).toBe(true);
    expect(paths.some((path) => path.includes('/seo/'))).toBe(true);
    expect(paths.some((path) => path.includes('/copilot/'))).toBe(true);
    expect(paths.some((path) => path.includes('/admin/'))).toBe(true);
    expect(paths.some((path) => path.includes('/notifications'))).toBe(true);
  });
});
