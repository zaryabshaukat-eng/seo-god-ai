export { ObservabilityService, mapEngineStatus } from './service/observability-service.js';
export type { RecordResult } from './service/observability-service.js';

export { MetricsService, percentile } from './service/metrics-service.js';
export { AlertService } from './service/alert-service.js';
export { TimelineService } from './service/timeline-service.js';
export type {
  PerformanceTimelineOptions,
  TimelineOptions,
} from './service/timeline-service.js';
export { DashboardService } from './service/dashboard-service.js';
export {
  LearningSignalService,
  toHistoricalOutcome,
} from './service/learning-signal-service.js';
export type { LearningSignalOptions } from './service/learning-signal-service.js';

export {
  InMemoryObservabilityStore,
} from './store/in-memory-observability-store.js';
export type {
  ObservabilityFilter,
  ObservabilityStore,
} from './store/observability-store.js';

export { ExecutionSinkAdapter } from './consumers/execution-sink-adapter.js';
export {
  EventBusConsumer,
  DEFAULT_CONSUMED_TYPES,
} from './consumers/event-bus-consumer.js';
export type { EventBusConsumerOptions } from './consumers/event-bus-consumer.js';

export { DEFAULT_ALERT_OPTIONS } from './types/options.js';
export type {
  AlertEngineOptions,
  ObservabilityServiceOptions,
} from './types/options.js';

export {
  EXECUTION_EVENT_TYPES,
} from './types/events.js';
export type {
  CrawlCompletedEvent,
  CrawlFailedEvent,
  ObservabilityEvent,
  SeoAnalysisEvent,
  SeoAnalysisInput,
  StoredEvent,
  ValidationFailedEvent,
} from './types/events.js';

export {
  TERMINAL_STATUSES,
} from './types/models.js';
export type {
  AlertRecord,
  AlertSeverity,
  AlertType,
  ChangeRecord,
  ExecutionRecord,
  ExecutionStatus,
  ObservabilityHistory,
  PerformanceTimeline,
  SeoSnapshot,
  SeoTimeline,
  StoredEventLike,
  TimelinePoint,
  TimelinePointType,
} from './types/models.js';

export type {
  ExecutionMetricsSummary,
  HistoricalOutcome,
  LearningSignal,
  ObservabilityOverview,
} from './types/signals.js';
