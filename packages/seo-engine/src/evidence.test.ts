import { describe, expect, it } from 'vitest';
import { evidenceFromIssue, evidenceItem, pickEvidenceValue } from './evidence.js';
import type { SeoIssue } from '@seogod/crawler';

describe('evidence', () => {
  it('builds an evidence item from a value', () => {
    expect(evidenceItem('https://a.com', 'wordCount', 12)).toEqual({
      url: 'https://a.com',
      field: 'wordCount',
      value: 12,
    });
  });

  it('attaches a snippet when provided', () => {
    expect(evidenceItem('https://a.com', 'title', 'Hello', 'Hello world')).toEqual({
      url: 'https://a.com',
      field: 'title',
      value: 'Hello',
      snippet: 'Hello world',
    });
  });

  it('picks the first finite numeric detail value', () => {
    expect(pickEvidenceValue({ length: 12 }, 'fallback')).toBe(12);
    expect(pickEvidenceValue({ wordCount: 42 }, 'fallback')).toBe(42);
    expect(pickEvidenceValue({ statusCode: 404 }, 'fallback')).toBe(404);
    expect(pickEvidenceValue({ count: 7 }, 'fallback')).toBe(7);
    expect(pickEvidenceValue({ length: 'nope' }, 'fallback')).toBe('fallback');
  });

  it('falls back to the evidence string, then null', () => {
    expect(pickEvidenceValue({ other: 1 }, 'snippet text')).toBe('snippet text');
    expect(pickEvidenceValue({}, '')).toBeNull();
  });

  it('derives an evidence item keyed by the issue rule', () => {
    const issue: SeoIssue = {
      rule: 'title-too-long',
      severity: 'MEDIUM',
      message: 'Too long',
      details: { length: 95, value: 'very long title text here' },
      evidence: 'title too long',
    };
    expect(evidenceFromIssue('https://a.com', issue)).toEqual({
      url: 'https://a.com',
      field: 'title-too-long',
      value: 95,
      snippet: 'title too long',
    });
  });

  it('omits the snippet when evidence is empty', () => {
    const issue: SeoIssue = {
      rule: 'missing-title',
      severity: 'HIGH',
      message: 'Missing title',
      details: {},
      evidence: '',
    };
    expect(evidenceFromIssue('https://a.com', issue)).toEqual({
      url: 'https://a.com',
      field: 'missing-title',
      value: null,
      snippet: undefined,
    });
  });
});
