import { describe, expect, it } from 'vitest';
import { analyzeIssues } from './issue.js';
import { resolveConfig } from '../config.js';
import { engineInput, issue, page } from '../test/fixtures.js';

describe('analyzeIssues', () => {
  it('groups occurrences by rule into one candidate per rule', () => {
    const input = engineInput({
      pages: [
        page({ url: 'https://a.com', issues: [issue()] }),
        page({ url: 'https://b.com', issues: [issue({ severity: 'CRITICAL' })] }),
        page({ url: 'https://c.com', issues: [issue({ rule: 'missing-h1' })] }),
      ],
    });
    const candidates = analyzeIssues(input, resolveConfig());
    expect(candidates).toHaveLength(2);
    const titles = candidates.find((c) => c.rule === 'missing-title');
    expect(titles).toBeDefined();
    expect(titles!.affectedUrls).toEqual(['https://a.com', 'https://b.com']);
    expect(titles!.pageCount).toBe(2);
    expect(titles!.occurrenceCount).toBe(2);
    expect(titles!.title).toBe('Add a unique page title (2 pages)');
  });

  it('skips rules disabled in config and applies overrides', () => {
    const config = resolveConfig({
      rules: { 'missing-h1': { enabled: false }, 'missing-title': { impact: 'LOW', effort: 'LOW' } },
    });
    const input = engineInput({
      pages: [
        page({ issues: [issue({ severity: 'LOW' })] }),
        page({ issues: [issue({ rule: 'missing-h1' })] }),
      ],
    });
    const candidates = analyzeIssues(input, config);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.rule).toBe('missing-title');
    expect(candidates[0]!.impact).toBe('LOW');
    expect(candidates[0]!.effort).toBe('LOW');
  });

  it('dedupes repeated URLs within a rule', () => {
    const input = engineInput({
      pages: [
        page({ url: 'https://a.com', issues: [issue(), issue({ severity: 'MEDIUM' })] }),
      ],
    });
    const [candidate] = analyzeIssues(input, resolveConfig());
    expect(candidate!.affectedUrls).toEqual(['https://a.com']);
    expect(candidate!.pageCount).toBe(1);
    expect(candidate!.occurrenceCount).toBe(2);
  });

  it('boosts impact for money pages when the rule cares about them', () => {
    const config = resolveConfig({ rules: { 'missing-title': { impact: 'MEDIUM' } } });
    const input = engineInput({
      pages: [page({ type: 'product', issues: [issue()] })],
    });
    const [candidate] = analyzeIssues(input, config);
    expect(candidate!.moneyPageAffected).toBe(true);
    expect(candidate!.impact).toBe('HIGH');
  });

  it('does not boost money-page rules for non-money pages', () => {
    const input = engineInput({
      pages: [page({ type: 'blog', issues: [issue()] })],
    });
    const [candidate] = analyzeIssues(input, resolveConfig());
    expect(candidate!.moneyPageAffected).toBe(false);
    expect(candidate!.impact).toBe('HIGH');
  });

  it('does not boost rules that do not target money pages', () => {
    const input = engineInput({
      pages: [page({ type: 'product', issues: [issue({ rule: 'missing-canonical', severity: 'LOW' })] })],
    });
    const [candidate] = analyzeIssues(input, resolveConfig());
    expect(candidate!.impact).toBe('MEDIUM');
  });

  it('uses observed severity to raise impact', () => {
    const input = engineInput({
      pages: [page({ issues: [issue({ rule: 'missing-canonical', severity: 'CRITICAL' })] })],
    });
    const [candidate] = analyzeIssues(input, resolveConfig());
    expect(candidate!.impact).toBe('HIGH');
  });

  it('lowers confidence when evidence values are missing', () => {
    const input = engineInput({
      pages: [page({ issues: [issue({ details: {}, evidence: '' })] })],
    });
    const [candidate] = analyzeIssues(input, resolveConfig());
    expect(candidate!.confidence).toBeCloseTo(0.55);
  });

  it('writes worst severity and impact into the rationale', () => {
    const input = engineInput({
      pages: [
        page({ issues: [issue({ severity: 'LOW' })] }),
        page({ issues: [issue({ severity: 'CRITICAL' })] }),
      ],
    });
    const [candidate] = analyzeIssues(input, resolveConfig());
    expect(candidate!.rationale).toContain('observed severity CRITICAL');
    expect(candidate!.rationale).toContain('impact HIGH');
  });

  it('ignores pages without extractions', () => {
    const input = engineInput({
      pages: [page({ extraction: null, issues: [issue()] })],
    });
    const candidates = analyzeIssues(input, resolveConfig());
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.affectedUrls).toEqual(['https://example.com/']);
  });
});
