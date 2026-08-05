# Learning Engine

`@seogod/learning-engine` turns observed outcomes and human feedback into
measurable improvement for the decision layer. It collects recommendation
feedback, ingests execution outcomes, analyzes per-rule performance, calibrates
model confidence against empirical success, learns a priority score for
recommendations, and emits RL-style signals plus decision-engine-ready
historical outcomes.

The engine is a pure computation package: it never calls models, never writes to
a store, and has no runtime dependency on the decision engine or observability.
`@seogod/decision-engine` and `@seogod/observability` data flow in through
*structural* interfaces (`ExecutionResultLike`, `ExecutionRecordLike`,
`LearningSignalLike`) so callers hand the engine their records directly.
`LearningStore` is the only integration point, and an in-memory implementation
ships for tests and single-process deployments.

## Architecture

```
LearningEngineService
  ├─ recordFeedback()               FeedbackCollector   rating → FeedbackRecord
  ├─ ingestOutcome()                idempotency-checked  → OutcomeRecord
  ├─ analyzeOutcomes()              OutcomeAnalyzer      per-rule RulePerformance
  ├─ calibrate()                    ConfidenceCalibrator confidence → reliability
  ├─ scoreRecommendation()          RecommendationScorer learned 0..100 priority
  ├─ generateSignals()              SignalGenerator      reward/confidence signals
  ├─ getHistoricalOutcomes()        HistoricalOutcomeProcessor → decision-engine input
  ├─ getFeedback()/summarizeFeedback()/getSignals()
  └─ LearningMetrics                learning_* counters and gauges
```

All state lives in a `LearningStore` (feedback, outcomes, signals); the service
and its components are stateless beyond the store and an optional injected
clock and metrics registry.

## Feedback

`recordFeedback()` accepts a `FeedbackInput` (`storeId`, optional `rule`,
`recommendationId`, `executionId`, `rating` in `-1 | 0 | 1`, comment, source) and
persists a `FeedbackRecord`. `summarizeFeedback()` aggregates records into a
`FeedbackSummary` (counts and positive/negative rates per rule), and
`getFeedback()` lists records by filter. Feedback feeds the learned score and
RL signals.

## Outcomes and analysis

`ingestOutcome()` records an `OutcomeInput` (`executionId`, `storeId`, optional
`rule`, `status` in `SUCCESS | FAILURE | SKIPPED | ROLLED_BACK`, stated
`confidence` 0..1, measured `impact`, `durationMs`). Outcomes are immutable per
execution: a second outcome for the same `executionId` raises
`LearningConflictError`.

`analyzeOutcomes()` groups outcomes by rule into `RulePerformance` (attempts,
successes, failures, skipped, rolled back, success/rollback rates, average
impact, average duration, last executed) plus an overall `AnalysisSummary`.

## Calibration

`ConfidenceCalibrator.calibrate(rule, confidence, options)` maps a model's
stated confidence (0..1) to a calibrated confidence using the observed success
rate for that rule. It buckets labeled outcomes, computes `empiricalReliability`
overall and per bucket, and returns a `CalibrationReport` with the calibrated
value. The sample-size `minSample` option controls how many labeled outcomes are
required before calibration overrides the stated confidence.

## Learned scoring

`RecommendationScorer.score()` computes a 0..100 priority for a recommendation
from `rule`, stated `confidence`, estimated `impact`, `effort` (as ease) and
`pageCount`/`maxReachPages`. The score blends six factors — impact, calibrated
confidence, historical effectiveness, reach, effort and feedback — weighted by
`DEFAULT_SCORER_WEIGHTS` (overridable via `ScorerWeights`) and returned with a
`ScoreBreakdown` so every score is explainable.

## Signals

`generateSignals()` derives RL-style `LearnedSignal`s from outcomes and feedback:
each rule yields a positive/negative/neutral signal with a `reward` in -1..1, a
`confidence` 0..1 based on sample size, a `source` (`outcome` | `feedback`) and a
timestamp. Generated signals are persisted, so `getSignals()` replays the
learning history. `SignalGenerator` alone (without the store) is exported for
purely in-memory use.

