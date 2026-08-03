import type { ContextBudget, ContextSection, ContextSources, PromptContext } from '../types/context.js';

export interface BuildContextOptions {
  task?: { id: string; agentId: string; name: string; description: string };
  budget?: ContextBudget;
}

const SECTION_ORDER = [
  'knowledge-graph',
  'seo-issues',
  'recommendations',
  'historical-outcomes',
  'store-metadata',
  'configuration',
  'task',
] as const;

function stringify(value: unknown): string {
  if (value === undefined) return '';
  return JSON.stringify(value);
}

/** Rough token estimate (chars / 4), deterministic and dependency-free. */
export function estimateTokens(value: unknown): number {
  if (typeof value === 'string') return Math.ceil(value.length / 4);
  return Math.ceil(stringify(value).length / 4);
}

function truncateList<T>(items: T[], budgetTokens: number, estimate: (item: T) => number): T[] {
  let total = 0;
  const kept: T[] = [];
  for (const item of items) {
    const size = estimate(item);
    if (total + size > budgetTokens) break;
    kept.push(item);
    total += size;
  }
  return kept;
}

/**
 * Assembles the minimal context for one agent task: knowledge-graph facts,
 * SEO issues, recommendations, historical outcomes, store metadata, and
 * configuration — each bounded to fit a token budget.
 */
export class ContextBuilder {
  build(sources: ContextSources, options: BuildContextOptions = {}): PromptContext {
    const sections: ContextSection[] = [];
    const budget = options.budget ?? {};

    const addSection = (kind: ContextSection['kind'], content: unknown): void => {
      if (content === undefined) return;
      let truncated = false;
      let sizedContent = content;
      const perSection = budget.maxSectionTokens;
      if (perSection !== undefined && perSection > 0 && Array.isArray(content)) {
        const kept = truncateList(content, perSection, estimateTokens);
        if (kept.length !== content.length) truncated = true;
        sizedContent = kept;
      }
      sections.push({
        id: `${kind}-section`,
        kind,
        content: sizedContent,
        size: estimateTokens(sizedContent),
        truncated,
      });
    };

    addSection('knowledge-graph', this.graphSection(sources.graph));
    addSection('seo-issues', sources.seoIssues);
    addSection('recommendations', this.recommendationSection(sources.recommendations));
    addSection('historical-outcomes', sources.historicalOutcomes);
    addSection('store-metadata', sources.storeMetadata);
    addSection(
      'configuration',
      this.configurationSection(sources.featureFlags, sources.settings),
    );
    if (options.task !== undefined) {
      addSection('task', {
        name: options.task.name,
        description: options.task.description,
      });
    }

    this.applyGlobalBudget(sections, budget.maxTokens);

    sections.sort((a, b) => SECTION_ORDER.indexOf(a.kind) - SECTION_ORDER.indexOf(b.kind));
    const tokenEstimate = sections.reduce((total, section) => total + section.size, 0);
    return {
      taskId: options.task?.id ?? 'task',
      agentId: options.task?.agentId ?? 'agent',
      storeId: sources.storeId,
      sections,
      tokenEstimate,
    };
  }

  private graphSection(graph: ContextSources['graph']): unknown {
    if (graph === null || graph === undefined) return undefined;
    const topOrphans = graph.orphanPages.slice(0, 5).map((page) => ({
      id: page.id,
      url: page.url,
      inLinks: page.inLinks,
    }));
    return {
      snapshotId: graph.snapshotId,
      pageCount: graph.pageCount,
      orphanPageCount: graph.orphanPages.length,
      sampleOrphans: topOrphans,
      topicClusterCount: graph.topicClusters.length,
      contentGapCount: graph.contentGaps.length,
      duplicateTargetCount: graph.duplicateTargets.length,
    };
  }

  private recommendationSection(
    recommendations: ContextSources['recommendations'],
  ): unknown {
    if (recommendations === undefined) return undefined;
    return [...recommendations]
      .sort((a, b) => b.score - a.score)
      .map((recommendation) => ({
        id: recommendation.id,
        rule: recommendation.rule,
        priority: recommendation.priority,
        score: recommendation.score,
        title: recommendation.title,
        recommendedAction: recommendation.recommendedAction,
        affectedUrlCount: recommendation.affectedUrls.length,
      }));
  }

  private configurationSection(
    featureFlags: ContextSources['featureFlags'],
    settings: ContextSources['settings'],
  ): unknown {
    if (featureFlags === undefined && settings === undefined) return undefined;
    return {
      ...(featureFlags === undefined ? {} : { featureFlags }),
      ...(settings === undefined ? {} : { settings }),
    };
  }

  private applyGlobalBudget(sections: ContextSection[], maxTokens: number | undefined): void {
    if (maxTokens === undefined || maxTokens <= 0) return;
    let total = sections.reduce((sum, section) => sum + section.size, 0);
    for (const section of sections) {
      if (total <= maxTokens) break;
      if (!Array.isArray(section.content)) continue;
      const remaining = maxTokens - (total - section.size);
      if (remaining <= 0) {
        section.content = [];
        section.size = 0;
        section.truncated = true;
      } else {
        const kept = truncateList(section.content as unknown[], remaining, estimateTokens);
        if (kept.length !== (section.content as unknown[]).length) {
          section.content = kept;
          section.size = estimateTokens(kept);
          section.truncated = true;
        }
      }
      total = sections.reduce((sum, s) => sum + s.size, 0);
    }
  }
}
