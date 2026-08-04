/**
 * Versioned, reusable, parameterized prompt templates. Prompt text lives here
 * (and only here) - agents reference a prompt id and never inline instructions.
 * The template body is model-facing text describing the agent's task and the
 * strict rules the output must obey.
 */
export interface PromptTemplate {
  id: string;
  version: string;
  name: string;
  description: string;
  parameters: readonly string[];
  template: string;
}

/** Shared output contract every agent prompt references. */
const OUTPUT_CONTRACT_PROMPT: PromptTemplate = {
  id: 'output-contract',
  version: '1.0.0',
  name: 'Agent output contract',
  description:
    'Shared rules every agent must follow when producing results: schema-valid, evidence-backed, no destructive or publishing actions.',
  parameters: [],
  template: `You are part of the SEO GOD AI platform. Your output MUST follow the agent
output contract exactly:
- Return only a JSON object with the fields: agentId, taskId, status,
  recommendations, actions, confidence, risk, evidence, estimatedImpact,
  dependencies, warnings, executionHints.
- Every recommendation MUST carry title, summary, reason, evidence, severity,
  confidence in [0,1], estimatedImpact in [0,100], risk, implementationDifficulty,
  expectedExecutionTime, rollbackPossible, approvalRequired and affectedUrls.
- Every action MUST carry actionType, resourceType, resourceId, resourceRef,
  payload, priority, estimatedSeconds and rationale.
- Never propose destructive (delete/remove) or publishing (create) operations.
- Never target a resource that is not present in the input.
- Validate your own output against your schema before returning it.
- Do not hallucinate facts that are not present in the provided data.`,
};

/** Builds a per-agent prompt that embeds the shared contract rules. */
function agentPrompt(
  id: string,
  version: string,
  name: string,
  description: string,
  task: string,
  rules: readonly string[],
): PromptTemplate {
  const template = `${task}

Store: {storeId}
Workflow: {workflowId}
Task id: {taskId}
Entity count: {entityCount}
Allowed actions: {allowedActions}

Entities:
{entities}

Settings:
{settings}

Additional context:
{context}

${OUTPUT_CONTRACT_PROMPT.template}

Specific rules for this agent:
${rules.map((rule) => `- ${rule}`).join('\n')}`;
  return {
    id,
    version,
    name,
    description,
    parameters: [
      'storeId',
      'workflowId',
      'taskId',
      'entityCount',
      'entities',
      'settings',
      'context',
      'allowedActions',
    ],
    template,
  };
}

