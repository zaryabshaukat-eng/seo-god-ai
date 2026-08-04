import { AnalyticsAgent } from '../analytics/analytics-agent.js';
import { BlogAgent } from '../blog/blog-agent.js';
import { CollectionAgent } from '../collections/collection-agent.js';
import { ContentAgent } from '../content/content-agent.js';
import { ImageSeoAgent } from '../image-seo/image-seo-agent.js';
import { InternalLinkingAgent } from '../internal-linking/internal-linking-agent.js';
import { KeywordAgent } from '../keyword/keyword-agent.js';
import { MetadataAgent } from '../metadata/metadata-agent.js';
import { PageAgent } from '../page/page-agent.js';
import { ProductAgent } from '../product/product-agent.js';
import { ReportingAgent } from '../reporting/reporting-agent.js';
import { SchemaAgent } from '../schema/schema-agent.js';
import { TechnicalSeoAgent } from '../technical-seo/technical-seo-agent.js';
import type { Agent } from '../interfaces/agent.js';
import { AgentRegistry } from './agent-registry.js';

/** The thirteen specialist agents shipped with the package. */
export const DEFAULT_AGENTS: readonly Agent[] = [
  new MetadataAgent(),
  new TechnicalSeoAgent(),
  new ContentAgent(),
  new KeywordAgent(),
  new InternalLinkingAgent(),
  new SchemaAgent(),
  new ImageSeoAgent(),
  new ProductAgent(),
  new CollectionAgent(),
  new BlogAgent(),
  new PageAgent(),
  new ReportingAgent(),
  new AnalyticsAgent(),
];

/** Builds a registry pre-loaded with every default agent. */
export function buildDefaultRegistry(): AgentRegistry {
  const registry = new AgentRegistry();
  for (const agent of DEFAULT_AGENTS) {
    registry.register(agent);
  }
  return registry;
}
