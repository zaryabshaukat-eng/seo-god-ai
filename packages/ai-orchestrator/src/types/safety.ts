/**
 * Safety types. Every AI output passes a {@link SafetyDecision} gate before
 * anything is executed: empty outputs, unsafe actions, invalid JSON, schema
 * violations, and unsupported actions are rejected.
 */

export type SafetyCheckId =
  | 'non-empty'
  | 'valid-json'
  | 'schema'
  | 'supported-action'
  | 'safe-action';

export interface SafetyCheck {
  id: SafetyCheckId;
  label: string;
  passed: boolean;
  detail?: string;
}

export interface SafetyDecision {
  ok: boolean;
  checks: SafetyCheck[];
  /** Human-readable rejection reason when `ok` is false. */
  reason?: string;
}
