/**
 * Hand-rolled validators. Controllers validate request bodies against small
 * helper functions that collect field errors and throw a single
 * `ApiValidationError` describing every problem, matching the web client's
 * expected error contract.
 */

import { ApiValidationError } from './errors.js';

export interface FieldErrors {
  [field: string]: string;
}

export interface Validator {
  validate(): FieldErrors;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(body: unknown, field: string): string | undefined {
  if (!isRecord(body)) return undefined;
  const value = body[field];
  return typeof value === 'string' ? value : undefined;
}

function booleanField(body: unknown, field: string): boolean | undefined {
  if (!isRecord(body)) return undefined;
  const value = body[field];
  return typeof value === 'boolean' ? value : undefined;
}

function numberField(body: unknown, field: string): number | undefined {
  if (!isRecord(body)) return undefined;
  const value = body[field];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function arrayField(body: unknown, field: string): unknown[] | undefined {
  if (!isRecord(body)) return undefined;
  const value = body[field];
  return Array.isArray(value) ? value : undefined;
}

/** Requires a non-empty string field. */
export function requireString(body: unknown, field: string, label = field): string {
  const value = stringField(body, field);
  if (value === undefined || value.trim().length === 0) {
    throw new ApiValidationError(`${label} is required.`, { [field]: `${label} is required.` });
  }
  return value.trim();
}

/** Requires a valid email field. */
export function requireEmail(body: unknown, field = 'email'): string {
  const value = requireString(body, field, 'Email');
  if (!EMAIL_PATTERN.test(value)) {
    throw new ApiValidationError('Enter a valid email address.', { [field]: 'Enter a valid email address.' });
  }
  return value;
}

/** Requires a password of at least 8 characters. */
export function requirePassword(body: unknown, field = 'password', minLength = 8): string {
  const value = requireString(body, field, 'Password');
  if (value.length < minLength) {
    throw new ApiValidationError(`Password must be at least ${minLength} characters.`, {
      [field]: `Password must be at least ${minLength} characters.`,
    });
  }
  return value;
}

/** Reads an optional string field, trimmed. */
export function optionalString(body: unknown, field: string): string | undefined {
  const value = stringField(body, field);
  return value === undefined ? undefined : value.trim();
}

/** Reads an optional boolean field. */
export function optionalBoolean(body: unknown, field: string): boolean | undefined {
  return booleanField(body, field);
}

/** Reads an optional finite number field. */
export function optionalNumber(body: unknown, field: string): number | undefined {
  return numberField(body, field);
}

/** Reads an optional array field; validates element type when `of` is set. */
export function optionalArray(body: unknown, field: string): unknown[] {
  return arrayField(body, field) ?? [];
}

/** Requires a plain-object field; throws otherwise. */
export function requireRecord(body: unknown, field: string): Record<string, unknown> {
  const value = isRecord(body) ? body[field] : undefined;
  if (value === undefined || !isRecord(value)) {
    throw new ApiValidationError(`${field} must be an object.`, { [field]: 'Must be an object.' });
  }
  return value;
}

/** Requires the field to be one of `allowed`; returns the matched value. */
export function requireEnum<T extends string>(body: unknown, field: string, allowed: readonly T[], label = field): T {
  const value = requireString(body, field, label);
  if (!allowed.includes(value as T)) {
    throw new ApiValidationError(`${label} must be one of: ${allowed.join(', ')}.`, {
      [field]: `Must be one of: ${allowed.join(', ')}.`,
    });
  }
  return value as T;
}

/** Runs multiple validators, collecting all field errors before throwing. */
export function validateAll(validators: Array<() => FieldErrors>): void {
  const errors: FieldErrors = {};
  for (const validator of validators) {
    Object.assign(errors, validator());
  }
  const keys = Object.keys(errors);
  if (keys.length > 0) {
    throw new ApiValidationError('One or more fields are invalid.', errors);
  }
}
