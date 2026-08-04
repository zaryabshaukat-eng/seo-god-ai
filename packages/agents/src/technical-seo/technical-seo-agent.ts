import { AGENT_INPUT_SCHEMA, AGENT_OUTPUT_SCHEMA } from '../base/agent-schemas.js';
import { BaseAgent } from '../base/base-agent.js';
import type { AgentEntityInput, AgentInput } from '../types/input.js';
import type {
  AgentAction,
  AgentActionType,
  AgentRecommendation,
  AgentResourceType,
  AgentResult,
} from '../types/output.js';

function normalizeUrl(value: string): string {
  return value
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '')
    .toLowerCase();
}

function urlOf(entity: AgentEntityInput): string | undefined {
  const url = entity.data['url'];
  return typeof url === 'string' && url.trim().length > 0 ? url : undefined;
}

/**
 * Analyzes canonical URLs, robots directives, redirect chains and broken
 * pages. Only proposes mechanical, reversible technical fixes.
 */
export class TechnicalSeoAgent extends BaseAgent {
  readonly id = 'technical-seo';
  readonly name = 'Technical SEO Agent';
  readonly version = '1.0.0';
  readonly description =
    'Analyzes canonical URLs, robots directives, redirect chains and broken pages.';
  readonly capabilities = ['canonical-analysis', 'robots-analysis', 'redirect-analysis'];
  readonly supportedTasks = ['analyze-canonicals', 'analyze-robots', 'analyze-redirects'];
  readonly supportedEntities: AgentResourceType[] = [
    'product',
    'collection',
    'page',
    'blog',
    'article',
    'store',
  ];
  readonly supportedActionTypes: AgentActionType[] = ['update_canonical', 'update_robots'];
  readonly inputSchema = AGENT_INPUT_SCHEMA;
  readonly outputSchema = AGENT_OUTPUT_SCHEMA;
  readonly promptId = 'technical-seo';

  analyze(input: AgentInput): AgentResult {
    const recommendations: AgentRecommendation[] = [];
    const actions: AgentAction[] = [];

    for (const entity of input.entities) {
      this.analyzeEntity(entity, input.entities, recommendations, actions);
    }

    return this.result({ input, recommendations, actions });
  }

  private analyzeEntity(
    entity: AgentEntityInput,
    all: AgentEntityInput[],
    recommendations: AgentRecommendation[],
    actions: AgentAction[],
  ): void {
    const url = urlOf(entity) ?? entity.ref;
    const canonical = this.stringValue(entity.data, 'canonical');
    const robots = this.stringValue(entity.data, 'robots') ?? '';
    const redirectTo = this.stringValue(entity.data, 'redirectTo');
    const statusCode = this.numberValue(entity.data, 'statusCode');
    const sitemapIncluded = this.booleanValue(entity.data, 'sitemapIncluded') ?? true;

    if (canonical === undefined) {
      this.pushRecommendation(
        recommendations,
        entity,
        'missing-canonical',
        'Missing canonical URL',
        'Add a self-referencing canonical URL so search engines deduplicate the page.',
        canonical ?? '',
      );
      actions.push(this.updateCanonical(entity, url));
    } else if (normalizeUrl(canonical) !== normalizeUrl(url)) {
      this.pushRecommendation(
        recommendations,
        entity,
        'conflicting-canonical',
        'Conflicting canonical URL',
        `Canonical "${canonical}" does not point at the page itself.`,
        canonical,
      );
      actions.push(this.updateCanonical(entity, url));
    }

    if (sitemapIncluded && /\bnoindex\b/.test(robots)) {
      this.pushRecommendation(
        recommendations,
        entity,
        'robots-blocked',
        'Page blocked from indexing',
        'The page is listed in the sitemap but blocked by noindex; decide whether to index it.',
        robots,
      );
      actions.push(this.updateRobots(entity, 'index'));
    }

    if (redirectTo !== undefined && redirectTo.trim().length > 0) {
      const target = all.find(
        (candidate) =>
          normalizeUrl(urlOf(candidate) ?? candidate.ref) === normalizeUrl(redirectTo),
      );
      if (target !== undefined) {
        const targetRedirect = this.stringValue(target.data, 'redirectTo') ?? '';
        if (targetRedirect.trim().length > 0) {
          this.pushRecommendation(
            recommendations,
            entity,
            'redirect-chain',
            'Redirect chain',
            `Redirects to "${redirectTo}" which redirects again; collapse the chain.`,
            redirectTo,
          );
        }
      }
    }

    if (statusCode !== undefined && statusCode >= 400) {
      this.pushRecommendation(
        recommendations,
        entity,
        'broken-page',
        'Broken page',
        `Page returns HTTP ${statusCode}; restore or redirect it.`,
        statusCode,
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
        severity: rule === 'conflicting-canonical' || rule === 'robots-blocked' ? 'HIGH' : 'MEDIUM',
        confidence: 0.85,
        estimatedImpact: rule === 'conflicting-canonical' || rule === 'robots-blocked' ? 70 : 45,
        risk: 'LOW',
        implementationDifficulty: 'LOW',
        expectedExecutionTime: '30 minutes',
        rollbackPossible: true,
        evidence: [this.evidenceFor(entity, 'current.technical', value)],
        affectedUrls: [entity.ref],
      }),
    );
  }

  private updateCanonical(entity: AgentEntityInput, canonical: string): AgentAction {
    return this.buildAction({
      actionType: 'update_canonical',
      resourceType: this.resourceTypeOf(entity),
      resourceId: entity.id,
      resourceRef: entity.ref,
      payload: { canonical },
      rationale: `Set canonical for ${entity.ref}`,
    });
  }

  private updateRobots(entity: AgentEntityInput, directive: string): AgentAction {
    return this.buildAction({
      actionType: 'update_robots',
      resourceType: this.resourceTypeOf(entity),
      resourceId: entity.id,
      resourceRef: entity.ref,
      payload: { directive },
      rationale: `Update robots directive for ${entity.ref}`,
    });
  }

  private resourceTypeOf(entity: AgentEntityInput): AgentResourceType {
    return entity.type === 'store' ? 'store' : (entity.type as AgentResourceType);
  }
}
