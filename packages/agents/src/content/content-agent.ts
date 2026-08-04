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

function bodyOf(entity: AgentEntityInput): string {
  const body = entity.data['body'];
  if (typeof body === 'string' && body.trim().length > 0) return body;
  const content = entity.data['content'];
  if (typeof content === 'string' && content.trim().length > 0) return content;
  return '';
}

function fingerprint(body: string): string {
  return body.replace(/\s+/g, ' ').trim().slice(0, 40);
}

function h1Count(entity: AgentEntityInput): number {
  const headings = entity.data['headings'];
  if (!Array.isArray(headings)) return 0;
  let count = 0;
  for (const heading of headings) {
    if (typeof heading === 'string') continue;
    if (typeof heading === 'object' && heading !== null && (heading as { tag?: unknown }).tag === 'h1') {
      count += 1;
    }
  }
  return count;
}

/**
 * Analyzes body content volume, headings and duplication. Never fabricates
 * copy: content rewrites are recommendations with executionHints, never
 * actions.
 */
export class ContentAgent extends BaseAgent {
  readonly id = 'content';
  readonly name = 'Content Agent';
  readonly version = '1.0.0';
  readonly description = 'Analyzes body content volume, headings and duplication across entities.';
  readonly capabilities = ['content-analysis', 'heading-analysis', 'duplicate-detection'];
  readonly supportedTasks = ['analyze-content', 'analyze-headings', 'detect-duplicates'];
  readonly supportedEntities: AgentResourceType[] = [
    'product',
    'collection',
    'page',
    'blog',
    'article',
  ];
  readonly supportedActionTypes: AgentActionType[] = [];
  readonly inputSchema = AGENT_INPUT_SCHEMA;
  readonly outputSchema = AGENT_OUTPUT_SCHEMA;
  readonly promptId = 'content';

  analyze(input: AgentInput): AgentResult {
    const recommendations: AgentRecommendation[] = [];
    const seenFingerprints = new Map<string, string>();

    for (const entity of input.entities) {
      this.analyzeEntity(entity, recommendations, seenFingerprints);
    }

    return this.result({ input, recommendations });
  }

  private analyzeEntity(
    entity: AgentEntityInput,
    recommendations: AgentRecommendation[],
    seenFingerprints: Map<string, string>,
  ): void {
    const body = bodyOf(entity);
    const words = this.numberValue(entity.data, 'wordCount') ?? countWords(body);

    if (words < THIN_CONTENT_WORDS) {
      this.pushRecommendation(
        recommendations,
        entity,
        'thin-content',
        'Thin content',
        `Content is only ${words} words; expand it to at least ${THIN_CONTENT_WORDS} with unique copy.`,
        words,
      );
    }

    const h1s = h1Count(entity);
    if (h1s === 0 && body.length > 0) {
      this.pushRecommendation(
        recommendations,
        entity,
        'missing-h1',
        'Missing H1 heading',
        'Add a single H1 heading describing the page topic.',
        h1s,
      );
    } else if (h1s > 1) {
      this.pushRecommendation(
        recommendations,
        entity,
        'multiple-h1',
        'Multiple H1 headings',
        `Page has ${h1s} H1 headings; keep exactly one.`,
        h1s,
      );
    }

    if (body.trim().length > 0) {
      const fp = fingerprint(body);
      const owner = seenFingerprints.get(fp);
      if (owner === undefined) {
        seenFingerprints.set(fp, entity.ref);
      } else {
        this.pushRecommendation(
          recommendations,
          entity,
          'duplicate-content',
          'Duplicate content',
          `Body copy matches ${owner}; rewrite one of the pages.`,
          fp,
        );
      }
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
        severity: rule === 'thin-content' || rule === 'duplicate-content' ? 'MEDIUM' : 'LOW',
        confidence: 0.75,
        estimatedImpact: rule === 'duplicate-content' ? 60 : 45,
        risk: 'LOW',
        implementationDifficulty: 'MEDIUM',
        expectedExecutionTime: '2 hours',
        rollbackPossible: true,
        evidence: [this.evidenceFor(entity, 'current.content', value)],
        affectedUrls: [entity.ref],
      }),
    );
  }
}
