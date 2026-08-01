import type { PageExtraction, PageImageData, SeoIssue } from './types.js';

export const TITLE_MAX_LENGTH = 60;
export const TITLE_MIN_LENGTH = 30;
export const DESCRIPTION_MAX_LENGTH = 160;
export const DESCRIPTION_MIN_LENGTH = 50;
export const THIN_CONTENT_WORD_MIN = 50;

export interface PageLinkStatus {
  /** URL of the page containing the link. */
  from: string;
  /** Normalized link target. */
  href: string;
  /** HTTP status observed for the target, or null if never resolved. */
  statusCode: number | null;
}

export interface CrossPageContext {
  pages: Array<{ url: string; title: string | null; metaDescription: string | null }>;
  linkStatuses: PageLinkStatus[];
}

interface IssueSpec {
  rule: string;
  severity: SeoIssue['severity'];
  message: string;
  details?: Record<string, unknown>;
  evidence: string;
}

function issue(spec: IssueSpec): SeoIssue {
  return {
    rule: spec.rule,
    severity: spec.severity,
    message: spec.message,
    details: spec.details ?? {},
    evidence: spec.evidence,
  };
}

/**
 * Runs the per-page SEO detectors against a page's extraction. A robots-
 * blocked page short-circuits to a single robots-blocked issue: there is no
 * content to analyze.
 */
export function detectPageIssues(extraction: PageExtraction): SeoIssue[] {
  if (extraction.robotsBlocked) {
    return [
      issue({
        rule: 'robots-blocked',
        severity: 'HIGH',
        message: 'Page is blocked by robots.txt and cannot be crawled.',
        evidence: extraction.url,
      }),
    ];
  }

  const issues: SeoIssue[] = [];
  const { title, metaDescription, h1, lang, canonicalUrl, finalUrl } = extraction;

  if (title === null) {
    issues.push(
      issue({
        rule: 'missing-title',
        severity: 'HIGH',
        message: 'Page has no <title> element.',
        evidence: extraction.url,
      }),
    );
  } else {
    if (title.length > TITLE_MAX_LENGTH) {
      issues.push(
        issue({
          rule: 'title-too-long',
          severity: 'MEDIUM',
          message: `Title is ${title.length} characters; keep it under ${TITLE_MAX_LENGTH}.`,
          details: { length: title.length },
          evidence: title,
        }),
      );
    }
    if (title.length < TITLE_MIN_LENGTH) {
      issues.push(
        issue({
          rule: 'title-too-short',
          severity: 'LOW',
          message: `Title is only ${title.length} characters; aim for ${TITLE_MIN_LENGTH}+.`,
          details: { length: title.length },
          evidence: title,
        }),
      );
    }
  }

  if (metaDescription === null) {
    issues.push(
      issue({
        rule: 'missing-meta-description',
        severity: 'MEDIUM',
        message: 'Page has no meta description.',
        evidence: extraction.url,
      }),
    );
  } else {
    if (metaDescription.length > DESCRIPTION_MAX_LENGTH) {
      issues.push(
        issue({
          rule: 'meta-description-too-long',
          severity: 'MEDIUM',
          message: `Meta description is ${metaDescription.length} characters; keep it under ${DESCRIPTION_MAX_LENGTH}.`,
          details: { length: metaDescription.length },
          evidence: metaDescription,
        }),
      );
    }
    if (metaDescription.length < DESCRIPTION_MIN_LENGTH) {
      issues.push(
        issue({
          rule: 'meta-description-too-short',
          severity: 'LOW',
          message: `Meta description is only ${metaDescription.length} characters; aim for ${DESCRIPTION_MIN_LENGTH}+.`,
          details: { length: metaDescription.length },
          evidence: metaDescription,
        }),
      );
    }
  }

  if (h1.length === 0) {
    issues.push(
      issue({
        rule: 'missing-h1',
        severity: 'MEDIUM',
        message: 'Page has no H1 heading.',
        evidence: extraction.url,
      }),
    );
  } else if (h1.length > 1) {
    issues.push(
      issue({
        rule: 'multiple-h1',
        severity: 'LOW',
        message: `Page has ${h1.length} H1 headings; use exactly one.`,
        details: { count: h1.length },
        evidence: h1.join(' | '),
      }),
    );
  }

  if (canonicalUrl === null) {
    issues.push(
      issue({
        rule: 'missing-canonical',
        severity: 'MEDIUM',
        message: 'Page has no canonical URL.',
        evidence: extraction.url,
      }),
    );
  } else {
    const canonical = resolveCanonical(canonicalUrl, finalUrl);
    if (canonical !== null && canonical !== finalUrl) {
      issues.push(
        issue({
          rule: 'conflicting-canonical',
          severity: 'HIGH',
          message: `Canonical "${canonical}" does not match the page URL.`,
          details: { canonical },
          evidence: canonicalUrl,
        }),
      );
    }
  }

  if (lang === null) {
    issues.push(
      issue({
        rule: 'missing-lang',
        severity: 'LOW',
        message: 'Page has no language attribute on <html>.',
        evidence: extraction.url,
      }),
    );
  }

  const missingAlt = extraction.images.filter((image) => image.alt === null);
  if (missingAlt.length > 0) {
    issues.push(
      issue({
        rule: 'missing-alt-text',
        severity: 'LOW',
        message: `${missingAlt.length} image(s) are missing alt text.`,
        details: { count: missingAlt.length, images: missingAlt.map((image) => image.src) },
        evidence: (missingAlt[0] as PageImageData).src,
      }),
    );
  }

  if (extraction.wordCount < THIN_CONTENT_WORD_MIN) {
    issues.push(
      issue({
        rule: 'thin-content',
        severity: 'LOW',
        message: `Page has only ${extraction.wordCount} words of visible content.`,
        details: { wordCount: extraction.wordCount },
        evidence: extraction.url,
      }),
    );
  }

  if (extraction.redirectChain.length > 1) {
    issues.push(
      issue({
        rule: 'redirect-chain',
        severity: 'MEDIUM',
        message: `Page resolves through ${extraction.redirectChain.length} redirects; aim for direct URLs.`,
        details: { chain: extraction.redirectChain },
        evidence: extraction.redirectChain.join(' -> '),
      }),
    );
  }

  return issues;
}

