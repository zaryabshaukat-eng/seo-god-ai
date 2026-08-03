# Knowledge Graph

`@seogod/knowledge-graph` is the canonical relationship layer of the SEO
Operating System. It stores and queries the relationships between SEO entities
— pages, products, keywords, entities, topics, issues, and recommendations —
so every consumer (agents, dashboard, reports) reasons over the same graph
instead of ad-hoc joins.

Everything is deterministic: node and edge ids are derived from stable business
keys (UUIDv5), and snapshots are versioned and diffable, so the graph is both
auditable and queryable across time.

## Architecture

```
GraphBuildInput (crawl + seo-engine output)
  └─ GraphBuilder.build()
       ├─ store / website / crawl            identity nodes
       ├─ pages, collections, products       from crawl tree
       ├─ keywords + search-intent           from input
       ├─ entities, schema, images, videos   from page extractions
       ├─ internal/external links            from link graph
       └─ seo-issue + seo-recommendation     from seo-engine report
  → Graph
      └─ GraphSnapshot.toRecord()            versioned, immutable record
          └─ GraphSnapshotStore               Prisma/PostgreSQL (default)
```

The service pipeline in `KnowledgeGraphService`:

```
buildGraph(input)      build → version → diff vs previous → persist → event
updateGraph(input)     rebuild the graph from an updated snapshot
diff(snapshotA, B)     structural diff of nodes and edges
query(snapshotId)      typed query surface against one snapshot
loadGraph(snapshotId)  hydrate a Graph from a stored record
```

## Node and edge model

There are 22 node types (`store`, `website`, `collection`, `product`, `page`,
`article`, `blog`, `keyword`, `search-intent`, `entity`, `topic-cluster`,
`schema`, `image`, `video`, `internal-link`, `external-link`, `seo-issue`,
`seo-recommendation`, `crawl`, `audit`, `report`, `agent-run`) and 13 edge
types (`owns`, `contains`, `crawled`, `links_to`, `references`, `targets`,
`belongs_to`, `fixes`, `affects`, `describes`, `generated`, `occurs_in`,
`derived_from`).

- Nodes and edges have stable deterministic UUIDs:
  `uuid5('node:' + type, externalId)` and
  `uuid5('edge:' + type, fromId + '\u0000' + toId)`.
- Every node/edge carries a `source` provenance string identifying which
  builder or rule produced it, plus sanitized `properties` for evidence and
  explainability.
- The relationship registry (`src/relationships/registry.ts`) declares which
  source → target node-type pairs are legal for every edge type and is
  enforced on every add (`assertAllowedPair`). An example: `owns` only starts
  at `store` and targets page kinds; `contains` links collections/products,
  blogs/articles, and pages/entities.
- Edge `weight` (0..1) is relationship strength and `confidence` (0..1) is
  how sure the builder is that the relationship exists.

## Usage

```ts
import { KnowledgeGraphService, Graph, diffGraphs } from '@seogod/knowledge-graph';

const service = new KnowledgeGraphService(); // Prisma-backed by default

// Build (or update) the graph for a store
const result = await service.buildGraph({
  storeId: 'store_123',
  source: 'crawl.completed',
  pages,        // pages from a crawl
  keywords,     // target keywords + search intent
  entities,     // named entities
  report,       // seo-engine EngineReport (issues + recommendations)
});

// Versioned snapshot + optional diff against the previous one
const snapshot = result.snapshot;
console.log(snapshot.version, snapshot.nodeCount, snapshot.edgeCount);

// Typed queries against one snapshot
const q = service.query(snapshot.id);
const orphans = q.findOrphanPages();
const clusters = q.findTopicClusters();
const gaps = q.findContentGaps();

// Diff two versions to see what changed
const changes = diffGraphs(a.graph, b.graph, {
  previousId: a.id, currentId: b.id,
  previousVersion: a.version, currentVersion: b.version,
});
```

`KnowledgeGraphServiceOptions` supports swapping in an in-memory store (useful
in tests), a custom builder, an `EventBus` (publishes `graph.built` /
`graph.updated` outbox events), a logger, metrics, and a clock.

## Graph algorithms

Pure functions over a `Graph` (`src/graph/algorithms.ts`):

- `connectedComponents` — disconnected page clusters.
- `internalLinkDepth` — clicks from the homepage.
- `identifyHubs` / `estimateAuthorityFlow` — internal link hubs and authority
  distribution (homepage-rooted, DampingFactor default 0.85).
- `discoverTopicClusters` — keyword/entity grouping into topic clusters.
- `findDuplicateTargets` — near-duplicate pages by similarity.
- `recommendationDependencyGraph` — which pages/keywords depend on each
  recommendation, and `fixes` edges from recommendations to issues.

## Queries

The query surface (`src/queries/queries.ts`) is read-only and takes a `Graph`:

| Query                     | Answers                                  |
| ------------------------- | ---------------------------------------- |
| `findRelatedPages`        | similar pages via shared keywords/links  |
| `findKeywordCompetition`  | pages competing for the same keyword     |
| `findInternalLinkOpportunities` | pages that should link to each other   |
| `findOrphanPages`         | pages with no inbound internal links     |
| `findTopicClusters`       | topic-cluster groupings                  |
| `findRecommendationsForPage/Keyword` | recommendations touching a page/keyword |
| `findEntityRelationships` | how an entity relates to the rest        |
| `findBrokenContentChains` | orphan clusters from the homepage root   |
| `findContentGaps`         | topic/keyword areas with weak coverage   |

## Scoring

Deterministic scoring (`src/scoring/scoring.ts`) ranks pages, keywords, and
recommendations:

- `pageImportance` — link + hub + freshness signals.
- `keywordOpportunity` — search volume, intent, competition.
- `rankRecommendations` — priority × score × evidence, tie-broken stably.
- `authorityContribution` — how much a page contributes to authority flow.

## Persistence

The `GraphSnapshotStore` interface isolates persistence; PostgreSQL via Prisma
(`PrismaGraphSnapshotStore`) is the default. Each snapshot is an immutable
versioned record (`{ nodes, edges, summary, metadata }`); `nextVersion` and
`latestForStore` drive monotonically increasing versions and previous-snapshot
diffs.

## Testing

```bash
npm run test --workspace @seogod/knowledge-graph
npm run test:coverage --workspace @seogod/knowledge-graph
```

The suite spans unit tests per module plus `src/integration.test.ts`, which
runs the full build → persist → version → diff → query → round-trip pipeline
through an in-memory store. Coverage thresholds (95%) are enforced for lines,
branches, functions, and statements.
