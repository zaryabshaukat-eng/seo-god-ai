/**
 * Where a decision request originates. Extracted so both the input and
 * decision type modules can reference it without a circular import.
 */

export type DecisionSource = 'manual' | 'scheduled' | 'crawl.completed' | 'report.generated';
