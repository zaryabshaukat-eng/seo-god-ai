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

function extractHrefs(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const hrefs: string[] = [];
  for (const item of value) {
    if (typeof item === 'string') {
      hrefs.push(item);
    } else if (typeof item === 'object' && item !== null) {
      const record = item as Record<string, unknown>;
      const href = typeof record['href'] === 'string' ? record['href'] : undefined;
      if (href !== undefined) hrefs.push(href);
      const url = typeof record['url'] === 'string' ? record['url'] : undefined;
      if (url !== undefined) hrefs.push(url);
    }
  }
  return hrefs;
}

function titleOf(entity: AgentEntityInput): string {
  const title = entity.data['title'];
  return typeof title === 'string' && title.trim().length > 0 ? title : entity.ref;
}

/**
 * Analyzes the internal linking state: broken links, orphan pages and pages
 * with weak inbound link profiles.
 */
export class InternalLinkingAgent extends BaseAgent {
  readonly id = 'internal-linking';
  readonly name = 'Internal Linking Agent';
  readonly version = '1.0.0';
  readonly description = 'Analyzes inbound/outbound links, broken links and orphan pages.';
  readonly capabilities = ['link-analysis', 'orphan-detection', 'broken-link-detection'];
  readonly supportedTasks = ['analyze-internal-links', 'detect-orphans'];
  readonly supportedEntities: AgentResourceType[] = ['product', 'collection', 'page', 'blog', 'article'];
  readonly supportedActionTypes: AgentActionType[] = ['add_internal_links', 'fix_internal_links'];
  readonly inputSchema = AGENT_INPUT_SCHEMA;
  readonly outputSchema = AGENT_OUTPUT_SCHEMA;
  readonly promptId = 'internal-linking';

  analyze(input: AgentInput): AgentResult {
    const recommendations: AgentRecommendation[] = [];
    const actions: AgentAction[] = [];
    const executionHints: string[] = [];

    for (const entity of input.entities) {
      this.analyzeEntity(entity, recommendations, actions, executionHints);
    }

    return this.result({ input, recommendations, actions, executionHints });
  }

  private analyzeEntity(
    entity: AgentEntityInput,
    recommendations: AgentRecommendation[],
    actions: AgentAction[],
    executionHints: string[],
  ): void {
    const brokenLinks = extractHrefs(entity.data['brokenLinks']);
    const inLinks = extractHrefs(entity.data['inLinks']);
    const outLinks = extractHrefs(entity.data['outLinks']);
    const orphan = this.booleanValue(entity.data, 'orphan') ?? false;

    if (brokenLinks.length > 0) {
      this.pushRecommendation(
        recommendations,
        entity,
        'broken-link',
        'Broken internal links',
        `Page contains ${brokenLinks.length} broken internal link(s).`,
        brokenLinks.length,
      );
      executionHints.push(`${entity.ref}: fix or remove ${brokenLinks.slice(0, 3).join(', ')}.`);
    }

    if (orphan) {
      this.pushRecommendation(
        recommendations,
        entity,
        'orphan-page',
        'Orphan page',
        'The page is not linked to from any other page; add links from the site hub.',
        orphan,
      );
      actions.push(this.linkFromHub(entity));
    } else if (inLinks.length === 0) {
      this.pushRecommendation(
        recommendations,
        entity,
        'no-inbound-links',
        'No inbound links',
        'The page has no inbound internal links.',
        inLinks.length,
      );
    } else if (inLinks.length < 2) {
      this.pushRecommendation(
        recommendations,
        entity,
        'insufficient-inbound-links',
        'Few inbound links',
        `The page has only ${inLinks.length} inbound internal link(s).`,
        inLinks.length,
      );
    }

    if (outLinks.length === 0 && inLinks.length > 0) {
      this.pushRecommendation(
        recommendations,
        entity,
        'no-outbound-links',
        'No outbound links',
        'The page does not link to any other page.',
        outLinks.length,
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
        severity: rule === 'broken-link' ? 'HIGH' : 'LOW',
        confidence: 0.8,
        estimatedImpact: rule === 'broken-link' ? 65 : 30,
        risk: 'LOW',
        implementationDifficulty: rule === 'broken-link' ? 'MEDIUM' : 'LOW',
        expectedExecutionTime: rule === 'broken-link' ? '1 hour' : '30 minutes',
        rollbackPossible: true,
        evidence: [this.evidenceFor(entity, 'current.links', value)],
        affectedUrls: [entity.ref],
      }),
    );
  }

  private linkFromHub(entity: AgentEntityInput): AgentAction {
    return this.buildAction({
      actionType: 'add_internal_links',
      resourceType: this.resourceTypeOf(entity),
      resourceId: entity.id,
      resourceRef: entity.ref,
      payload: { links: [{ href: entity.ref, anchor: titleOf(entity) }] },
      rationale: `Link orphan page ${entity.ref} from the site hub`,
    });
  }

  private resourceTypeOf(entity: AgentEntityInput): AgentResourceType {
    return entity.type as AgentResourceType;
  }
}
