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
import { truncate } from '../utils/text.js';

const META_TITLE_MAX = 60;
const META_TITLE_MIN = 10;
const META_DESCRIPTION_MAX = 160;

function titleSource(data: Record<string, unknown>): string | undefined {
  for (const key of ['title', 'name']) {
    const value = data[key];
    if (typeof value === 'string' && value.trim().length > 0) return value;
  }
  return undefined;
}

function descriptionSource(data: Record<string, unknown>): string | undefined {
  for (const key of ['description', 'excerpt', 'body', 'summary']) {
    const value = data[key];
    if (typeof value === 'string' && value.trim().length > 0) return value;
  }
  return undefined;
}

function metaTitleOf(entity: AgentEntityInput): string | undefined {
  const value = entity.data['metaTitle'];
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function metaDescriptionOf(entity: AgentEntityInput): string | undefined {
  const value = entity.data['metaDescription'];
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

/**
 * Analyzes titles and meta descriptions. Only proposes values derived from
 * data already present in the input; never fabricates copy.
 */
export class MetadataAgent extends BaseAgent {
  readonly id = 'metadata';
  readonly name = 'Metadata Agent';
  readonly version = '1.0.0';
  readonly description =
    'Analyzes titles and meta descriptions across store entities and proposes corrected, evidence-backed metadata.';
  readonly capabilities = [
    'metadata-analysis',
    'meta-title-generation',
    'meta-description-generation',
  ];
  readonly supportedTasks = ['analyze-metadata', 'generate-meta-title', 'generate-meta-description'];
  readonly supportedEntities: AgentResourceType[] = [
    'product',
    'collection',
    'page',
    'blog',
    'article',
    'store',
  ];
  readonly supportedActionTypes: AgentActionType[] = [
    'update_title',
    'update_meta_description',
    'update_meta',
  ];
  readonly inputSchema = AGENT_INPUT_SCHEMA;
  readonly outputSchema = AGENT_OUTPUT_SCHEMA;
  readonly promptId = 'metadata';

  analyze(input: AgentInput): AgentResult {
    const recommendations: AgentRecommendation[] = [];
    const actions: AgentAction[] = [];
    const seenTitles = new Map<string, string>();

    for (const entity of input.entities) {
      this.analyzeEntity(entity, recommendations, actions, seenTitles);
    }

    return this.result({ input, recommendations, actions });
  }

  private analyzeEntity(
    entity: AgentEntityInput,
    recommendations: AgentRecommendation[],
    actions: AgentAction[],
    seenTitles: Map<string, string>,
  ): void {
    const title = titleSource(entity.data);
    const metaTitle = metaTitleOf(entity);
    const metaDescription = metaDescriptionOf(entity);

    if (metaTitle === undefined) {
      this.pushRecommendation(
        recommendations,
        entity,
        'missing-meta-title',
        'Missing meta title',
        'Add a meta title to improve search-result relevance.',
        metaTitle ?? '',
      );
      if (title !== undefined) {
        actions.push(this.updateTitle(entity, truncate(title, META_TITLE_MAX)));
      }
    } else if (metaTitle.length > META_TITLE_MAX) {
      this.pushRecommendation(
        recommendations,
        entity,
        'meta-title-too-long',
        'Meta title too long',
        `Meta title is ${metaTitle.length} characters; keep it within ${META_TITLE_MAX}.`,
        metaTitle,
      );
      actions.push(this.updateTitle(entity, truncate(metaTitle, META_TITLE_MAX)));
    } else if (metaTitle.length < META_TITLE_MIN) {
      this.pushRecommendation(
        recommendations,
        entity,
        'meta-title-too-short',
        'Meta title too short',
        `Meta title is only ${metaTitle.length} characters; aim for at least ${META_TITLE_MIN}.`,
        metaTitle,
      );
      if (title !== undefined) {
        actions.push(this.updateTitle(entity, truncate(title, META_TITLE_MAX)));
      }
    }

    if (metaDescription === undefined) {
      this.pushRecommendation(
        recommendations,
        entity,
        'missing-meta-description',
        'Missing meta description',
        'Add a meta description to control the search snippet.',
        metaDescription ?? '',
      );
      const source = descriptionSource(entity.data);
      if (source !== undefined) {
        actions.push(this.updateMetaDescription(entity, truncate(source, META_DESCRIPTION_MAX)));
      }
    } else if (metaDescription.length > META_DESCRIPTION_MAX) {
      this.pushRecommendation(
        recommendations,
        entity,
        'meta-description-too-long',
        'Meta description too long',
        `Meta description is ${metaDescription.length} characters; keep it within ${META_DESCRIPTION_MAX}.`,
        metaDescription,
      );
      actions.push(this.updateMetaDescription(entity, truncate(metaDescription, META_DESCRIPTION_MAX)));
    }

    const resolvedTitle = title ?? metaTitle;
    if (resolvedTitle !== undefined) {
      const normalized = resolvedTitle.trim().toLowerCase();
      const owner = seenTitles.get(normalized);
      if (owner === undefined) {
        seenTitles.set(normalized, entity.ref);
      } else {
        this.pushRecommendation(
          recommendations,
          entity,
          'duplicate-title',
          'Duplicate title',
          `Title "${resolvedTitle}" is also used by ${owner}.`,
          resolvedTitle,
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
        severity: 'MEDIUM',
        confidence: 0.8,
        estimatedImpact: 40,
        risk: 'LOW',
        implementationDifficulty: 'TRIVIAL',
        expectedExecutionTime: '5 minutes',
        rollbackPossible: true,
        evidence: [this.evidenceFor(entity, 'current.metadata', value)],
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
      rationale: `Draft meta title for ${entity.ref}`,
    });
  }

  private updateMetaDescription(entity: AgentEntityInput, description: string): AgentAction {
    return this.buildAction({
      actionType: 'update_meta_description',
      resourceType: this.resourceTypeOf(entity),
      resourceId: entity.id,
      resourceRef: entity.ref,
      payload: { description },
      rationale: `Draft meta description for ${entity.ref}`,
    });
  }

  private resourceTypeOf(entity: AgentEntityInput): AgentResourceType {
    return entity.type === 'store' ? 'store' : (entity.type as AgentResourceType);
  }
}
