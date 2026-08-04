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
import { slugify, truncate } from '../utils/text.js';

const META_TITLE_MAX = 60;

function keywordOf(entity: AgentEntityInput): string | undefined {
  const focus = entity.data['focusKeyword'];
  if (typeof focus === 'string' && focus.trim().length > 0) return focus;
  const primary = entity.data['primaryKeyword'];
  if (typeof primary === 'string' && primary.trim().length > 0) return primary;
  const keywords = entity.data['keywords'];
  if (Array.isArray(keywords) && typeof keywords[0] === 'string' && keywords[0].trim().length > 0) {
    return keywords[0];
  }
  return undefined;
}

function titleTextOf(entity: AgentEntityInput): string {
  const metaTitle = entity.data['metaTitle'];
  if (typeof metaTitle === 'string' && metaTitle.trim().length > 0) return metaTitle;
  const title = entity.data['title'];
  if (typeof title === 'string' && title.trim().length > 0) return title;
  return '';
}

function bodyTextOf(entity: AgentEntityInput): string {
  const body = entity.data['body'];
  if (typeof body === 'string' && body.trim().length > 0) return body;
  const content = entity.data['content'];
  if (typeof content === 'string' && content.trim().length > 0) return content;
  return '';
}

function urlTextOf(entity: AgentEntityInput): string {
  const url = entity.data['url'];
  if (typeof url === 'string' && url.trim().length > 0) return url;
  const slug = entity.data['slug'];
  if (typeof slug === 'string' && slug.trim().length > 0) return slug;
  return entity.ref;
}

/** Inserts the keyword at the front of a title, then truncates. */
function injectKeyword(keyword: string, title: string): string {
  const prefix = title.trim().length > 0 ? `${keyword} | ${title.trim()}` : keyword;
  return truncate(prefix, META_TITLE_MAX);
}

/**
 * Analyzes focus-keyword placement across title, body and url. Only proposes
 * mechanical placement changes; body copy changes are recommendations.
 */
export class KeywordAgent extends BaseAgent {
  readonly id = 'keyword';
  readonly name = 'Keyword Agent';
  readonly version = '1.0.0';
  readonly description = 'Analyzes focus-keyword usage across titles, bodies and urls.';
  readonly capabilities = ['keyword-analysis', 'keyword-placement'];
  readonly supportedTasks = ['analyze-keyword-placement', 'generate-keyword-title'];
  readonly supportedEntities: AgentResourceType[] = [
    'product',
    'collection',
    'page',
    'blog',
    'article',
  ];
  readonly supportedActionTypes: AgentActionType[] = ['update_title'];
  readonly inputSchema = AGENT_INPUT_SCHEMA;
  readonly outputSchema = AGENT_OUTPUT_SCHEMA;
  readonly promptId = 'keyword';

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
    const keyword = keywordOf(entity);
    if (keyword === undefined) {
      this.pushRecommendation(
        recommendations,
        entity,
        'missing-focus-keyword',
        'Missing focus keyword',
        'Declare a focus keyword so the page has a clear optimization target.',
        '',
      );
      return;
    }

    const keywordLower = keyword.toLowerCase();
    const title = titleTextOf(entity);
    const body = bodyTextOf(entity);
    const url = urlTextOf(entity);

    if (title.length > 0 && !title.toLowerCase().includes(keywordLower)) {
      this.pushRecommendation(
        recommendations,
        entity,
        'keyword-not-in-title',
        'Focus keyword not in title',
        `Title does not mention "${keyword}"; lead the title with the focus keyword.`,
        title,
      );
      actions.push(this.updateTitle(entity, injectKeyword(keyword, title)));
    }

    if (body.length > 0 && !body.toLowerCase().includes(keywordLower)) {
      this.pushRecommendation(
        recommendations,
        entity,
        'keyword-not-in-body',
        'Focus keyword not in body',
        `Body copy does not mention "${keyword}".`,
        body.slice(0, 80),
      );
      executionHints.push(`${entity.ref}: mention "${keyword}" naturally in the body copy.`);
    }

    if (!url.toLowerCase().includes(slugify(keyword))) {
      this.pushRecommendation(
        recommendations,
        entity,
        'keyword-not-in-slug',
        'Focus keyword not in slug',
        `Url/slug does not contain "${keyword}"; consider a keyword-bearing slug.`,
        url,
      );
      executionHints.push(
        `${entity.ref}: updating the slug to "/${slugify(keyword)}" requires redirect planning.`,
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
        severity: 'MEDIUM',
        confidence: 0.7,
        estimatedImpact: rule === 'keyword-not-in-title' ? 55 : 35,
        risk: rule === 'keyword-not-in-slug' ? 'MEDIUM' : 'LOW',
        implementationDifficulty: rule === 'keyword-not-in-slug' ? 'HIGH' : 'LOW',
        expectedExecutionTime: rule === 'keyword-not-in-slug' ? '2 hours' : '30 minutes',
        rollbackPossible: rule !== 'keyword-not-in-slug',
        approvalRequired: rule === 'keyword-not-in-slug',
        evidence: [this.evidenceFor(entity, 'current.keyword', value)],
        affectedUrls: [entity.ref],
      }),
    );
  }

  private updateTitle(entity: AgentEntityInput, title: string): AgentAction {
    return this.buildAction({
      actionType: 'update_title',
      resourceType: this.resourceTypeOf(entity),
      resourceId: entity.id,
      resourceRef: entity.ref,
      payload: { title },
      rationale: `Lead title with focus keyword for ${entity.ref}`,
    });
  }

  private resourceTypeOf(entity: AgentEntityInput): AgentResourceType {
    return entity.type as AgentResourceType;
  }
}
