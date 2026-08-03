import { describe, expect, it } from 'vitest';
import type { PageExtraction } from '@seogod/crawler';
import { buildGraph, GraphBuilder } from './graph-builder.js';
import { STORE_ID, buildInput, fixedClock, keyword, page, storePages, storeRecommendations, ORIGIN } from '../test/fixtures.js';

describe('GraphBuilder', () => {
  it('builds a deterministic, idempotent graph for a full store', () => {
    const builder = new GraphBuilder({ now: fixedClock });
    const graph = builder.build(
      buildInput({
        pages: storePages(),
        recommendations: storeRecommendations(),
      }),
    );
    expect(graph.nodesSize).toBe(20);
    expect(graph.edgesSize).toBe(46);

    const again = new GraphBuilder({ now: fixedClock }).build(
      buildInput({
        pages: storePages(),
        recommendations: storeRecommendations(),
      }),
    );
    expect(again.nodesArray().map((n) => n.id).sort()).toEqual(graph.nodesArray().map((n) => n.id).sort());
    expect(again.edgesArray().map((e) => e.id).sort()).toEqual(graph.edgesArray().map((e) => e.id).sort());

    const store = graph.findNode('store', STORE_ID);
    const collection = graph.findNode('collection', `${ORIGIN}/collections/all`);
    const product1 = graph.findNode('product', `${ORIGIN}/products/1`);
    const product2 = graph.findNode('product', `${ORIGIN}/products/2`);
    const about = graph.findNode('page', `${ORIGIN}/about`);
    const home = graph.findNode('page', `${ORIGIN}/`);
    const crawl = graph.findNode('crawl', 'crawl-1');
    expect(store).toBeDefined();
    expect(collection).toBeDefined();
    expect(crawl).toBeDefined();

    expect(graph.hasEdge('owns', store!.id, collection!.id)).toBe(true);
    expect(graph.hasEdge('owns', store!.id, product1!.id)).toBe(true);
    expect(graph.hasEdge('contains', collection!.id, product1!.id)).toBe(true);
    expect(graph.hasEdge('contains', collection!.id, product2!.id)).toBe(true);
    expect(graph.hasEdge('crawled', crawl!.id, home!.id)).toBe(true);
    expect(graph.hasEdge('links_to', home!.id, collection!.id)).toBe(true);
    expect(graph.hasEdge('links_to', product1!.id, home!.id)).toBe(true);

    const recommendation = graph.findNode('seo-recommendation', 'recommendation-1');
    const issue = graph.findNode('seo-issue', 'missing-title@https://acme.example/about');
    expect(recommendation).toBeDefined();
    expect(issue).toBeDefined();
    expect(graph.hasEdge('fixes', recommendation!.id, issue!.id)).toBe(true);
    expect(graph.hasEdge('affects', recommendation!.id, about!.id)).toBe(true);
    expect(graph.hasEdge('affects', issue!.id, about!.id)).toBe(true);
    expect(graph.hasEdge('occurs_in', issue!.id, crawl!.id)).toBe(true);
    expect(graph.hasEdge('derived_from', recommendation!.id, crawl!.id)).toBe(true);

    const external = graph.findNode('external-link', 'https://external.example/buy');
    expect(external).toBeDefined();
    expect(graph.hasEdge('links_to', home!.id, external!.id)).toBe(true);

    const hero = graph.findNode('image', `${ORIGIN}/images/hero.jpg`);
    expect(hero).toBeDefined();
    expect(graph.hasEdge('references', home!.id, hero!.id)).toBe(true);

    const schema = graph.findNode('schema', `${ORIGIN}/products/1#schema0`);
    expect(schema).toBeDefined();
    expect(graph.hasEdge('contains', product1!.id, schema!.id)).toBe(true);
    expect(graph.hasEdge('describes', schema!.id, product1!.id)).toBe(true);
  });

  it('adds keywords, entities, videos, and agent runs', () => {
    const graph = buildGraph(
      buildInput({
        pages: storePages(),
        recommendations: storeRecommendations(),
        keywords: [keyword({ targetUrls: [`${ORIGIN}/products/1`, `${ORIGIN}/products/2`] })],
        entities: [{ name: 'seo', pageUrls: [`${ORIGIN}/products/1`, `${ORIGIN}/products/2`] }],
        videos: [{ url: 'https://media.example/clip.mp4', sourcePageUrl: `${ORIGIN}/products/1` }],
        agentRuns: [
          { id: 'agent-1', agentName: 'content-writer', status: 'done', recommendationIds: ['recommendation-1'] },
        ],
      }),
      { now: fixedClock },
    );
    expect(graph.nodesSize).toBe(25);
    expect(graph.edgesSize).toBe(53);

    const keywordNode = graph.findNode('keyword', 'acme widget');
    const intentNode = graph.findNode('search-intent', 'transactional');
    const product1 = graph.findNode('product', `${ORIGIN}/products/1`);
    expect(keywordNode).toBeDefined();
    expect(intentNode).toBeDefined();
    expect(graph.hasEdge('belongs_to', keywordNode!.id, intentNode!.id)).toBe(true);
    expect(graph.hasEdge('targets', product1!.id, keywordNode!.id)).toBe(true);

    const entityNode = graph.findNode('entity', 'entity:seo');
    expect(entityNode).toBeDefined();
    expect(graph.hasEdge('contains', product1!.id, entityNode!.id)).toBe(true);

    const videoNode = graph.findNode('video', 'https://media.example/clip.mp4');
    expect(videoNode).toBeDefined();
    expect(graph.hasEdge('references', product1!.id, videoNode!.id)).toBe(true);

    const agentNode = graph.findNode('agent-run', 'agent-1');
    const recommendation = graph.findNode('seo-recommendation', 'recommendation-1');
    expect(agentNode).toBeDefined();
    expect(graph.hasEdge('generated', agentNode!.id, recommendation!.id)).toBe(true);
  });

  it('skips pages without extractions and un-crawled internal links', () => {
    const graph = buildGraph(
      buildInput({
        pages: [
          page({ url: `${ORIGIN}/p/1` }),
          page({ url: `${ORIGIN}/p/2`, extraction: null }),
          page({
            url: `${ORIGIN}/p/3`,
            extraction: {
              ...page().extraction!,
              url: `${ORIGIN}/p/3`,
              links: [
                { href: `${ORIGIN}/uncrawled`, anchorText: null, rel: null, isInternal: true, isImage: false },
              ],
            },
          }),
        ],
        recommendations: [],
      }),
      { now: fixedClock },
    );
    expect(graph.nodesSize).toBe(5);
    expect(graph.findNode('page', `${ORIGIN}/p/2`)).toBeUndefined();
    expect(graph.findNode('page', `${ORIGIN}/p/3`)).toBeDefined();
    expect(graph.edgesArray().filter((e) => e.type === 'links_to')).toHaveLength(0);
  });

  it('keeps the store website node and stores owns website', () => {
    const graph = buildGraph(buildInput({ pages: storePages() }), { now: fixedClock });
    const website = graph.findNode('website', ORIGIN);
    const store = graph.findNode('store', STORE_ID);
    expect(website).toBeDefined();
    expect(graph.hasEdge('owns', store!.id, website!.id)).toBe(true);
  });

  it('handles sparse extractions and optional-input fallbacks', () => {
    const sparse = {
      ...page().extraction!,
      title: null,
      metaDescription: null,
      metaRobots: null,
      canonicalUrl: null,
      lang: null,
      favicon: null,
      charset: null,
      contentType: null,
      statusCode: undefined,
      h1: undefined,
      wordCount: undefined,
      contentHash: undefined,
      robotsBlocked: undefined,
      ogTags: undefined,
      twitterTags: undefined,
      performance: undefined,
      links: [
        { href: 'mailto:hi@acme.example', anchorText: null, rel: null, isInternal: true, isImage: false },
        { href: `${ORIGIN}/p/2`, anchorText: null, rel: null, isInternal: true, isImage: false },
      ],
      images: [
        { src: '', alt: null },
        { src: `${ORIGIN}/images/a.png`, alt: null },
      ],
    } as unknown as PageExtraction;

    const graph = buildGraph(
      {
        storeId: 'store-1',
        crawlJobId: 'crawl-1',
        pages: [
          page({ url: `${ORIGIN}/p/1#fragment`, extraction: sparse }),
          page({ url: `${ORIGIN}/p/2/`, extraction: { ...sparse, links: [], images: [] } }),
        ],
        recommendations: [],
        keywords: [{ text: 'untargeted', searchIntent: undefined }],
        entities: [{ name: 'ghost' }],
        agentRuns: [{ id: 'agent-0', agentName: 'writer', status: 'done' }],
      },
      { now: fixedClock },
    );

    expect(graph.findNode('page', `${ORIGIN}/p/1`)).toBeDefined();
    expect(graph.findNode('page', `${ORIGIN}/p/2`)).toBeDefined();
    expect(graph.findNode('page', `${ORIGIN}/p/2/`)).toBeUndefined();
    expect(graph.hasEdge('links_to', graph.findNode('page', `${ORIGIN}/p/1`)!.id, graph.findNode('page', `${ORIGIN}/p/2`)!.id)).toBe(true);
    expect(graph.findNode('image', `${ORIGIN}/images/a.png`)!.name).toBe(`${ORIGIN}/images/a.png`);
    expect(graph.findNode('page', `${ORIGIN}/p/1`)!.name).toBe(`${ORIGIN}/p/1`);
    expect(graph.findNode('keyword', 'untargeted')).toBeDefined();
    expect(graph.findNode('entity', 'entity:ghost')).toBeDefined();
    expect(graph.findNode('agent-run', 'agent-0')).toBeDefined();
  });

  it('builds a store graph with no pages and no origin', () => {
    const graph = new GraphBuilder().build({
      storeId: 'store-1',
      crawlJobId: 'crawl-1',
      pages: [],
      recommendations: [],
    });
    expect(graph.nodesSize).toBe(2);
    expect(graph.findNode('website', ORIGIN)).toBeUndefined();
  });

  it('falls back to the raw url when the first page url is not parseable', () => {
    const graph = buildGraph(
      {
        storeId: 'store-1',
        crawlJobId: 'crawl-1',
        pages: [{ url: 'not-a-url', type: 'page', depth: 0, extraction: null, issues: [] }],
        recommendations: [],
      },
      { now: fixedClock },
    );
    expect(graph.findNode('website', 'not-a-url')).toBeDefined();
  });
});
