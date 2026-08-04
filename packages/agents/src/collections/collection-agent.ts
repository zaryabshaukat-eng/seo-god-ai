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
import { truncate, wordCount as countWords } from '../utils/text.js';

const META_TITLE_MAX = 60;
const MIN_DESCRIPTION_WORDS = 100;

function descriptionOf(entity: AgentEntityInput): string {
  const description = entity.data['description'];
  if (typeof description === 'string' && description.trim().length > 0) return description;
  const body = entity.data['body'];
  if (typeof body === 'string' && body.trim().length > 0) return body;
  return '';
}

function titleOf(entity: AgentEntityInput): string | undefined {
  const title = entity.data['title'];
  return typeof title === 'string' && title.trim().length > 0 ? title : undefined;
}

/**
 * Analyzes collection pages: descriptions, body copy, coverage and meta titles.
 */
export class CollectionAgent extends BaseAgent {
  readonly id = 'collections';
  readonly name = 'Collection Agent';
  readonly version = '1.0.0';
  readonly description = 'Analyzes collection pages: descriptions, body copy and product coverage.';
  readonly capabilities = ['collection-analysis', 'collection-description-check'];
  readonly supportedTasks = ['analyze-collections', 'generate-collection-title'];
  readonly supportedEntities: AgentResourceType[] = ['collection'];
  readonly supportedActionTypes: AgentActionType[] = ['update_title'];
  readonly inputSchema = AGENT_INPUT_SCHEMA;
  readonly outputSchema = AGENT_OUTPUT_SCHEMA;
  readonly promptId = 'collections';

  analyze(input: AgentInput): AgentResult {
    const recommendations: AgentRecommendation[] = [];
    const actions: AgentAction[] = [];

    for (const entity of this.entitiesOfType(input, 'collection')) {
      this.analyzeEntity(entity, recommendations, actions);
    }

    return this.result({ input, recommendations, actions });
  }

  private analyzeEntity(
    entity: AgentEntityInput,
    recommendations: AgentRecommendation[],
    actions: AgentAction[],
  ): void {
    const description = descriptionOf(entity);
    const words = this.numberValue(entity.data, 'wordCount') ?? countWords(description);
    const productsCount = this.numberValue(entity.data, 'productsCount') ?? 0;

    if (description.trim().length === 0) {
      this.pushRecommendation(
        recommendations,
        entity,
        'missing-description',
        'Missing collection description',
        'The collection has no description; add copy explaining its contents.',
        '',
      );
    } else if (words < MIN_DESCRIPTION_WORDS) {
      this.pushRecommendation(
        recommendations,
        entity,
        'thin-description',
        'Thin collection description',
        `Description is only ${words} words; expand it beyond ${MIN_DESCRIPTION_WORDS}.`,
        words,
      );
    }

    if (productsCount === 0) {
      this.pushRecommendation(
        recommendations,
        entity,
        'empty-collection',
        'Empty collection',
        'The collection contains no products; add products or hide the collection.',
        productsCount,
      );
    }

    const title = titleOf(entity);
    const metaTitle = this.stringValue(entity.data, 'metaTitle');
    if (title !== undefined && metaTitle === undefined) {
      this.pushRecommendation(
        recommendations,
        entity,
        'missing-title',
        'Missing meta title',
        'The collection has no meta title.',
        metaTitle ?? '',
      );
      actions.push(this.updateTitle(entity, truncate(title, META_TITLE_MAX)));
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
        confidence: 0.75,
        estimatedImpact: 45,
        risk: 'LOW',
        implementationDifficulty: 'LOW',
        expectedExecutionTime: '30 minutes',
        rollbackPossible: true,
        evidence: [this.evidenceFor(entity, 'current.collection', value)],
        affectedUrls: [entity.ref],
      }),
    );
  }

  private updateTitle(entity: AgentEntityInput, title: string): AgentAction {
    return this.buildAction({
      actionType: 'update_title',
      resourceType: 'collection',
      resourceId: entity.id,
      resourceRef: entity.ref,
      payload: { title },
      rationale: `Draft meta title for collection ${entity.ref}`,
    });
  }
}
