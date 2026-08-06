import { describe, expect, it } from 'vitest';
import { renderToString } from '../vdom.js';
import { loginPageEl, registerPageEl, resetPageEl, validateLoginForm, validateRegisterForm, validateResetForm } from './auth.js';

describe('validateLoginForm', () => {
  it('accepts a valid login', () => {
    expect(validateLoginForm({ email: 'a@b.com', password: 'password1', remember: false })).toEqual({});
  });

  it('rejects a missing email', () => {
    const errors = validateLoginForm({ email: '  ', password: 'password1', remember: false });
    expect(errors.email).toBe('Email is required.');
  });

  it('rejects a malformed email', () => {
    const errors = validateLoginForm({ email: 'nope', password: 'password1', remember: false });
    expect(errors.email).toBe('Enter a valid email address.');
  });

  it('rejects a short password', () => {
    const errors = validateLoginForm({ email: 'a@b.com', password: 'short', remember: false });
    expect(errors.password).toBe('Password must be at least 8 characters.');
  });

  it('rejects a missing password', () => {
    const errors = validateLoginForm({ email: 'a@b.com', password: '', remember: false });
    expect(errors.password).toBe('Password is required.');
  });
});

describe('validateRegisterForm', () => {
  it('accepts a complete registration', () => {
    expect(validateRegisterForm({ name: 'Ada', storeName: 'Store', email: 'a@b.com', password: 'password1' })).toEqual({});
  });

  it('requires a name and store name', () => {
    const errors = validateRegisterForm({ name: ' ', storeName: ' ', email: 'a@b.com', password: 'password1' });
    expect(errors.name).toBe('Name is required.');
    expect(errors.storeName).toBe('Store name is required.');
  });

  it('reuses login email validation', () => {
    const errors = validateRegisterForm({ name: 'Ada', storeName: 'Store', email: 'nope', password: 'password1' });
    expect(errors.email).toBe('Enter a valid email address.');
  });
});

describe('validateResetForm', () => {
  it('accepts a valid email', () => {
    expect(validateResetForm({ email: 'a@b.com' })).toEqual({});
  });

  it('rejects a missing email', () => {
    expect(validateResetForm({ email: '  ' }).email).toBe('Email is required.');
  });

  it('rejects a malformed email', () => {
    expect(validateResetForm({ email: 'bad' }).email).toBe('Enter a valid email address.');
  });
});

describe('loginPageEl', () => {
  it('renders the sign-in form and links', () => {
    const html = renderToString(
      loginPageEl({ form: { email: 'a@b.com', password: 'x', remember: true }, errors: { password: 'Too short' }, error: 'Denied' }),
    );
    expect(html).toContain('Welcome back');
    expect(html).toContain('id="login-form"');
    expect(html).toContain('aria-invalid');
    expect(html).toContain('role="alert"');
    expect(html).toContain('>Denied</p>');
    expect(html).toContain('href="/register"');
    expect(html).toContain('href="/reset"');
  });
});

describe('registerPageEl', () => {
  it('renders the registration form', () => {
    const html = renderToString(
      registerPageEl({ form: { name: 'Ada', storeName: 'S', email: '', password: '' }, errors: {}, error: 'Conflict' }),
    );
    expect(html).toContain('Create your account');
    expect(html).toContain('id="register-name"');
    expect(html).toContain('id="register-store"');
    expect(html).toContain('id="register-email"');
    expect(html).toContain('id="register-password"');
    expect(html).toContain('href="/login"');
  });
});

describe('resetPageEl', () => {
  it('renders the reset form', () => {
    const html = renderToString(resetPageEl({ form: { email: 'a@b.com' }, errors: {}, error: 'Sent' }));
    expect(html).toContain('Reset your password');
    expect(html).toContain('id="reset-form"');
    expect(html).toContain('id="reset-email"');
    expect(html).toContain('href="/login"');
  });
});
