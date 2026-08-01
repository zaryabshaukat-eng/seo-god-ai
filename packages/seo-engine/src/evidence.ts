import type { SeoIssue } from '@seogod/crawler';
import type { EvidenceItem } from './types.js';

const NUMERIC_DETAIL_KEYS = [
  'length',
  'count',
  'wordCount',
  'statusCode',
  'ttfbMs',
  'htmlSizeBytes',
  'scriptCount',
] as const;

/**
 * Picks a stable scalar value from an issue's details/evidence: the first
 * numeric detail wins, otherwise the evidence string, otherwise null.
 */
export function pickEvidenceValue(details: Record<string, unknown>, evidence: string): string | number | boolean | null {
  for (const key of NUMERIC_DETAIL_KEYS) {
    const value = details[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  if (evidence !== '') return evidence;
  return null;
}

/** Builds an evidence item from a page URL and a scalar value. */
export function evidenceItem(
  url: string,
  field: string,
  value: string | number | boolean | null,
  snippet?: string,
): EvidenceItem {
  return { url, field, value, snippet };
}

/** Builds the evidence item for one detected issue occurrence. */
export function evidenceFromIssue(pageUrl: string, issue: SeoIssue): EvidenceItem {
  const value = pickEvidenceValue(issue.details, issue.evidence);
  return {
    url: pageUrl,
    field: issue.rule,
    value,
    snippet: issue.evidence !== '' ? issue.evidence : undefined,
  };
}
