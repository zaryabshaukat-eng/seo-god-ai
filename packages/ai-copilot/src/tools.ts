/**
 * Tool registry and the default tool set.
 *
 * Every tool declares the permission it requires; the service enforces it
 * before execution. Tools degrade gracefully: when the underlying source is
 * not wired, the tool returns an explicit `ok: false` result instead of
 * crashing the conversation.
 */

import type { ChatRequest, CopilotSession, ToolResult } from './types.js';
import { COPILOT_PERMISSIONS } from './permissions.js';
import {
  buildMetricsOverview,
  buildOptimizationPlan,
  gatherRecommendations,
  suggestSafeActions,
  type CopilotSources,
} from './sources.js';

export interface ToolContext {
  sources: CopilotSources;
  session: CopilotSession;
  request: ChatRequest;
}

export interface CopilotTool {
  name: string;
  description: string;
  /** Enterprise permission required to run this tool. */
  permission: string;
  /** JSON Schema-ish argument contract exposed to the model. */
  parameters?: Record<string, unknown>;
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
}

export class ToolRegistry {
  private readonly tools = new Map<string, CopilotTool>();

  constructor(tools: readonly CopilotTool[] = []) {
    this.registerAll(tools);
  }

  register(tool: CopilotTool): ToolRegistry {
    this.tools.set(tool.name, tool);
    return this;
  }

  registerAll(tools: readonly CopilotTool[]): ToolRegistry {
    for (const tool of tools) {
      this.register(tool);
    }
    return this;
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  get(name: string): CopilotTool | undefined {
    return this.tools.get(name);
  }

  list(): CopilotTool[] {
    return [...this.tools.values()];
  }

  remove(name: string): boolean {
    return this.tools.delete(name);
  }

  /** Model-facing schemas for the current tool set. */
  toolSchemas(): Array<{ name: string; description: string; parameters: Record<string, unknown> }> {
    return this.list().map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters ?? {},
    }));
  }
}

/** Wraps tool execution so failures become structured tool results. */
export async function runTool(
  tool: CopilotTool,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  try {
    return await tool.execute(args, ctx);
  } catch (error) {
    return {
      toolCallId: args.toolCallId as string,
      name: tool.name,
      ok: false,
      output: null,
      error: error instanceof Error ? error.message : 'Tool execution failed.',
    };
  }
}

