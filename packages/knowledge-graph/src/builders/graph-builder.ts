import type { PageType } from '@seogod/crawler';
import type { GraphBuildInput } from '../types/input.js';
import { Graph } from '../models/graph.js';
import type { GraphOptions } from '../models/graph.js';
import type { NodeType } from '../types/graph.js';

const PAGE_TYPE_MAP: Record<PageType, NodeType> = {
  homepage: 'page',
  product: 'product',
  collection: 'collection',
  blog: 'blog',
  article: 'article',
  page: 'page',
  policy: 'page',
  search: 'page',
  other: 'page',
};

const PRODUCT_SCHEMA_TYPES = new Set(['product', 'productgroup', 'productset', 'item', 'productset-item']);

export interface GraphBuilderOptions {
  now?: () => Date;
}

function normalizeUrl(url: string): string {
  let result = url;
  const hashIndex = result.indexOf('#');
  if (hashIndex >= 0) result = result.slice(0, hashIndex);
  // Keep the root slash (`https://site.example/`) but strip trailing slashes
  // from deeper paths so pages match by their canonical url.
  const isRoot = /^https?:\/\/[^/]*\/$/.test(result);
  if (result.endsWith('/') && !isRoot) result = result.slice(0, -1);
  return result;
}

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

function isProductSchema(schemaType: string): boolean {
  return PRODUCT_SCHEMA_TYPES.has(schemaType.toLowerCase());
}

/**
 * Converts one crawl + its SEO recommendations into a knowledge graph.
 * The builder is fully deterministic: the same input produces the same
 * nodes, edges, and ids, so re-building never duplicates the graph.
 */
export class GraphBuilder {
  private readonly now: () => Date;

  constructor(options: GraphBuilderOptions = {}) {
    this.now = options.now ?? (() => new Date());
  }

