/**
 * Observability event inputs. The observability engine consumes structured
 * events from the execution engine, the crawler and the SEO engine and turns
 * them into records, metrics, alerts and learning signals.
 */

import type { CrawlStatistics } from '@seogod/crawler';
import type { ExecutionEvent } from '@seogod/execution-engine';

/** Crawler finished a crawl for a store. */
export interface CrawlCompletedEvent {
  type: 'crawl.completed';
  storeId: string;
  statistics: CrawlStatistics;
}

/** Crawler failed while crawling a store. */
export interface CrawlFailedEvent {
  type: 'crawl.failed';
  storeId: string;
  error: string;
}

/** SEO analysis result for a store. The seo-engine publishes these once it
 * emits events; consumers may also record them directly via the service. */
export interface SeoAnalysisEvent {
  type: 'seo.analysis.completed';
  storeId: string;
  crawlJobId?: string;
  executionId?: string;
  /** When the analysis was produced; defaults to recording time. */
  analyzedAt?: string;
  /** Overall SEO health score, 0..100. */
  overallScore: number;
  /** Per-category scores, e.g. `{ title: 80, description: 60 }`. */
  scores?: Record<string, number>;
  /** Issue counts grouped by category. */
  issues?: Array<{ category: string; count: number }>;
  recommendationsCount?: number;
  /** Whether this snapshot was captured before or after an execution. */
  reference?: 'BEFORE' | 'AFTER';
}

/** A validation rejection. Produced by the ai-orchestrator when an agent's
 * output fails validation, or by the execution engine when a step is
 * rejected by the validation pipeline. */
export interface ValidationFailedEvent {
  type: 'validation.failed';
  executionId?: string;
  stepId?: string;
  taskId?: string;
  storeId?: string;
  codes: string[];
  message?: string;
}

/** Every event the observability engine knows how to consume. */
export type ObservabilityEvent =
  | ExecutionEvent
  | CrawlCompletedEvent
  | CrawlFailedEvent
  | SeoAnalysisEvent
  | ValidationFailedEvent;

/** SEO analysis input accepted by `recordAnalysis` (type is implicit). */
export type SeoAnalysisInput = Omit<SeoAnalysisEvent, 'type'>;

/** Execution event types the consumer subscribes to. */
export const EXECUTION_EVENT_TYPES = [
  'execution.queued',
  'execution.started',
  'execution.completed',
  'execution.failed',
  'execution.cancelled',
  'execution.rollback_started',
  'execution.rollback_completed',
  'execution.rollback_failed',
  'execution.publisher_failed',
  'execution.safety_violation',
] as const;

/** Immutable entry in the observability event log. */
export interface StoredEvent {
  /** Stable, deterministic event id. */
  id: string;
  /** Event type, e.g. `execution.completed`. */
  type: ObservabilityEvent['type'];
  /** Store the event relates to, when known. */
  storeId?: string;
  /** When the event was recorded. */
  occurredAt: string;
  /** The full, typed event payload. */
  event: ObservabilityEvent;
}
