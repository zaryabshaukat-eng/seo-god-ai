import { createApiFunctions } from './api-helpers.js';
import { cardEl, checkboxEl, formEl, inputEl, selectEl } from '../ui/primitives.js';
import { gridEl, pageHeaderEl } from '../ui/layout.js';
import { h } from '../vdom.js';
import type { ApiClient } from '../api/client.js';
import type { ThemePref, User, UserPreferences, VNode } from '../types.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface ProfileForm {
  name: string;
  email: string;
  avatarUrl?: string;
}

export interface StoreSettingsForm {
  name: string;
  domain: string;
}

/** Validates the profile form. */
export function validateProfileForm(form: ProfileForm): { name?: string; email?: string } {
  const errors: { name?: string; email?: string } = {};
  if (form.name.trim().length === 0) {
    errors.name = 'Name is required.';
  }
  if (form.email.trim().length === 0) {
    errors.email = 'Email is required.';
  } else if (!EMAIL_RE.test(form.email.trim())) {
    errors.email = 'Enter a valid email address.';
  }
  return errors;
}

/** Validates the store settings form. */
export function validateStoreSettingsForm(form: StoreSettingsForm): { name?: string; domain?: string } {
  const errors: { name?: string; domain?: string } = {};
  if (form.name.trim().length === 0) {
    errors.name = 'Store name is required.';
  }
  if (form.domain.trim().length === 0) {
    errors.domain = 'Store domain is required.';
  } else if (!/^[a-z0-9.-]+\.(myshopify\.com|[a-z]{2,})$/.test(form.domain.trim())) {
    errors.domain = 'Enter a valid store domain.';
  }
  return errors;
}

/** Builds the profile form values from a user. */
export function profileFromUser(user: User): ProfileForm {
  return { name: user.name, email: user.email, avatarUrl: user.avatarUrl };
}

const THEME_OPTIONS: Array<{ value: ThemePref; label: string }> = [
  { value: 'system', label: 'Use system setting' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

/** Renders the settings page. */
export function renderSettingsPage(model: {
  profile: ProfileForm;
  store: StoreSettingsForm;
  prefs: UserPreferences;
  canWrite: boolean;
  profileErrors: { name?: string; email?: string };
  storeErrors: { name?: string; domain?: string };
  error?: string;
}): VNode {
  const profileForm = formEl({
    id: 'profile-form',
    title: 'Profile',
    fields: [
      inputEl({ id: 'profile-name', label: 'Full name', value: model.profile.name, autocomplete: 'name', required: true, invalid: Boolean(model.profileErrors.name), errorText: model.profileErrors.name }),
      inputEl({ id: 'profile-email', label: 'Email', type: 'email', value: model.profile.email, autocomplete: 'email', required: true, invalid: Boolean(model.profileErrors.email), errorText: model.profileErrors.email }),
    ],
    submitLabel: 'Save profile',
    errorText: model.error,
  });

  const storeForm = formEl({
    id: 'store-form',
    title: 'Store settings',
    fields: [
      inputEl({ id: 'store-name', label: 'Store name', value: model.store.name, required: true, invalid: Boolean(model.storeErrors.name), errorText: model.storeErrors.name }),
      inputEl({ id: 'store-domain', label: 'Store domain', value: model.store.domain, placeholder: 'your-store.myshopify.com', required: true, invalid: Boolean(model.storeErrors.domain), errorText: model.storeErrors.domain }),
    ],
    submitLabel: 'Save store settings',
  });

  const themeForm = formEl({
    id: 'preferences-form',
    title: 'Preferences',
    fields: [
      selectEl({ id: 'pref-theme', label: 'Theme', options: THEME_OPTIONS, value: model.prefs.theme }),
      checkboxEl({ id: 'pref-email', label: 'Email notifications', checked: model.prefs.notifications.email }),
      checkboxEl({ id: 'pref-realtime', label: 'Realtime notifications', checked: model.prefs.notifications.realtime }),
      checkboxEl({ id: 'pref-alerts', label: 'Alert notifications', checked: model.prefs.notifications.alerts }),
    ],
    submitLabel: 'Save preferences',
  });

  const dangerZone = h(
    'section',
    { class: 'settings-danger' },
    h('h2', {}, 'Danger zone'),
    h('p', {}, 'Deleting your account removes all stores, crawls and reports. This cannot be undone.'),
    h('a', { class: 'btn btn--danger', href: '#', 'data-action': 'settings:delete-account' }, 'Delete account'),
  );

  const gated = model.canWrite ? [storeForm, themeForm, dangerZone] : [h('p', { class: 'muted' }, 'You do not have permission to change settings.')];

  return h(
    'main',
    { id: 'main', class: 'page' },
    pageHeaderEl({ title: 'Settings', subtitle: 'Profile, store and preferences' }),
    gridEl([cardEl({ title: 'Profile', children: [profileForm] }), ...gated.map((node) => cardEl({ title: '', children: [node] }))], { sm: 1, lg: 2 }),
  );
}

/** REST wrappers for settings endpoints. */
export function createSettingsApi(api: ApiClient) {
  const call = createApiFunctions(api);
  return {
    get() {
      return call.get<UserPreferences>('settingsGet');
    },
    update(prefs: UserPreferences) {
      return call.put<UserPreferences>('settingsUpdate', prefs);
    },
    profile(form: ProfileForm) {
      return call.patch<ProfileForm>('profileUpdate', form);
    },
  };
}