## Historical outcomes

`getHistoricalOutcomes(filter, existing?)` projects per-rule
`HistoricalOutcomeResult` (`rule`, `attempts`, `successes`, `averageImpact`)
ready to be fed into a `DecisionContext`. The `HistoricalOutcomeProcessor`
merges the projected results into a caller-supplied `existing` list (default
empty), keeping the highest `attempts` per rule.

## Integration adapters

Three stateless adapters map other packages' records onto learning-engine
inputs:

| Adapter                    | Source                                | Output                     |
| -------------------------- | ------------------------------------- | -------------------------- |
| `fromExecutionResult`      | decision-engine `ExecutionResult`     | `OutcomeInput`             |
| `fromExecutionRecord`      | observability `ExecutionRecord`       | `OutcomeInput` or `null` for non-terminal statuses |
| `fromObservabilitySignal`  | observability `LearningSignal`        | `HistoricalOutcomeResult`  |

Because the adapters consume structural types, `@seogod/decision-engine` and
`@seogod/observability` are development-only dependencies used in the adapter
tests; production code imports neither.

## Usage

```ts
import { LearningEngineService, InMemoryLearningStore } from '@seogod/learning-engine';
import { fromExecutionResult } from '@seogod/learning-engine';
import { createMetricsRegistry } from '@seogod/monitoring';

const service = new LearningEngineService({
  store: new InMemoryLearningStore(),
  metrics: createMetricsRegistry(),
});

await service.recordFeedback({ storeId: 'store-1', rule: 'missing-title', rating: 1 });

await service.ingestOutcome({
  executionId: 'run-1',
  storeId: 'store-1',
  rule: 'missing-title',
  status: 'SUCCESS',
  confidence: 0.8,
  impact: 4.2,
});

const analysis = await service.analyzeOutcomes({ rule: 'missing-title' });

const calibration = await service.calibrate('missing-title', 0.8);
const score = await service.scoreRecommendation({
  rule: 'missing-title',
  confidence: 0.8,
  impact: 0.6,
  effort: 0.9,
  pageCount: 24,
});

const { signals } = await service.generateSignals();
const history = await service.getHistoricalOutcomes();
```

To feed decision-engine results straight in:

```ts
import { fromExecutionResult } from '@seogod/learning-engine';

await service.ingestOutcome(fromExecutionResult(executionResult)); // ExecutionResult
```

## Errors

All failures map to the `@seogod/core` hierarchy: `FeedbackValidationError`
(`feedback.invalid`), `OutcomeValidationError` (`outcome.invalid`),
`ConfidenceValidationError` (`confidence.invalid`), `ScoreValidationError`
(`score.invalid`), `LearningConflictError` (`learning.conflict`, duplicate
outcome), `LearningNotFoundError` (`learning.not_found`) and
`LearningValidationError` (`validation.error`).

## Metrics

`LearningMetrics` wraps a `MetricsRegistry` and records, when one is provided:

- `learning_feedback_recorded` (counter) — feedback persisted
- `learning_outcomes_ingested` (counter) — outcomes recorded
- `learning_signals_generated` (gauge) — signals produced per generation
- `learning_calibrations` (counter) — calibration requests
- `learning_scoring` (counter) — recommendation scores computed
- `learning_analyses` (counter) — outcome analyses run

## Testing

```bash
npm run test --workspace @seogod/learning-engine
npm run test:coverage --workspace @seogod/learning-engine
```

The suite covers feedback collection/summaries, outcome ingestion (including
conflict and validation), per-rule analysis, calibration buckets and sample-size
behavior, learned scoring breakdowns, signal generation, historical outcome
projection and merging, the store, metrics, errors, utils, and the service
facade. Adapter tests exercise the structural types against the real
`@seogod/decision-engine` and `@seogod/observability` packages. Coverage
thresholds (95%) are enforced for lines, branches, functions, and statements;
the package currently reports 100% on all metrics.
