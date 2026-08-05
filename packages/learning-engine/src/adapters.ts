/**
 * Integration adapters. These map decision-engine and observability records
 * onto learning-engine shapes using minimal structural contracts, so the
 * learning engine never needs those packages at runtime.
 */

import type {
  ExecutionRecordLike,
  ExecutionResultLike,
  HistoricalOutcomeResult,
  LearningSignalLike,
  OutcomeInput,
  OutcomeStatus,
} from './types.js';

/** Maps a decision-engine `ExecutionResult` into a learning outcome. */
export function fromExecutionResult(result: ExecutionResultLike, rule?: string): OutcomeInput {
  return {
    executionId: result.id,
    storeId: result.storeId,
    rule,
    status: mapResultStatus(result.status),
    durationMs: result.durationMs,
    createdAt: result.completedAt?.toISOString(),
  };
}

/**
 * Maps an observability `ExecutionRecord` into a learning outcome, or `null`
 * for non-terminal records that carry no outcome yet.
 */
export function fromExecutionRecord(record: ExecutionRecordLike): OutcomeInput | null {
  const status = mapRecordStatus(record.status);
  if (status === null) return null;
  return {
    executionId: record.executionId,
    storeId: record.storeId,
    rule: record.operation,
    status,
    durationMs: record.durationMs,
    createdAt: record.completedAt ?? record.startedAt,
  };
}

/** Maps an observability `LearningSignal` into a decision-engine-ready historical outcome. */
export function fromObservabilitySignal(signal: LearningSignalLike): HistoricalOutcomeResult {
  return {
    rule: signal.rule,
    attempts: signal.attempts,
    successes: signal.successes,
    averageImpact: signal.averageImpact,
  };
}

function mapResultStatus(status: ExecutionResultLike['status']): OutcomeStatus {
  switch (status) {
    case 'SUCCESS':
      return 'SUCCESS';
    case 'FAILURE':
      return 'FAILURE';
    case 'SKIPPED':
      return 'SKIPPED';
  }
}

function mapRecordStatus(status: ExecutionRecordLike['status']): OutcomeStatus | null {
  switch (status) {
    case 'COMPLETED':
      return 'SUCCESS';
    case 'FAILED':
      return 'FAILURE';
    case 'CANCELLED':
      return 'SKIPPED';
    case 'ROLLED_BACK':
      return 'ROLLED_BACK';
    case 'QUEUED':
    case 'EXECUTING':
      return null;
  }
}
