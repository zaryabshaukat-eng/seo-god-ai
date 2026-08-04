import { REJECTED_ACTION_TYPES, type SafetyConfig } from '../types/safety.js';
import { InvalidExecutionError } from '../utils/errors.js';

export const DEFAULT_SAFETY_CONFIG: SafetyConfig = {
  maxBatchSize: 100,
  maxWriteRatePerMinute: 40,
  requireApproval: true,
  approvalRequiredActions: [],
  executionTimeoutMs: 30_000,
  maxConcurrency: 4,
  allowedModes: ['DRY_RUN', 'SIMULATION', 'STAGING', 'PRODUCTION'],
  enforceStoreLock: true,
  emergencyStopEnabled: true,
  autoRollbackOnFailure: true,
  requireStateCheck: true,
  maxRetries: 3,
  backoffMs: 250,
  rejectedActionTypes: [...REJECTED_ACTION_TYPES],
  featureFlags: {},
};

export function normalizeSafetyConfig(overrides?: Partial<SafetyConfig>): SafetyConfig {
  return { ...DEFAULT_SAFETY_CONFIG, ...(overrides ?? {}) };
}

export function assertValidConfig(config: SafetyConfig): void {
  if (!Number.isFinite(config.maxBatchSize) || config.maxBatchSize <= 0) {
    throw new InvalidExecutionError('maxBatchSize must be a positive number');
  }
  if (!Number.isFinite(config.maxWriteRatePerMinute) || config.maxWriteRatePerMinute <= 0) {
    throw new InvalidExecutionError('maxWriteRatePerMinute must be a positive number');
  }
  if (!Number.isFinite(config.executionTimeoutMs) || config.executionTimeoutMs <= 0) {
    throw new InvalidExecutionError('executionTimeoutMs must be a positive number');
  }
  if (!Number.isFinite(config.maxConcurrency) || config.maxConcurrency <= 0) {
    throw new InvalidExecutionError('maxConcurrency must be a positive number');
  }
  if (config.allowedModes.length === 0) {
    throw new InvalidExecutionError('allowedModes must contain at least one mode');
  }
  if (!Number.isFinite(config.maxRetries) || config.maxRetries < 0) {
    throw new InvalidExecutionError('maxRetries must be zero or positive');
  }
  if (!Number.isFinite(config.backoffMs) || config.backoffMs < 0) {
    throw new InvalidExecutionError('backoffMs must be zero or positive');
  }
}

export function isModeAllowed(mode: string, config: SafetyConfig): boolean {
  return config.allowedModes.includes(mode as SafetyConfig['allowedModes'][number]);
}