export const PROMPTS: Record<string, PromptTemplate> = {
  'output-contract': OUTPUT_CONTRACT_PROMPT,
  metadata: agentPrompt(
    'metadata',
    '1.0.0',
    'Metadata agent',
    'Analyzes titles and meta descriptions across product, collection, page, blog and article entities.',
    'Analyze the titles and meta descriptions of the provided entities. Identify missing, too long, too short or duplicated title and meta-description values, and propose concrete corrected values derived only from data present in the input.',
    [
      'Only propose title/meta values derived from existing input fields (name, title, body, description).',
      'Titles should stay within 60 characters; meta descriptions within 160 characters.',
      'A proposed change is an update_title or update_meta_description action.',
    ],
  ),
  'technical-seo': agentPrompt(
    'technical-seo',
    '1.0.0',
    'Technical SEO agent',
    'Analyzes canonical URLs, robots directives, redirects and broken pages.',
    'Analyze the technical SEO state of the provided entities: canonical URL consistency, robots directives, redirect chains and broken status codes. Propose mechanical fixes only.',
    [
      'Canonical must point at the page itself; flag missing or conflicting canonicals.',
      'Flag pages blocked from indexing while still listed in the sitemap.',
      'Flag redirect chains (a redirect whose target is itself redirected).',
      'Flag pages returning 4xx/5xx status codes.',
    ],
  ),
  content: agentPrompt(
    'content',
    '1.0.0',
    'Content agent',
    'Analyzes body content volume, headings and duplication across entities.',
    'Analyze the body content of the provided entities: thin content, missing or duplicate heading levels and duplicated body copy. Propose evidence-backed content recommendations.',
    [
      'Never fabricate body copy - thin content is a recommendation with executionHints, not a body rewrite action.',
      'Flag pages with fewer than 300 words of body content.',
      'Flag pages missing a single H1 heading or carrying multiple H1s.',
      'Flag near-duplicate bodies across entities.',
    ],
  ),
  keyword: agentPrompt(
    'keyword',
    '1.0.0',
    'Keyword agent',
    'Analyzes focus-keyword usage across titles, bodies, urls and slugs.',
    'Analyze how well each entity targets its declared focus keyword: presence in title, body, url and slug. Propose mechanical keyword placement changes only.',
    [
      'Only act on entities that declare a focusKeyword or primaryKeyword.',
      'Keyword placement in a title or url is a mechanical, reversible change.',
      'Keyword placement in body copy is a recommendation with executionHints.',
    ],
  ),
  'internal-linking': agentPrompt(
    'internal-linking',
    '1.0.0',
    'Internal linking agent',
    'Analyzes inbound/outbound links, broken links and orphan pages.',
    'Analyze the internal linking state of the provided entities: broken links, orphan pages, and pages with no or few inbound links.',
    [
      'Broken links are recommendations with executionHints listing the offending hrefs.',
      'Orphan pages are recommendations proposing an add_internal_links action from the site hub.',
      'Only link to entities that are present in the input.',
    ],
  ),
  schema: agentPrompt(
    'schema',
    '1.0.0',
    'Structured data agent',
    'Analyzes JSON-LD structured data presence and validity.',
    'Analyze the structured data of the provided entities: missing or invalid JSON-LD blocks, and missing schema.org types for the entity kind.',
    [
      'A missing block is an add_structured_data action derived from entity fields.',
      'An invalid block is a recommendation proposing remove_structured_data with approvalRequired.',
      'Only propose schema.org types appropriate for the entity kind.',
    ],
  ),
  'image-seo': agentPrompt(
    'image-seo',
    '1.0.0',
    'Image SEO agent',
    'Analyzes image alt text and payload sizes.',
    'Analyze the images of the provided entities: missing or generic alt text, and oversized payloads.',
    [
      'Alt text must be derived from the image file name or the entity name.',
      'Generic alt text ("image", "img", "photo", "picture") is a defect.',
      'Oversized images are a recommendation with executionHints (no action).',
    ],
  ),
  product: agentPrompt(
    'product',
    '1.0.0',
    'Product agent',
    'Analyzes product listings: descriptions, titles, images and availability.',
    'Analyze product entities for missing or thin descriptions, missing images, missing meta titles and duplicated product titles.',
    [
      'Only analyze entities of type product.',
      'Missing/empty descriptions are recommendations with executionHints.',
      'Meta title generation is an update_title action derived from the product title.',
    ],
  ),
  collections: agentPrompt(
    'collections',
    '1.0.0',
    'Collection agent',
    'Analyzes collection pages: descriptions, body copy and product coverage.',
    'Analyze collection entities for missing or thin descriptions, missing meta titles and empty collections.',
    [
      'Only analyze entities of type collection.',
      'Empty collections (productsCount 0) are a recommendation, not an action.',
    ],
  ),
  blog: agentPrompt(
    'blog',
    '1.0.0',
    'Blog agent',
    'Analyzes blog and article entities: copy, excerpts and titles.',
    'Analyze blog and article entities for thin articles, missing excerpts, missing titles and blogs without articles.',
    [
      'Excerpt generation is an update_meta_description action derived from the article body.',
      'Missing article titles are recommendations, never fabricated.',
    ],
  ),
  page: agentPrompt(
    'page',
    '1.0.0',
    'Page agent',
    'Analyzes store pages: broken pages, thin content, titles and the homepage.',
    'Analyze page entities for broken status codes, thin content, missing titles and a missing homepage.',
    [
      'Broken pages are recommendations with executionHints (redirect or remove) - never delete actions.',
      'Missing pages/homepage are recommendations, never create actions.',
    ],
  ),
  reporting: agentPrompt(
    'reporting',
    '1.0.0',
    'Reporting agent',
    'Consumes other agents\' results and produces an aggregated summary.',
    'Consume the recommendations of other agents provided in the context and produce a deterministic aggregate summary: totals by severity, total estimated impact and the top opportunities.',
    [
      'The input context must contain a report object with recommendation lists.',
      'Produce exactly one summary recommendation per severity bucket plus one top-opportunity list.',
      'Reporting never proposes actions.',
    ],
  ),
  analytics: agentPrompt(
    'analytics',
    '1.0.0',
    'Analytics agent',
    'Analyzes measured outcomes (impressions, clicks, CTR, positions) to find opportunities.',
    'Analyze the measured performance data provided in the context (impressions, clicks, ctr, position) and identify underperforming pages as opportunities.',
    [
      'The input context must contain an outcomes object with metric records.',
      'Low CTR and low impression pages are opportunities with evidence, never actions.',
      'Only act on data present in the input; never invent metrics.',
    ],
  ),
};
