/**
 * In-memory per-tenant workspace settings store. `update` merges arbitrary
 * keys onto the tenant defaults; profile preferences are keyed per
 * tenant + user so each member keeps their own view.
 */

export type WorkspaceTheme = 'light' | 'dark' | 'system';

export interface WorkspaceSettings {
  storeName: string;
  shopDomain: string;
  locale: string;
  timezone: string;
  notificationsEnabled: boolean;
  requireApproval: boolean;
  theme: WorkspaceTheme;
  [key: string]: unknown;
}

export interface ProfilePreferences {
  locale: string;
  timezone: string;
  theme: WorkspaceTheme;
  [key: string]: unknown;
}

function defaultSettings(): WorkspaceSettings {
  return {
    storeName: 'My Store',
    shopDomain: '',
    locale: 'en',
    timezone: 'UTC',
    notificationsEnabled: true,
    requireApproval: true,
    theme: 'system',
  };
}

function defaultProfile(): ProfilePreferences {
  return { locale: 'en', timezone: 'UTC', theme: 'system' };
}

export class SettingsStore {
  private readonly settings = new Map<string, WorkspaceSettings>();
  private readonly profiles = new Map<string, ProfilePreferences>();

  get(tenantId: string): WorkspaceSettings {
    return { ...(this.settings.get(tenantId) ?? defaultSettings()) };
  }

  update(tenantId: string, patch: Record<string, unknown>): WorkspaceSettings {
    const current = this.settings.get(tenantId) ?? defaultSettings();
    const next = { ...current, ...patch };
    this.settings.set(tenantId, next);
    return { ...next };
  }

  getProfile(tenantId: string, userId: string): ProfilePreferences {
    return { ...(this.profiles.get(profileKey(tenantId, userId)) ?? defaultProfile()) };
  }

  updateProfile(tenantId: string, userId: string, patch: Record<string, unknown>): ProfilePreferences {
    const current = this.profiles.get(profileKey(tenantId, userId)) ?? defaultProfile();
    const next = { ...current, ...patch };
    this.profiles.set(profileKey(tenantId, userId), next);
    return { ...next };
  }

  reset(): void {
    this.settings.clear();
    this.profiles.clear();
  }
}

function profileKey(tenantId: string, userId: string): string {
  return `${tenantId}:${userId}`;
}