/**
 * Runs the cross-page detectors once the whole crawl has finished:
 * duplicate titles/descriptions and broken links.
 */
export function detectCrossPageIssues(context: CrossPageContext): SeoIssue[] {
  const issues: SeoIssue[] = [];

  const titles = new Map<string, Array<{ url: string }>>();
  const descriptions = new Map<string, Array<{ url: string }>>();
  for (const page of context.pages) {
    if (page.title !== null && page.title !== '') {
      const key = page.title.toLowerCase();
      const list = titles.get(key) ?? [];
      list.push({ url: page.url });
      titles.set(key, list);
    }
    if (page.metaDescription !== null && page.metaDescription !== '') {
      const key = page.metaDescription.toLowerCase();
      const list = descriptions.get(key) ?? [];
      list.push({ url: page.url });
      descriptions.set(key, list);
    }
  }

  for (const [title, pages] of titles) {
    if (pages.length > 1) {
      for (const page of pages.slice(1)) {
        issues.push(
          issue({
            rule: 'duplicate-title',
            severity: 'HIGH',
            message: `Title is shared by ${pages.length} pages; use unique titles.`,
            details: { affectedUrl: page.url, duplicates: pages.map((p) => p.url) },
            evidence: title,
          }),
        );
      }
    }
  }

  for (const [description, pages] of descriptions) {
    if (pages.length > 1) {
      for (const page of pages.slice(1)) {
        issues.push(
          issue({
            rule: 'duplicate-meta-description',
            severity: 'LOW',
            message: `Meta description is shared by ${pages.length} pages; use unique descriptions.`,
            details: { affectedUrl: page.url, duplicates: pages.map((p) => p.url) },
            evidence: description,
          }),
        );
      }
    }
  }

  for (const link of context.linkStatuses) {
    if (link.statusCode !== null && link.statusCode >= 400) {
      issues.push(
        issue({
          rule: 'broken-link',
          severity: 'HIGH',
          message: `Link resolves to HTTP ${link.statusCode}.`,
          details: { from: link.from, to: link.href, statusCode: link.statusCode },
          evidence: link.href,
        }),
      );
    }
  }

  return issues;
}

function resolveCanonical(canonical: string, finalUrl: string): string | null {
  try {
    const url = new URL(canonical, finalUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
}
