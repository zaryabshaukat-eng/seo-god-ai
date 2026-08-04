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

const GENERIC_ALT = new Set(['image', 'img', 'photo', 'picture', '']);
const MAX_IMAGE_KB = 200;

interface ImageLike {
  url: string;
  alt?: string;
  fileName?: string;
  sizeKb?: number;
}

function imagesOf(entity: AgentEntityInput): ImageLike[] {
  const images = entity.data['images'];
  if (!Array.isArray(images)) return [];
  const result: ImageLike[] = [];
  for (const image of images) {
    if (typeof image === 'string') {
      result.push({ url: image });
    } else if (typeof image === 'object' && image !== null) {
      const record = image as Record<string, unknown>;
      const url = typeof record['url'] === 'string' ? record['url'] : undefined;
      if (url === undefined) continue;
      result.push({
        url,
        alt: typeof record['alt'] === 'string' ? record['alt'] : undefined,
        fileName: typeof record['fileName'] === 'string' ? record['fileName'] : undefined,
        sizeKb: typeof record['sizeKb'] === 'number' ? record['sizeKb'] : undefined,
      });
    }
  }
  return result;
}

function altFromFileName(fileName: string): string {
  const base = fileName.replace(/\.[a-z0-9]+$/i, '');
  const cleaned = base.replace(/[-_]+/g, ' ').trim().toLowerCase();
  return cleaned.length > 0 ? cleaned : '';
}

function nameOf(entity: AgentEntityInput): string | undefined {
  const value = entity.data['name'] ?? entity.data['title'];
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function isGeneric(alt: string): boolean {
  return GENERIC_ALT.has(alt.trim().toLowerCase()) || alt.trim().length < 3;
}

/**
 * Analyzes image alt text and payload sizes. Alt text fixes are derived
 * deterministically from the image file name or the entity name.
 */
export class ImageSeoAgent extends BaseAgent {
  readonly id = 'image-seo';
  readonly name = 'Image SEO Agent';
  readonly version = '1.0.0';
  readonly description = 'Analyzes image alt text and payload sizes.';
  readonly capabilities = ['image-analysis', 'alt-text-generation'];
  readonly supportedTasks = ['analyze-images', 'generate-alt-text'];
  readonly supportedEntities: AgentResourceType[] = [
    'product',
    'collection',
    'page',
    'blog',
    'article',
  ];
  readonly supportedActionTypes: AgentActionType[] = ['update_alt_text'];
  readonly inputSchema = AGENT_INPUT_SCHEMA;
  readonly outputSchema = AGENT_OUTPUT_SCHEMA;
  readonly promptId = 'image-seo';

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
    for (const image of imagesOf(entity)) {
      const alt = image.alt ?? '';
      if (alt.trim().length === 0) {
        const proposed = this.proposedAlt(image, entity);
        this.pushRecommendation(
          recommendations,
          entity,
          'missing-alt-text',
          'Missing alt text',
          `Image ${image.url} has no alt text.`,
          alt,
        );
        if (proposed.length > 0) {
          actions.push(this.updateAlt(entity, image.url, proposed));
        }
      } else if (isGeneric(alt)) {
        const proposed = this.proposedAlt(image, entity);
        this.pushRecommendation(
          recommendations,
          entity,
          'generic-alt-text',
          'Generic alt text',
          `Image ${image.url} uses generic alt text "${alt}".`,
          alt,
        );
        if (proposed.length > 0) {
          actions.push(this.updateAlt(entity, image.url, proposed));
        }
      }
      if (image.sizeKb !== undefined && image.sizeKb > MAX_IMAGE_KB) {
        this.pushRecommendation(
          recommendations,
          entity,
          'large-image',
          'Oversized image',
          `Image ${image.url} is ${image.sizeKb}KB; compress below ${MAX_IMAGE_KB}KB.`,
          image.sizeKb,
        );
        executionHints.push(`${image.url}: compress and serve in modern formats.`);
      }
    }
  }

  private proposedAlt(image: ImageLike, entity: AgentEntityInput): string {
    if (image.fileName !== undefined) {
      const derived = altFromFileName(image.fileName);
      if (derived.length > 0) return derived;
    }
    const name = nameOf(entity);
    return name === undefined ? '' : `image of ${name}`;
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
        severity: 'LOW',
        confidence: 0.7,
        estimatedImpact: 25,
        risk: 'LOW',
        implementationDifficulty: 'TRIVIAL',
        expectedExecutionTime: '15 minutes',
        rollbackPossible: true,
        evidence: [this.evidenceFor(entity, 'current.image', value)],
        affectedUrls: [entity.ref],
      }),
    );
  }

  private updateAlt(entity: AgentEntityInput, imageUrl: string, alt: string): AgentAction {
    return this.buildAction({
      actionType: 'update_alt_text',
      resourceType: this.resourceTypeOf(entity),
      resourceId: entity.id,
      resourceRef: entity.ref,
      payload: { imageUrl, alt },
      rationale: `Draft alt text for ${imageUrl}`,
    });
  }

  private resourceTypeOf(entity: AgentEntityInput): AgentResourceType {
    return entity.type as AgentResourceType;
  }
}
