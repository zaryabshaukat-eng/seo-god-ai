import { AGENT_INPUT_SCHEMA, AGENT_OUTPUT_SCHEMA } from '../base/agent-schemas.js';
import { BaseAgent } from '../base/base-agent.js';
import type { AgentEntityInput, AgentInput } from '../types/input.js';
import type {
  AgentActionType,
  AgentRecommendation,
  AgentResourceType,
  AgentResult,
} from '../types/output.js';
import { wordCount as countWords } from '../utils/text.js';

const THIN_CONTENT_WORDS = 300;
const HOMEPAGE_PATHS = new Set(['/', '/index.html', '/index.htm']);

function bodyOf(entity: AgentEntityInput): string {
  const body = entity.data['body'];
  if (typeof body === 'string' && body.trim().length > 0) return body;
  const content = entity.data['content'];
  if (typeof content === 'string' && content.trim().length > 0) return content;
  return '';
}

function titleOf(entity: AgentEntityInput): string | undefined {
  const title = entity.data['title'];
  return typeof title === 'string' && title.trim().length > 0 ? title : undefined;
}

function isHomepage(entity: AgentEntityInput): boolean {
  const url = entity.data['url'];
  if (typeof url === 'string') {
    const path = url.replace(/^https?:\/\/[^/]+/i, '');
    return HOMEPAGE_PATHS.has(path);
  }
  return HOMEPAGE_PATHS.has(entity.ref);
}

/**
 * Analyzes store pages: broken pages, thin content, titles and the homepage.
 * Never proposes delete or create actions.
 */
export class PageAgent extends BaseAgent {
  readonly id = 'page';
  readonly name = 'Page Agent';
  readonly version = '1.0.0';
  readonly description = 'Analyzes store pages: broken pages, thin content, titles and the homepage.';
  readonly capabilities = ['page-analysis', 'page-health-check'];
  readonly supportedTasks = ['analyze-pages', 'check-homepage'];
  readonly supportedEntities: AgentResourceType[] = ['page'];
  readonly supportedActionTypes: AgentActionType[] = [];
  readonly inputSchema = AGENT_INPUT_SCHEMA;
  readonly outputSchema = AGENT_OUTPUT_SCHEMA;
  readonly promptId = 'page';

  analyze(input: AgentInput): AgentResult {
    const recommendations: AgentRecommendation[] = [];
    const executionHints: string[] = [];
    const pages = this.entitiesOfType(input, 'page');

    for (const page of pages) {
      this.analyzePage(page, recommendations, executionHints);
    }

    const hasHomepage = pages.some((page) => isHomepage(page));
    if (pages.length > 0 && !hasHomepage) {
      this.pushRecommendation(
        recommendations,
        pages[0] as AgentEntityInput,
        'missing-homepage',
        'Missing homepage',
        'No homepage was found; ensure "/" resolves to a live page.',
        '',
      );
      executionHints.push('Create or restore the homepage before running crawl-based flows.');
    }

    return this.result({ input, recommendations, executionHints });
  }

  private analyzePage(
    entity: AgentEntityInput,
    recommendations: AgentRecommendation[],
    executionHints: string[],
  ): void {
    const statusCode = this.numberValue(entity.data, 'statusCode');
    const body = bodyOf(entity);
    const words = this.numberValue(entity.data, 'wordCount') ?? countWords(body);

    if (statusCode !== undefined && statusCode >= 400) {
      this.pushRecommendation(
        recommendations,
        entity,
        'broken-page',
        'Broken page',
        `Page returns HTTP ${statusCode}; restore it or redirect to a live page.`,
        statusCode,
      );
      executionHints.push(`${entity.ref}: restore content or add a 301 redirect.`);
    }

    if (words < THIN_CONTENT_WORDS) {
      this.pushRecommendation(
        recommendations,
        entity,
        'thin-content',
        'Thin page content',
        `Page has only ${words} words; expand it beyond ${THIN_CONTENT_WORDS}.`,
        words,
      );
    }

    if (titleOf(entity) === undefined) {
      this.pushRecommendation(
        recommendations,
        entity,
        'missing-title',
        'Missing page title',
        'The page has no title; add a descriptive headline.',
        '',
      );
    }
  }

  private pushRecommendation(
    recommendations: AgentRecommendation[],
    entity: AgentEntityInput,
    rule: string,
    title: string,
    reason: string,
    value: string | number | boolean | null,
  ): void {
    recommendations.push(
      this.buildRecommendation({
        rule: this.rule(rule),
        title,
        summary: reason,
        reason,
        severity: rule === 'broken-page' ? 'HIGH' : 'MEDIUM',
        confidence: 0.8,
        estimatedImpact: rule === 'broken-page' ? 80 : 45,
        risk: 'LOW',
        implementationDifficulty: 'MEDIUM',
        expectedExecutionTime: '1 hour',
        rollbackPossible: true,
        evidence: [this.evidenceFor(entity, 'current.page', value)],
        affectedUrls: [entity.ref],
      }),
    );
  }
}
