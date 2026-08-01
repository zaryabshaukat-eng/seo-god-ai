# SEO Engine

`@seogod/seo-engine` transforms crawler output into explainable, prioritized,
evidence-backed recommendations. It is fully deterministic — no LLM anywhere in
the pipeline — so the same crawl always produces the same report. That makes it
the single source of truth for the AI agents, dashboard, and reports that act
on recommendations later.

## Architecture

```
EngineInput (crawler snapshots + issues)
  └─ SeoEngine.analyze()
       ├─ analyzeIssues            group detected issues by rule
       ├─ analyzePerformance       TTFB / HTML size / script-count signals
       ├─ analyzeStructuredData    missing or invalid schema on money pages
       ├─ mergeByRule              dedupe candidates sharing a rule
       ├─ computeScore             weighted impact · confidence · effort
       ├─ priorityFromScore        CRITICAL ≥ 80, HIGH ≥ 60, MEDIUM ≥ 40
       └─ applyCategoryCap         maxRecommendationsPerCategory
  → EngineReport (sorted Recommendation[])
```

Every `Recommendation` carries:

- a deterministic `id` (SHA-256 of the rule + sorted affected URLs),
- a composite `score` (0..100) and derived `priority`,
- `impact` / `effort` / `confidence` ratings,
- `evidence` items (`{ url, field, value }`) backing the claim,
- a human `rationale` explaining exactly why the rule fired,
- a normalized `aiContext` for agents to act on.

## Usage

```ts
import { SeoEngine } from '@seogod/seo-engine';

const engine = new SeoEngine({
  // optional: rules: { 'missing-title': { enabled: false } },
  //           thresholds: { slowTtfbMs: 1000 },
  //           maxRecommendationsPerCategory: 5,
});

const report = engine.analyze(input); // EngineInput from a completed crawl
for (const rec of report.recommendations) {
  console.log(rec.priority, rec.rule, rec.affectedUrls.length);
}
console.log(report.summary.byPriority); // { CRITICAL, HIGH, MEDIUM, LOW }
```

`EngineInput` mirrors what the crawler produces: each page has its URL, type,
depth, `extraction` (the full `PageExtraction` snapshot), and `issues` (the
detected `SeoIssue`s). The engine never re-crawls or re-extracts.

## Rules

The rule registry in `src/rules.ts` is the single source of truth. Each rule
declares its category, baseline impact/effort, whether it is backed by a
measured value (`objective`), and whether it matters most on money pages
(product / collection / homepage). There are 23 rules covering content,
links, performance, structured data, indexing, and internationalization.

Issue-severity observations can raise a rule's impact above its baseline, and
money-page hits bump it one more level so high-value fixes surface first.

## Scoring

```
score = impactWeight·IMPACT_SCORE
      + confidenceWeight·confidence·100
      + effortWeight·EFFORT_SCORE
```

Defaults: `impactWeight 0.5`, `confidenceWeight 0.3`, `effortWeight 0.2`.

Confidence is deterministic: `0.85` for objective rules, `0.7` for heuristics,
`+0.1` when at least three pages are affected, `−0.15` when evidence values are
missing — clamped to `0.5..0.95`.

Sorting is stable and total: priority → score (desc) → rule → first URL.

## Configuration

| Option                        | Default | Meaning                                   |
| ----------------------------- | ------- | ----------------------------------------- |
| `rules.<rule>.enabled`        | `true`  | Disable a rule entirely                   |
| `rules.<rule>.impact/effort`  | —       | Override a rule's baseline rating         |
| `thresholds.slowTtfbMs`       | `1500`  | TTFB above which a page is slow           |
| `thresholds.largeHtmlBytes`   | `512000`| HTML payload above which a page is heavy  |
| `thresholds.maxScripts`       | `30`    | Scripts above which a page is script-heavy|
| `thresholds.thinContentWords` | `50`    | Minimum words before content is not thin  |
| `thresholds.missingStructuredDataMinPages` | `3` | Minimum money pages before recommending schema |
| `maxRecommendationsPerCategory` | `null` | Cap emitted recommendations per category |
| `clock`                       | `Date`  | Injectable clock for deterministic reports|

## Testing

```bash
npm run test --workspace @seogod/seo-engine
npm run test:coverage --workspace @seogod/seo-engine
```

The engine is pure logic (no I/O), so tests need no database or network.
Coverage thresholds (95%) are enforced for lines, branches, functions, and
statements; the suite currently holds 100% across all metrics.
