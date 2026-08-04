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

function metaTitleOf(entity: AgentEntityInput): string | undefined {
  const metaTitle = entity.data['metaTitle'];
  return typeof metaTitle === 'string' && metaTitle.trim().length > 0 ? metaTitle : undefined;
}

/**
 * Analyzes product listings: descriptions, images, meta titles and duplicate
 * titles. Copy/image changes are recommendations; title fixes are actions.
 */
export class ProductAgent extends BaseAgent {
  readonly id = 'product';
  readonly name = 'Product Agent';
  readonly version = '1.0.0';
  readonly description = 'Analyzes product listings: descriptions, images, titles and availability.';
  readonly capabilities = ['product-analysis', 'product-description-check'];
  readonly supportedTasks = ['analyze-products', 'generate-product-title'];
  readonly supportedEntities: AgentResourceType[] = ['product'];
  readonly supportedActionTypes: AgentActionType[] = ['update_title'];
  readonly inputSchema = AGENT_INPUT_SCHEMA;
  readonly outputSchema = AGENT_OUTPUT_SCHEMA;
  readonly promptId = 'product';

  analyze(input: AgentInput): AgentResult {
    const recommendations: AgentRecommendation[] = [];
    const actions: AgentAction[] = [];
    const executionHints: string[] = [];
    const seenTitles = new Map<string, string>();

    for (const entity of this.entitiesOfType(input, 'product')) {
      this.analyzeEntity(entity, recommendations, actions, executionHints, seenTitles);
    }

    return this.result({ input, recommendations, actions, executionHints });
  }

  private analyzeEntity(
    entity: AgentEntityInput,
    recommendations: AgentRecommendation[],
    actions: AgentAction[],
    executionHints: string[],
    seenTitles: Map<string, string>,
  ): void {
    const description = descriptionOf(entity);
    const words = this.numberValue(entity.data, 'wordCount') ?? countWords(description);

    if (description.trim().length === 0) {
      this.pushRecommendation(
        recommendations,
        entity,
        'missing-description',
        'Missing product description',
        'The product has no description; add unique selling copy.',
        '',
      );
      executionHints.push(`${entity.ref}: write a unique product description.`);
    } else if (words < MIN_DESCRIPTION_WORDS) {
      this.pushRecommendation(
        recommendations,
        entity,
        'thin-description',
        'Thin product description',
        `Description is only ${words} words; expand it beyond ${MIN_DESCRIPTION_WORDS}.`,
        words,
      );
    }

    const images = this.listValue(entity.data, 'images');
    if (images.length === 0) {
      this.pushRecommendation(
        recommendations,
        entity,
        'missing-images',
        'Missing product images',
        'The product has no images; add at least one clear product photo.',
        images.length,
      );
    }

    const title = titleOf(entity);
    const metaTitle = metaTitleOf(entity);
    if (metaTitle === undefined && title !== undefined) {
      this.pushRecommendation(
        recommendations,
        entity,
        'missing-title',
        'Missing meta title',
        'The product has no meta title.',
        metaTitle ?? '',
      );
      actions.push(this.updateTitle(entity, truncate(title, META_TITLE_MAX)));
    }

    if (title !== undefined) {
      const normalized = title.trim().toLowerCase();
      const owner = seenTitles.get(normalized);
      if (owner === undefined) {
        seenTitles.set(normalized, entity.ref);
      } else {
        this.pushRecommendation(
          recommendations,
          entity,
          'duplicate-title',
          'Duplicate product title',
          `Title "${title}" is also used by ${owner}.`,
          title,
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
        severity: rule === 'missing-description' ? 'HIGH' : 'MEDIUM',
        confidence: 0.75,
        estimatedImpact: rule === 'missing-description' ? 75 : 50,
        risk: 'LOW',
        implementationDifficulty: rule === 'missing-description' ? 'MEDIUM' : 'LOW',
        expectedExecutionTime: rule === 'missing-description' ? '2 hours' : '30 minutes',
        rollbackPossible: true,
        evidence: [this.evidenceFor(entity, 'current.product', value)],
        affectedUrls: [entity.ref],
      }),
    );
  }

  private updateTitle(entity: AgentEntityInput, title: string): AgentAction {
    return this.buildAction({
      actionType: 'update_title',
      resourceType: 'product',
      resourceId: entity.id,
      resourceRef: entity.ref,
      payload: { title },
      rationale: `Draft meta title for product ${entity.ref}`,
    });
  }
}
