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

const TYPE_BY_ENTITY: Record<string, string> = {
  product: 'Product',
  collection: 'CollectionPage',
  page: 'WebPage',
  blog: 'Blog',
  article: 'Article',
  store: 'Organization',
};

function entriesOf(entity: AgentEntityInput): unknown[] {
  const structured = entity.data['structuredData'];
  if (Array.isArray(structured)) return structured;
  const jsonLd = entity.data['jsonLd'];
  if (Array.isArray(jsonLd)) return jsonLd;
  return [];
}

function typeOf(entry: unknown): unknown {
  if (typeof entry !== 'object' || entry === null) return undefined;
  const record = entry as Record<string, unknown>;
  const value = record['@type'] ?? record['type'];
  return value;
}

function nameOf(entity: AgentEntityInput): string | undefined {
  for (const key of ['name', 'title']) {
    const value = entity.data[key];
    if (typeof value === 'string' && value.trim().length > 0) return value;
  }
  return undefined;
}

function urlOf(entity: AgentEntityInput): string {
  const url = entity.data['url'];
  return typeof url === 'string' && url.trim().length > 0 ? url : entity.ref;
}

/**
 * Analyzes JSON-LD structured data. Missing blocks are proposed as additive
 * actions derived from entity fields; invalid blocks require approval.
 */
export class SchemaAgent extends BaseAgent {
  readonly id = 'schema';
  readonly name = 'Structured Data Agent';
  readonly version = '1.0.0';
  readonly description = 'Analyzes JSON-LD structured data presence and validity.';
  readonly capabilities = ['structured-data-analysis', 'json-ld-generation'];
  readonly supportedTasks = ['analyze-structured-data', 'generate-json-ld'];
  readonly supportedEntities: AgentResourceType[] = [
    'product',
    'collection',
    'page',
    'blog',
    'article',
    'store',
  ];
  readonly supportedActionTypes: AgentActionType[] = ['add_structured_data', 'remove_structured_data'];
  readonly inputSchema = AGENT_INPUT_SCHEMA;
  readonly outputSchema = AGENT_OUTPUT_SCHEMA;
  readonly promptId = 'schema';

  analyze(input: AgentInput): AgentResult {
    const recommendations: AgentRecommendation[] = [];
    const actions: AgentAction[] = [];

    for (const entity of input.entities) {
      this.analyzeEntity(entity, recommendations, actions);
    }

    return this.result({ input, recommendations, actions });
  }

  private analyzeEntity(
    entity: AgentEntityInput,
    recommendations: AgentRecommendation[],
    actions: AgentAction[],
  ): void {
    const entries = entriesOf(entity);
    const expectedType = TYPE_BY_ENTITY[entity.type] ?? 'WebPage';
    const name = nameOf(entity);
    const url = urlOf(entity);

    if (entries.length === 0) {
      this.pushRecommendation(
        recommendations,
        entity,
        'missing-structured-data',
        'Missing structured data',
        `Add ${expectedType} structured data to enable rich results.`,
        '',
      );
      actions.push(this.addStructuredData(entity, expectedType, name, url));
      return;
    }

    let invalidCount = 0;
    let hasExpectedType = false;
    for (const entry of entries) {
      const entryType = typeOf(entry);
      if (typeof entryType !== 'string' || entryType.length === 0) {
        invalidCount += 1;
        continue;
      }
      if (entryType === expectedType) {
        hasExpectedType = true;
      }
    }

    if (invalidCount > 0) {
      this.pushRecommendation(
        recommendations,
        entity,
        'invalid-structured-data',
        'Invalid structured data',
        `${invalidCount} structured-data block(s) are invalid or missing a type.`,
        invalidCount,
      );
      actions.push(this.removeInvalidData(entity));
    }

    if (!hasExpectedType) {
      this.pushRecommendation(
        recommendations,
        entity,
        'missing-key-type',
        `Missing ${expectedType} structured data`,
        `No ${expectedType} block found among the structured data.`,
        '',
      );
      actions.push(this.addStructuredData(entity, expectedType, name, url));
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
        estimatedImpact: 50,
        risk: rule === 'invalid-structured-data' ? 'MEDIUM' : 'LOW',
        implementationDifficulty: 'MEDIUM',
        expectedExecutionTime: '1 hour',
        rollbackPossible: true,
        approvalRequired: rule === 'invalid-structured-data',
        evidence: [this.evidenceFor(entity, 'current.structuredData', value)],
        affectedUrls: [entity.ref],
      }),
    );
  }

  private addStructuredData(
    entity: AgentEntityInput,
    type: string,
    name: string | undefined,
    url: string,
  ): AgentAction {
    return this.buildAction({
      actionType: 'add_structured_data',
      resourceType: this.resourceTypeOf(entity),
      resourceId: entity.id,
      resourceRef: entity.ref,
      payload: {
        type,
        data: {
          '@context': 'https://schema.org',
          '@type': type,
          ...(name === undefined ? {} : { name }),
          ...(url.length > 0 ? { url } : {}),
        },
      },
      rationale: `Add ${type} structured data to ${entity.ref}`,
    });
  }

  private removeInvalidData(entity: AgentEntityInput): AgentAction {
    return this.buildAction({
      actionType: 'remove_structured_data',
      resourceType: this.resourceTypeOf(entity),
      resourceId: entity.id,
      resourceRef: entity.ref,
      payload: { scope: 'invalid-blocks' },
      rationale: `Remove invalid structured data from ${entity.ref}`,
    });
  }

  private resourceTypeOf(entity: AgentEntityInput): AgentResourceType {
    return entity.type === 'store' ? 'store' : (entity.type as AgentResourceType);
  }
}