function unavailable(message: string): ToolResult {
  return { toolCallId: '', name: '', ok: false, output: null, error: message };
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function asLimit(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function asBool(value: unknown): boolean {
  return value === true || value === 'true';
}

/** The default tools wired into every copilot. */
export function createDefaultTools(): CopilotTool[] {
  const read = COPILOT_PERMISSIONS.read;
  const manage = COPILOT_PERMISSIONS.manage;

  return [
    {
      name: 'list_recommendations',
      description: 'Lists the current SEO recommendations for a store.',
      permission: read,
      parameters: {
        type: 'object',
        properties: {
          storeId: { type: 'string' },
          rule: { type: 'string' },
          limit: { type: 'number' },
        },
      },
      async execute(args, ctx) {
        if (ctx.sources.recommendations === undefined) {
          return unavailable('Recommendations are not wired up for this workspace.');
        }
        const items = await gatherRecommendations(ctx.sources, {
          storeId: asString(args.storeId),
          rule: asString(args.rule),
          limit: asLimit(args.limit, 50),
        });
        return {
          toolCallId: '',
          name: this.name,
          ok: true,
          output: items.map((item) => ({
            id: item.id,
            rule: item.rule,
            title: item.title,
            priority: item.priority,
            score: item.score,
            impact: item.impact,
            effort: item.effort,
            confidence: item.confidence,
            affectedUrls: item.affectedUrls.length,
            recommendedAction: item.recommendedAction,
          })),
        };
      },
    },
    {
      name: 'explain_recommendation',
      description: 'Explains a single recommendation by id or rule.',
      permission: read,
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          rule: { type: 'string' },
          storeId: { type: 'string' },
        },
      },
      async execute(args, ctx) {
        if (ctx.sources.recommendations === undefined) {
          return unavailable('Recommendations are not wired up for this workspace.');
        }
        const id = asString(args.id);
        const rule = asString(args.rule);
        const items = await gatherRecommendations(ctx.sources, { storeId: asString(args.storeId) });
        const match = items.find((item) => (id !== undefined ? item.id === id : item.rule === rule));
        if (match === undefined) {
          return {
            toolCallId: '',
            name: this.name,
            ok: false,
            output: null,
            error: `Recommendation '${id ?? rule}' was not found.`,
          };
        }
        return {
          toolCallId: '',
          name: this.name,
          ok: true,
          output: {
            id: match.id,
            rule: match.rule,
            title: match.title,
            priority: match.priority,
            score: match.score,
            impact: match.impact,
            effort: match.effort,
            confidence: match.confidence,
            rationale: match.rationale,
            recommendedAction: match.recommendedAction,
            affectedUrls: match.affectedUrls,
            pageCount: match.pageCount,
          },
        };
      },
    },
    {
      name: 'interpret_metrics',
      description: 'Summarizes current store health: scores, KPIs, alerts and executions.',
      permission: read,
      parameters: {
        type: 'object',
        properties: { storeId: { type: 'string' } },
      },
      async execute(args, ctx) {
        if (ctx.sources.observability === undefined) {
          return unavailable('Observability is not wired up for this workspace.');
        }
        const overview = await buildMetricsOverview(ctx.sources, asString(args.storeId));
        return { toolCallId: '', name: this.name, ok: true, output: overview };
      },
    },
    {
      name: 'summarize_crawl',
      description: 'Summarizes the latest crawl for a store.',
      permission: read,
      parameters: {
        type: 'object',
        properties: { storeId: { type: 'string' } },
      },
      async execute(args, ctx) {
        if (ctx.sources.observability === undefined) {
          return unavailable('Observability is not wired up for this workspace.');
        }
        const crawl = await ctx.sources.observability.crawlSummary(asString(args.storeId));
        return { toolCallId: '', name: this.name, ok: true, output: crawl };
      },
    },
    {
      name: 'summarize_execution',
      description: 'Summarizes the latest execution run for a store.',
      permission: read,
      parameters: {
        type: 'object',
        properties: { storeId: { type: 'string' } },
      },
      async execute(args, ctx) {
        if (ctx.sources.observability === undefined) {
          return unavailable('Observability is not wired up for this workspace.');
        }
        const execution = await ctx.sources.observability.executionSummary(asString(args.storeId));
        return { toolCallId: '', name: this.name, ok: true, output: execution };
      },
    },
    {
      name: 'get_alerts',
      description: 'Lists recent alerts for a store.',
      permission: read,
      parameters: {
        type: 'object',
        properties: {
          storeId: { type: 'string' },
          limit: { type: 'number' },
        },
      },
      async execute(args, ctx) {
        if (ctx.sources.observability === undefined) {
          return unavailable('Observability is not wired up for this workspace.');
        }
        const alerts = await ctx.sources.observability.alerts(asString(args.storeId), asLimit(args.limit, 20));
        return { toolCallId: '', name: this.name, ok: true, output: alerts };
      },
    },
    {
      name: 'list_plans',
      description: 'Lists recent optimization plans for a store.',
      permission: read,
      parameters: {
        type: 'object',
        properties: { storeId: { type: 'string' } },
      },
      async execute(args, ctx) {
        if (ctx.sources.decision === undefined) {
          return unavailable('Planning is not wired up for this workspace.');
        }
        const plans = await ctx.sources.decision.listPlans(asString(args.storeId));
        return { toolCallId: '', name: this.name, ok: true, output: plans };
      },
    },
    {
      name: 'generate_optimization_plan',
      description: 'Builds a ranked optimization plan from the current recommendations.',
      permission: manage,
      parameters: {
        type: 'object',
        properties: { storeId: { type: 'string' } },
      },
      async execute(args, ctx) {
        if (ctx.sources.recommendations === undefined) {
          return unavailable('Recommendations are not wired up for this workspace.');
        }
        const items = await gatherRecommendations(ctx.sources, { storeId: asString(args.storeId) });
        const plan = buildOptimizationPlan(items, {
          storeId: asString(args.storeId),
          createdAt: new Date().toISOString(),
        });
        return { toolCallId: '', name: this.name, ok: true, output: plan };
      },
    },
    {
      name: 'suggest_safe_actions',
      description: 'Suggests safe actions the merchant can take now.',
      permission: manage,
      parameters: {
        type: 'object',
        properties: {
          storeId: { type: 'string' },
          limit: { type: 'number' },
        },
      },
      async execute(args, ctx) {
        if (ctx.sources.recommendations === undefined) {
          return unavailable('Recommendations are not wired up for this workspace.');
        }
        const items = await gatherRecommendations(ctx.sources, { storeId: asString(args.storeId) });
        const suggestions = suggestSafeActions(items, { limit: asLimit(args.limit, 10) });
        return { toolCallId: '', name: this.name, ok: true, output: suggestions };
      },
    },
    {
      name: 'generate_report',
      description: 'Generates a report (executive-dashboard, seo, kpi, trends, alerts).',
      permission: read,
      parameters: {
        type: 'object',
        properties: {
          kind: { type: 'string' },
          storeId: { type: 'string' },
          days: { type: 'number' },
          compare: { type: 'boolean' },
        },
      },
      async execute(args, ctx) {
        if (ctx.sources.reports === undefined) {
          return unavailable('Reporting is not wired up for this workspace.');
        }
        const report = await ctx.sources.reports.generateReport({
          kind: asString(args.kind),
          storeId: asString(args.storeId),
          days: args.days === undefined ? undefined : asLimit(args.days, 30),
          compare: asBool(args.compare),
        });
        return {
          toolCallId: '',
          name: this.name,
          ok: true,
          output: {
            id: report.id,
            name: report.name,
            kind: report.kind,
            period: report.period,
            generatedAt: report.generatedAt,
            kpis: report.kpis,
            sections: report.sections.map((section) => ({
              kind: section.kind,
              title: section.title,
              metrics: section.metrics,
            })),
          },
        };
      },
    },
  ];
}