  build(input: GraphBuildInput): Graph {
    const graphOptions: GraphOptions = { now: this.now };
    const graph = new Graph(graphOptions);

    const storeNode = graph.addNode({
      type: 'store',
      externalId: input.storeId,
      name: `Store ${input.storeId}`,
      properties: { storeId: input.storeId },
      source: 'builder',
    });

    const crawlNode = graph.addNode({
      type: 'crawl',
      externalId: input.crawlJobId,
      name: `Crawl ${input.crawlJobId}`,
      properties: { crawlJobId: input.crawlJobId, storeId: input.storeId },
      source: 'builder',
    });

    const origin = input.pages[0]?.url !== undefined ? originOf(input.pages[0].url) : '';
    let websiteNode: ReturnType<typeof graph.getNode> | undefined;
    if (origin !== '') {
      websiteNode = graph.addNode({
        type: 'website',
        externalId: origin,
        name: origin,
        properties: { origin, url: origin },
        source: 'builder',
      });
      graph.addEdge({ type: 'owns', from: storeNode.id, to: websiteNode.id, source: 'builder' });
    }

    const pageNodes = new Map<string, string>();

    for (const page of input.pages) {
      const url = normalizeUrl(page.url);
      const extraction = page.extraction;
      if (extraction === null) continue;
      const type = PAGE_TYPE_MAP[page.type];
      const properties: Record<string, unknown> = {
        url,
        depth: page.depth,
        contentType: extraction?.contentType ?? null,
        statusCode: extraction?.statusCode ?? null,
        title: extraction?.title ?? null,
        metaDescription: extraction?.metaDescription ?? null,
        metaRobots: extraction?.metaRobots ?? null,
        canonicalUrl: extraction?.canonicalUrl ?? null,
        h1: extraction?.h1 ?? [],
        lang: extraction?.lang ?? null,
        wordCount: extraction?.wordCount ?? 0,
        contentHash: extraction?.contentHash ?? null,
        robotsBlocked: extraction?.robotsBlocked ?? false,
        favicon: extraction?.favicon ?? null,
        charset: extraction?.charset ?? null,
        ogTags: extraction?.ogTags ?? {},
        twitterTags: extraction?.twitterTags ?? {},
        performance:
          extraction?.performance === undefined
            ? null
            : {
                ttfbMs: extraction.performance.ttfbMs,
                responseTimeMs: extraction.performance.responseTimeMs,
                pageSizeBytes: extraction.performance.pageSizeBytes,
                htmlSizeBytes: extraction.performance.htmlSizeBytes,
                scriptCount: extraction.performance.scriptCount,
                stylesheetCount: extraction.performance.stylesheetCount,
              },
        issueRules: page.issues.map((issue) => issue.rule),
        issueCount: page.issues.length,
      };
      const node = graph.addNode({
        type,
        externalId: url,
        name: extraction?.title ?? url,
        properties,
        source: 'crawler',
      });
      pageNodes.set(url, node.id);
      graph.addEdge({ type: 'owns', from: storeNode.id, to: node.id, source: 'builder' });
      graph.addEdge({ type: 'crawled', from: crawlNode.id, to: node.id, source: 'crawler' });
    }

    for (const page of input.pages) {
      const fromId = pageNodes.get(normalizeUrl(page.url));
      const extraction = page.extraction;
      if (fromId === undefined || extraction === null) continue;
      const fromNode = graph.getNode(fromId);

      for (const link of extraction.links) {
        if (typeof link.href !== 'string' || !/^https?:\/\//i.test(link.href)) continue;
        if (link.isInternal) {
          const toId = pageNodes.get(normalizeUrl(link.href));
          if (toId === undefined || toId === fromId) continue;
          graph.addEdge({
            type: 'links_to',
            from: fromId,
            to: toId,
            weight: 1,
            confidence: 1,
            source: 'crawler',
            properties: { anchorText: link.anchorText, rel: link.rel },
          });
          const toNode = graph.getNode(toId);
          if (fromNode?.type === 'collection' && toNode?.type === 'product') {
            graph.addEdge({ type: 'contains', from: fromId, to: toId, source: 'crawler' });
          }
        } else {
          const external =
            graph.findNode('external-link', link.href) ??
            graph.addNode({
              type: 'external-link',
              externalId: link.href,
              name: originOf(link.href),
              properties: { url: link.href },
              source: 'crawler',
            });
          graph.addEdge({
            type: 'links_to',
            from: fromId,
            to: external.id,
            weight: 0.5,
            confidence: 1,
            source: 'crawler',
            properties: { anchorText: link.anchorText, rel: link.rel, isExternal: true },
          });
        }
      }

      for (const image of extraction.images) {
        if (typeof image.src !== 'string' || image.src === '') continue;
        const imageNode =
          graph.findNode('image', image.src) ??
          graph.addNode({
            type: 'image',
            externalId: image.src,
            name: image.alt ?? image.src,
            properties: { src: image.src, alt: image.alt },
            source: 'crawler',
          });
        graph.addEdge({
          type: 'references',
          from: fromId,
          to: imageNode.id,
          source: 'crawler',
          properties: { alt: image.alt },
        });
      }

      for (const [index, block] of extraction.structuredData.entries()) {
        if (!block.valid || block.schemaType === null) continue;
        const url = normalizeUrl(page.url);
        const schemaNode = graph.addNode({
          type: 'schema',
          externalId: `${url}#schema${index}`,
          name: block.schemaType,
          properties: { schemaType: block.schemaType, format: block.format, url },
          source: 'crawler',
        });
        graph.addEdge({ type: 'contains', from: fromId, to: schemaNode.id, source: 'crawler' });
        if (page.type === 'product' && isProductSchema(block.schemaType)) {
          graph.addEdge({ type: 'describes', from: schemaNode.id, to: fromId, source: 'crawler' });
        }
      }
    }

    for (const video of input.videos ?? []) {
      const videoNode = graph.addNode({
        type: 'video',
        externalId: video.url,
        name: video.url,
        properties: { url: video.url },
        source: 'crawler',
      });
      const pageId = pageNodes.get(normalizeUrl(video.sourcePageUrl));
      if (pageId !== undefined) {
        graph.addEdge({ type: 'references', from: pageId, to: videoNode.id, source: 'crawler' });
      }
    }

    for (const keyword of input.keywords ?? []) {
      const keywordNode = graph.addNode({
        type: 'keyword',
        externalId: keyword.text,
        name: keyword.text,
        properties: {
          keyword: keyword.text,
          searchIntent: keyword.searchIntent ?? null,
          searchVolume: keyword.searchVolume ?? null,
          competition: keyword.competition ?? null,
        },
        source: 'builder',
      });
      if (keyword.searchIntent !== undefined && keyword.searchIntent !== '') {
        const intentNode =
          graph.findNode('search-intent', keyword.searchIntent) ??
          graph.addNode({
            type: 'search-intent',
            externalId: keyword.searchIntent,
            name: keyword.searchIntent,
            properties: { intent: keyword.searchIntent },
            source: 'builder',
          });
        graph.addEdge({ type: 'belongs_to', from: keywordNode.id, to: intentNode.id, source: 'builder' });
      }
      for (const targetUrl of keyword.targetUrls ?? []) {
        const pageId = pageNodes.get(normalizeUrl(targetUrl));
        if (pageId !== undefined) {
          graph.addEdge({
            type: 'targets',
            from: pageId,
            to: keywordNode.id,
            weight: 0.9,
            confidence: 0.7,
            source: 'builder',
          });
        }
      }
    }

    for (const entity of input.entities ?? []) {
      const type = entity.nodeType ?? 'entity';
      const entityNode = graph.addNode({
        type,
        externalId: `entity:${entity.name}`,
        name: entity.name,
        properties: { name: entity.name },
        source: 'builder',
      });
      for (const pageUrl of entity.pageUrls ?? []) {
        const pageId = pageNodes.get(normalizeUrl(pageUrl));
        if (pageId !== undefined) {
          graph.addEdge({ type: 'contains', from: pageId, to: entityNode.id, source: 'builder' });
        }
      }
    }

    for (const recommendation of input.recommendations) {
      const recommendationNode = graph.addNode({
        type: 'seo-recommendation',
        externalId: recommendation.id,
        name: recommendation.title,
        properties: {
          rule: recommendation.rule,
          category: recommendation.category,
          priority: recommendation.priority,
          score: recommendation.score,
          impact: recommendation.impact,
          effort: recommendation.effort,
          confidence: recommendation.confidence,
          pageCount: recommendation.pageCount,
          occurrenceCount: recommendation.occurrenceCount,
          crawlJobId: recommendation.crawlJobId,
          storeId: recommendation.storeId,
        },
        source: 'seo-engine',
      });
      graph.addEdge({ type: 'derived_from', from: recommendationNode.id, to: crawlNode.id, source: 'seo-engine' });
      for (const affectedUrl of recommendation.affectedUrls) {
        const url = normalizeUrl(affectedUrl);
        const pageId = pageNodes.get(url);
        if (pageId === undefined) continue;
        graph.addEdge({ type: 'affects', from: recommendationNode.id, to: pageId, source: 'seo-engine' });
        const issueNode = graph.addNode({
          type: 'seo-issue',
          externalId: `${recommendation.rule}@${url}`,
          name: recommendation.title,
          properties: {
            rule: recommendation.rule,
            severity: recommendation.priority,
            url,
            message: recommendation.description,
          },
          source: 'seo-engine',
        });
        graph.addEdge({ type: 'fixes', from: recommendationNode.id, to: issueNode.id, source: 'seo-engine' });
        graph.addEdge({ type: 'affects', from: issueNode.id, to: pageId, source: 'seo-engine' });
        graph.addEdge({ type: 'occurs_in', from: issueNode.id, to: crawlNode.id, source: 'seo-engine' });
      }
    }

    for (const agentRun of input.agentRuns ?? []) {
      const agentNode = graph.addNode({
        type: 'agent-run',
        externalId: agentRun.id,
        name: agentRun.agentName,
        properties: { agentName: agentRun.agentName, status: agentRun.status },
        source: 'agent',
      });
      for (const recommendationId of agentRun.recommendationIds ?? []) {
        const recommendationNode = graph.findNode('seo-recommendation', recommendationId);
        if (recommendationNode !== undefined) {
          graph.addEdge({ type: 'generated', from: agentNode.id, to: recommendationNode.id, source: 'agent' });
        }
      }
    }

    return graph;
  }
}

/** Convenience wrapper around {@link GraphBuilder}. */
export function buildGraph(input: GraphBuildInput, options: GraphBuilderOptions = {}): Graph {
  return new GraphBuilder(options).build(input);
}
