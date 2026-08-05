/**
 * Generates deterministic alerts from observability events: execution
 * failures, rollback/validation spikes and SEO regressions. Spike detection
 * reads the immutable event log so thresholds are exact. Alert ids derive
 * from event content, so re-delivered events never duplicate alerts.
 */

import { deterministicUuid } from '@seogod/execution-engine';
import type { ObservabilityStore } from '../store/observability-store.js';
import type { ObservabilityEvent } from '../types/events.js';
import type { AlertRecord, AlertSeverity, AlertType } from '../types/models.js';
import type { AlertEngineOptions } from '../types/options.js';
import { DEFAULT_ALERT_OPTIONS } from '../types/options.js';

function storeIdOf(event: ObservabilityEvent): string | undefined {
  return event.storeId;
}

export class AlertService {
  constructor(
    private readonly store: ObservabilityStore,
    private readonly options: AlertEngineOptions = DEFAULT_ALERT_OPTIONS,
  ) {}

  /** Evaluates one event and returns the alerts it triggers. */
  async evaluate(event: ObservabilityEvent, at: string): Promise<AlertRecord[]> {
    const storeId = storeIdOf(event);
    switch (event.type) {
      case 'execution.failed': {
        const retryCount = event.retryCount ?? 0;
        const severity = retryCount >= this.options.criticalRetryCount ? 'critical' : 'warning';
        return [
          this.makeAlert(
            'execution_failure',
            severity,
            `Execution ${event.executionId} failed: ${event.error}`,
            at,
            storeId,
            { executionId: event.executionId, error: event.error, retryCount },
            event.executionId,
          ),
        ];
      }
      case 'execution.publisher_failed':
        return [
          this.makeAlert(
            'execution_failure',
            'critical',
            `Execution ${event.executionId} could not publish writes: ${event.error}`,
            at,
            storeId,
            { executionId: event.executionId, error: event.error },
            `${event.executionId}:${event.error}`,
          ),
        ];
      case 'execution.rollback_failed':
        return [
          this.makeAlert(
            'execution_failure',
            'critical',
            `Rollback failed for execution ${event.executionId}: ${event.error}`,
            at,
            storeId,
            { executionId: event.executionId, rollbackId: event.rollbackId, error: event.error },
            `${event.executionId}:${event.rollbackId ?? ''}`,
          ),
        ];
      case 'execution.safety_violation':
        return [
          this.makeAlert(
            'execution_failure',
            'critical',
            `Safety violation in execution ${event.executionId}: ${event.violation}`,
            at,
            storeId,
            { executionId: event.executionId, violation: event.violation },
            `${event.executionId}:${event.violation}`,
          ),
        ];
      case 'execution.rollback_completed': {
        const count = await this.countInWindow('execution.rollback_completed', at, this.options.rollbackSpikeWindowMs, storeId);
        if (count < this.options.rollbackSpikeThreshold) return [];
        return [
          this.makeAlert(
            'rollback_spike',
            'critical',
            `Rollback spike: ${count} rollbacks in the last window`,
            at,
            storeId,
            { count, threshold: this.options.rollbackSpikeThreshold, windowMs: this.options.rollbackSpikeWindowMs },
            `rollback_spike:${storeId ?? ''}:${count}`,
          ),
        ];
      }
      case 'validation.failed': {
        const count = await this.countInWindow('validation.failed', at, this.options.validationSpikeWindowMs, storeId);
        if (count < this.options.validationSpikeThreshold) return [];
        return [
          this.makeAlert(
            'validation_spike',
            'warning',
            `Validation spike: ${count} validation failures in the last window`,
            at,
            storeId,
            { count, threshold: this.options.validationSpikeThreshold, codes: event.codes },
            `validation_spike:${storeId ?? ''}:${count}`,
          ),
        ];
      }
      case 'seo.analysis.completed':
        return this.evaluateSeoRegression(event, at);
      default:
        return [];
    }
  }

  private async evaluateSeoRegression(
    event: Extract<ObservabilityEvent, { type: 'seo.analysis.completed' }>,
    at: string,
  ): Promise<AlertRecord[]> {
    const snapshots = await this.store.listSnapshots({ storeId: event.storeId, limit: 2 });
    const previous = snapshots[1];
    if (previous === undefined) return [];
    const drop = previous.overallScore - event.overallScore;
    if (drop < this.options.seoRegressionDelta) return [];
    return [
      this.makeAlert(
        'seo_regression',
        'warning',
        `SEO regression for ${event.storeId}: score dropped ${drop.toFixed(1)} points (${previous.overallScore} -> ${event.overallScore})`,
        at,
        event.storeId,
        {
          storeId: event.storeId,
          previousScore: previous.overallScore,
          currentScore: event.overallScore,
          drop,
          threshold: this.options.seoRegressionDelta,
        },
        `${event.storeId}:${previous.overallScore}->${event.overallScore}`,
      ),
    ];
  }

  private async countInWindow(type: string, at: string, windowMs: number, storeId?: string): Promise<number> {
    const since = new Date(Date.parse(at) - windowMs).toISOString();
    const events = await this.store.listEvents(storeId === undefined ? { since } : { storeId, since });
    return events.reduce((count, event) => (event.type === type ? count + 1 : count), 0);
  }

  private makeAlert(
    type: AlertType,
    severity: AlertSeverity,
    message: string,
    at: string,
    storeId: string | undefined,
    context: Record<string, unknown>,
    seed: string,
  ): AlertRecord {
    return {
      alertId: deterministicUuid(`alert:${type}:${seed}`),
      type,
      severity,
      message,
      triggeredAt: at,
      storeId,
      context,
    };
  }
}
