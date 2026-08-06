/**
 * Small deterministic helpers: ids, time, validation and message windowing.
 */

import { randomUUID } from 'node:crypto';

import type { CopilotMessage } from './types.js';
import { CopilotValidationError } from './errors.js';

const EMPTY_INPUT = 'Input cannot be empty.';

/** Generates a namespaced, unique id for sessions and audit resources. */
export function newCopilotId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

/** Current ISO timestamp; overridable via the injected `now`. */
export function timestamp(now: () => string): string {
  return now();
}

/** Rejects blank tenant ids. */
export function assertTenant(tenantId: string): void {
  if (typeof tenantId !== 'string' || tenantId.trim().length === 0) {
    throw new CopilotValidationError(EMPTY_INPUT, { operation: 'chat.validate', context: { field: 'tenantId' } });
  }
}

/** Rejects blank user messages. */
export function assertMessage(message: string): void {
  if (typeof message !== 'string' || message.trim().length === 0) {
    throw new CopilotValidationError(EMPTY_INPUT, { operation: 'chat.validate', context: { field: 'message' } });
  }
}

/** Clamps a positive integer within bounds, or returns `fallback`. */
export function positiveInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' && Number.isFinite(value) ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed < min) return min;
  if (parsed > max) return max;
  return Math.floor(parsed);
}

/**
 * Windows a conversation for the model: keeps the leading system message and
 * at most `history` trailing messages.
 */
export function windowMessages(messages: readonly CopilotMessage[], history: number): CopilotMessage[] {
  if (messages.length === 0) return [];
  const head = messages[0]?.role === 'system' ? [messages[0]] : [];
  const rest = messages.slice(head.length);
  const tail = history <= 0 ? [] : rest.slice(Math.max(0, rest.length - history));
  return [...head, ...tail];
}

/** Parses a JSON tool-arguments string defensively. */
export function parseToolArguments(raw: string): Record<string, unknown> {
  if (raw.trim().length === 0) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

/** True when a string is a valid tenant/session id prefix candidate. */
export function isBlank(value: string | undefined): boolean {
  return value === undefined || value.trim().length === 0;
}
