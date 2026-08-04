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

const META_DESCRIPTION_MAX = 160;
const MIN_ARTICLE_WORDS = 300;

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

/**
 * Analyzes blog and article entities: copy volume, excerpts and titles.
 */
export class BlogAgent extends BaseAgent {
  readonly id = 'blog';
  readonly name = 'Blog Agent';
  readonly version = '1.0.0';
  readonly description = 'Analyzes blog and article entities: copy, excerpts and titles.';
  readonly capabilities = ['blog-analysis', 'article-analysis', 'excerpt-generation'];
  readonly supportedTasks = ['analyze-articles', 'generate-excerpt'];
  readonly supportedEntities: AgentResourceType[] = ['blog', 'article'];
  readonly supportedActionTypes: AgentActionType[] = ['update_meta_description'];
  readonly inputSchema = AGENT_INPUT_SCHEMA;
  readonly outputSchema = AGENT_OUTPUT_SCHEMA;
  readonly promptId = 'blog';

  analyze(input: AgentInput): AgentResult {
    const recommendations: AgentRecommendation[] = [];
    const actions: AgentAction[] = [];
    const articles = this.entitiesOfType(input, 'article');
    const blogs = this.entitiesOfType(input, 'blog');

    for (const article of articles) {
      this.analyzeArticle(article, recommendations, actions);
    }

    if (blogs.length > 0 && articles.length === 0) {
      for (const blog of blogs) {
        this.pushRecommendation(
          recommendations,
          blog,
          'no-articles',
          'Blog has no articles',
          'The blog has no articles; publish content to make it indexable and useful.',
          articles.length,
        );
      }
    }

    return this.result({ input, recommendations, actions });
  }

  private analyzeArticle(
    entity: AgentEntityInput,
    recommendations: AgentRecommendation[],
    actions: AgentAction[],
  ): void {
    const body = bodyOf(entity);
    const words = this.numberValue(entity.data, 'wordCount') ?? countWords(body);
    const excerpt = this.stringValue(entity.data, 'excerpt');

    if (words < MIN_ARTICLE_WORDS) {
      this.pushRecommendation(
        recommendations,
        entity,
        'thin-article',
        'Thin article',
        `Article is only ${words} words; expand it beyond ${MIN_ARTICLE_WORDS}.`,
        words,
      );
    }

    if (excerpt === undefined && body.trim().length > 0) {
      this.pushRecommendation(
        recommendations,
        entity,
        'missing-excerpt',
        'Missing excerpt',
        'The article has no excerpt; add a search snippet from the opening copy.',
        excerpt ?? '',
      );
      actions.push(this.updateExcerpt(entity, truncate(body.trim(), META_DESCRIPTION_MAX)));
    }

    const title = titleOf(entity);
    if (title === undefined) {
      this.pushRecommendation(
        recommendations,
        entity,
        'missing-title',
        'Missing article title',
        'The article has no title; add a descriptive headline.',
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
        severity: rule === 'missing-title' ? 'HIGH' : 'MEDIUM',
        confidence: 0.75,
        estimatedImpact: rule === 'missing-title' ? 70 : 40,
        risk: 'LOW',
        implementationDifficulty: 'MEDIUM',
        expectedExecutionTime: '1 hour',
        rollbackPossible: true,
        evidence: [this.evidenceFor(entity, 'current.blog', value)],
        affectedUrls: [entity.ref],
      }),
    );
  }

  private updateExcerpt(entity: AgentEntityInput, excerpt: string): AgentAction {
    return this.buildAction({
      actionType: 'update_meta_description',
      resourceType: 'article',
      resourceId: entity.id,
      resourceRef: entity.ref,
      payload: { description: excerpt },
      rationale: `Draft excerpt for article ${entity.ref}`,
    });
  }
}
