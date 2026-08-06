import { describe, expect, it } from 'vitest';
import { renderToString } from '../vdom.js';
import type { User, UserPreferences } from '../types.js';
import { createSettingsApi, profileFromUser, renderSettingsPage, validateProfileForm, validateStoreSettingsForm } from './settings.js';

const USER: User = { id: 'u1', name: 'Ada', email: 'ada@example.com', role: 'admin', tenantId: 't1', orgIds: ['o1'], locale: 'en', timezone: 'UTC', avatarUrl: undefined };
const PREFS: UserPreferences = {
  theme: 'dark',
  locale: 'en',
  timezone: 'UTC',
  notifications: { email: true, realtime: false, alerts: true, digests: true },
};

describe('validateProfileForm', () => {
  it('accepts a valid profile', () => {
    expect(validateProfileForm({ name: 'Ada', email: 'ada@example.com' })).toEqual({});
  });

  it('rejects missing name', () => {
    expect(validateProfileForm({ name: ' ', email: 'ada@example.com' }).name).toBe('Name is required.');
  });

  it('rejects missing or invalid email', () => {
    expect(validateProfileForm({ name: 'Ada', email: ' ' }).email).toBe('Email is required.');
    expect(validateProfileForm({ name: 'Ada', email: 'nope' }).email).toBe('Enter a valid email address.');
  });
});

describe('validateStoreSettingsForm', () => {
  it('accepts a valid store', () => {
    expect(validateStoreSettingsForm({ name: 'Shop', domain: 'shop.myshopify.com' })).toEqual({});
    expect(validateStoreSettingsForm({ name: 'Shop', domain: 'shop.com' })).toEqual({});
  });

  it('rejects a missing name', () => {
    expect(validateStoreSettingsForm({ name: '', domain: 'shop.com' }).name).toBe('Store name is required.');
  });

  it('rejects a bad domain', () => {
    expect(validateStoreSettingsForm({ name: 'Shop', domain: '' }).domain).toBe('Store domain is required.');
    expect(validateStoreSettingsForm({ name: 'Shop', domain: 'not a domain' }).domain).toBe('Enter a valid store domain.');
  });
});

describe('profileFromUser', () => {
  it('maps a user to a profile form', () => {
    expect(profileFromUser(USER)).toEqual({ name: 'Ada', email: 'ada@example.com', avatarUrl: undefined });
  });
});

describe('renderSettingsPage', () => {
  it('renders profile, store, preferences and danger zone for writers', () => {
    const html = renderToString(
      renderSettingsPage({
        profile: profileFromUser(USER),
        store: { name: 'Shop', domain: 'shop.myshopify.com' },
        prefs: PREFS,
        canWrite: true,
        profileErrors: {},
        storeErrors: {},
        error: 'Failed',
      }),
    );
    expect(html).toContain('id="profile-form"');
    expect(html).toContain('id="store-form"');
    expect(html).toContain('id="preferences-form"');
    expect(html).toContain('Danger zone');
    expect(html).toContain('data-action="settings:delete-account"');
  });

  it('shows a read-only notice and no forms for readers', () => {
    const html = renderToString(
      renderSettingsPage({
        profile: profileFromUser(USER),
        store: { name: 'Shop', domain: 'shop.myshopify.com' },
        prefs: PREFS,
        canWrite: false,
        profileErrors: {},
        storeErrors: {},
      }),
    );
    expect(html).toContain('You do not have permission to change settings.');
    expect(html).not.toContain('id="store-form"');
  });
});

describe('createSettingsApi', () => {
  it('wraps settings endpoints onto the client', async () => {
    const calls: Array<{ method: string; url: string; body: unknown }> = [];
    const api = {
      request: async <T>(method: string, url: string, body: unknown): Promise<T> => {
        calls.push({ method, url, body });
        return { ok: true } as T;
      },
    } as never;
    const settingsApi = createSettingsApi(api);
    await settingsApi.get();
    await settingsApi.update(PREFS);
    await settingsApi.profile({ name: 'Ada', email: 'a@b.com' });
    expect(calls).toEqual([
      { method: 'GET', url: '/api/v1/settings', body: undefined },
      { method: 'PUT', url: '/api/v1/settings', body: PREFS },
      { method: 'PATCH', url: '/api/v1/settings/profile', body: { name: 'Ada', email: 'a@b.com' } },
    ]);
  });
});
