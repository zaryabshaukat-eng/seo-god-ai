import { checkboxEl, formEl, inputEl } from '../ui/primitives.js';
import { h } from '../vdom.js';
import type { LoginForm, RegisterForm, ResetPasswordForm, VNode } from '../types.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type LoginFieldErrors = Partial<Record<'email' | 'password', string>>;
export type RegisterFieldErrors = Partial<Record<'name' | 'email' | 'password' | 'storeName', string>>;
export type ResetFieldErrors = Partial<Record<'email', string>>;

/** Validates the sign-in form. */
export function validateLoginForm(form: LoginForm): LoginFieldErrors {
  const errors: LoginFieldErrors = {};
  const email = form.email.trim();
  if (email.length === 0) {
    errors.email = 'Email is required.';
  } else if (!EMAIL_RE.test(email)) {
    errors.email = 'Enter a valid email address.';
  }
  if (form.password.length === 0) {
    errors.password = 'Password is required.';
  } else if (form.password.length < 8) {
    errors.password = 'Password must be at least 8 characters.';
  }
  return errors;
}

/** Validates the registration form. */
export function validateRegisterForm(form: RegisterForm): RegisterFieldErrors {
  const errors: RegisterFieldErrors = {};
  if (form.name.trim().length === 0) {
    errors.name = 'Name is required.';
  }
  if (form.storeName.trim().length === 0) {
    errors.storeName = 'Store name is required.';
  }
  const emailErrors = validateLoginForm({ email: form.email, password: form.password, remember: false });
  if (emailErrors.email) {
    errors.email = emailErrors.email;
  }
  if (emailErrors.password) {
    errors.password = emailErrors.password;
  }
  return errors;
}

/** Validates the password-reset form. */
export function validateResetForm(form: ResetPasswordForm): ResetFieldErrors {
  const errors: ResetFieldErrors = {};
  if (form.email.trim().length === 0) {
    errors.email = 'Email is required.';
  } else if (!EMAIL_RE.test(form.email.trim())) {
    errors.email = 'Enter a valid email address.';
  }
  return errors;
}

export interface AuthPageModel {
  error?: string;
  loading?: boolean;
}

export interface LoginPageModel extends AuthPageModel {
  form: LoginForm;
  errors: LoginFieldErrors;
}

export interface RegisterPageModel extends AuthPageModel {
  form: RegisterForm;
  errors: RegisterFieldErrors;
}

export interface ResetPageModel extends AuthPageModel {
  form: ResetPasswordForm;
  errors: ResetFieldErrors;
}

function authShell(content: VNode[], heading: string, subtitle: string): VNode {
  return h(
    'main',
    { id: 'main', class: 'auth-page' },
    h('div', { class: 'auth-card' }, h('h1', { class: 'auth-card__title' }, heading), h('p', { class: 'auth-card__subtitle' }, subtitle), ...content),
  );
}

/** Renders the sign-in page. */
export function loginPageEl(model: LoginPageModel): VNode {
  const fields = [
    inputEl({
      id: 'login-email',
      label: 'Email',
      type: 'email',
      value: model.form.email,
      autocomplete: 'email',
      required: true,
      invalid: Boolean(model.errors.email),
      errorText: model.errors.email,
    }),
    inputEl({
      id: 'login-password',
      label: 'Password',
      type: 'password',
      value: model.form.password,
      autocomplete: 'current-password',
      required: true,
      invalid: Boolean(model.errors.password),
      errorText: model.errors.password,
    }),
    checkboxEl({ id: 'login-remember', label: 'Remember me', checked: model.form.remember }),
  ];
  const links = h(
    'p',
    { class: 'auth-card__links' },
    h('a', { href: '/register' }, 'Create account'),
    ' · ',
    h('a', { href: '/reset' }, 'Forgot password?'),
  );
  const form = formEl({
    id: 'login-form',
    fields,
    submitLabel: 'Sign in',
    errorText: model.error,
  });
  return authShell([form, links], 'Welcome back', 'Sign in to SEO GOD AI');
}

/** Renders the registration page. */
export function registerPageEl(model: RegisterPageModel): VNode {
  const fields = [
    inputEl({ id: 'register-name', label: 'Full name', value: model.form.name, autocomplete: 'name', required: true, invalid: Boolean(model.errors.name), errorText: model.errors.name }),
    inputEl({ id: 'register-store', label: 'Store name', value: model.form.storeName, required: true, invalid: Boolean(model.errors.storeName), errorText: model.errors.storeName }),
    inputEl({ id: 'register-email', label: 'Email', type: 'email', value: model.form.email, autocomplete: 'email', required: true, invalid: Boolean(model.errors.email), errorText: model.errors.email }),
    inputEl({ id: 'register-password', label: 'Password', type: 'password', value: model.form.password, autocomplete: 'new-password', required: true, invalid: Boolean(model.errors.password), errorText: model.errors.password }),
  ];
  const form = formEl({ id: 'register-form', fields, submitLabel: 'Create account', errorText: model.error });
  const links = h('p', { class: 'auth-card__links' }, h('a', { href: '/login' }, 'Already have an account? Sign in'));
  return authShell([form, links], 'Create your account', 'Start optimizing your store with SEO GOD AI');
}

/** Renders the password-reset page. */
export function resetPageEl(model: ResetPageModel): VNode {
  const fields = [
    inputEl({ id: 'reset-email', label: 'Email', type: 'email', value: model.form.email, autocomplete: 'email', required: true, invalid: Boolean(model.errors.email), errorText: model.errors.email }),
  ];
  const form = formEl({ id: 'reset-form', fields, submitLabel: 'Send reset link', errorText: model.error });
  const links = h('p', { class: 'auth-card__links' }, h('a', { href: '/login' }, 'Back to sign in'));
  return authShell([form, links], 'Reset your password', "We'll email you a link to reset your password");
}
