import { describe, expect, it } from 'vitest';
import { createDefaultTools, runTool, ToolRegistry, type CopilotTool, type ToolContext } from './tools.js';
import { COPILOT_PERMISSIONS } from './permissions.js';
import type { CopilotRecommendation, CopilotSources } from './sources.js';
import type { ChatRequest, CopilotSession } from './types.js';

function recommendation(overrides: Partial<CopilotRecommendation> = {}): CopilotRecommendation {
  return {
    id: 'rec_1',
    rule: 'missing-title',
    title: 'Add missing titles',
    description: 'Pages without titles',
    rationale: 'Titles drive ranking',
    recommendedAction: 'Add a title tag',
    priority: 'medium',
    score: 60,
    impact: 'medium',
    effort: 'low',
    confidence: 0.8,
    affectedUrls: ['/a'],
    pageCount: 1,
    ...overrides,
  };
}

function session(): CopilotSession {
  return {
    sessionId: 'conv_1',
    tenantId: 'tenant_a',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    messages: [],
  };
}

function request(): ChatRequest {
  return { message: 'hi', tenantId: 'tenant_a', role: 'member' };
}

function makeSources(overrides: Partial<CopilotSources> = {}): CopilotSources {
  return {
    recommendations: {
      async listRecommendations(filter = {}) {
        const items = [recommendation({ id: 'r1', title: 'Titles', rule: 'missing-title' }), recommendation({ id: 'r2', title: 'Descriptions', rule: 'missing-description', score: 80 })];
        const filtered = filter.rule === undefined ? items : items.filter((item) => item.rule === filter.rule);
        const limit = filter.limit === undefined ? filtered.length : Math.min(filter.limit, filtered.length);
        return filtered.slice(0, limit);
      },
    },
    observability: {
      async overview() {
        return { storeCount: 1, executionCount: 0, activeExecutionCount: 0, completedCount: 0, failedCount: 0, rolledBackCount: 0, alertCount: 0, openAlertCount: 0, latestSeoScore: 71, latestExecutionAt: null, successRate: 0 };
      },
      async crawlSummary() {
        return { latestScore: 71, previousScore: 68, delta: 3, pagesCrawled: 100, totalIssues: 4, brokenLinks: 0, snapshots: 2 };
      },
      async executionSummary() {
        return { totalExecutions: 2, queued: 0, executing: 0, completed: 1, failed: 1, cancelled: 0, rolledBack: 0, successRate: 0.5, failureRate: 0.5, rollbackRate: 0, averageExecutionTimeMs: 100, p95ExecutionTimeMs: 200, validationFailures: 0, safetyViolations: 0, totalRollbacks: 0, crawlSuccessRate: 1, simulated: 0 };
      },
      async alerts() {
        return { total: 1, critical: 1, warning: 0, info: 0, items: [{ alertId: 'a1', type: 'seo_regression', severity: 'critical', message: 'dropped', triggeredAt: '2026-01-01T00:00:00.000Z' }] };
      },
    },
    decision: {
      async listPlans() {
        return [{ id: 'plan_1', status: 'APPROVED', risk: 'LOW', taskCount: 2, totalImpact: 30, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }];
      },
    },
    reports: {
      async generateReport(input) {
        return {
          id: 'rep_1',
          name: input.kind ?? 'dashboard',
          kind: input.kind ?? 'executive-dashboard',
          period: { startDate: '2026-01-01', endDate: '2026-01-31' },
          generatedAt: '2026-01-31T00:00:00.000Z',
          sections: [{ kind: 'kpis', title: 'KPIs', metrics: [{ label: 'Score', value: 71 }] }],
          kpis: [{ key: 'score', label: 'Score', value: 71, previousValue: 68, changePercent: 4.4, status: 'improved' }],
          alerts: null,
        };
      },
    },
    ...overrides,
  };
}

function ctx(sources: CopilotSources): ToolContext {
  return { sources, session: session(), request: request() };
}

describe('ToolRegistry', () => {
  const tool: CopilotTool = {
    name: 'a',
    description: 'A tool',
    permission: 'org.read',
    parameters: { type: 'object', properties: {} },
    async execute() {
      return { toolCallId: '', name: 'a', ok: true, output: {} };
    },
  };

  it('registers, gets, lists and removes tools', () => {
    const registry = new ToolRegistry();
    expect(registry.register(tool)).toBe(registry);
    expect(registry.has('a')).toBe(true);
    expect(registry.get('a')).toBe(tool);
    expect(registry.get('nope')).toBeUndefined();
    expect(registry.list()).toEqual([tool]);
    expect(registry.toolSchemas()[0]).toEqual({ name: 'a', description: 'A tool', parameters: tool.parameters });
    expect(registry.remove('a')).toBe(true);
    expect(registry.has('a')).toBe(false);
  });

  it('registers multiple tools via registerAll', () => {
    const registry = new ToolRegistry();
    registry.registerAll([tool, { ...tool, name: 'b' }]);
    expect(registry.list()).toHaveLength(2);
  });

  it('defaults missing parameter schemas to empty objects', () => {
    const registry = new ToolRegistry();
    registry.register({ ...tool, name: 'no-params', parameters: undefined });
    expect(registry.toolSchemas()).toEqual([
      { name: 'no-params', description: 'A tool', parameters: {} },
    ]);
  });
});

describe('runTool', () => {
  it('returns the tool result', async () => {
    const tool: CopilotTool = {
      name: 't',
      description: 't',
      permission: 'org.read',
      async execute() {
        return { toolCallId: '', name: 't', ok: true, output: { done: true } };
      },
    };
    const result = await runTool(tool, {}, ctx(makeSources()));
    expect(result.ok).toBe(true);
    expect(result.output).toEqual({ done: true });
  });

  it('normalizes thrown errors into failed results', async () => {
    const tool: CopilotTool = {
      name: 't',
      description: 't',
      permission: 'org.read',
      async execute() {
        throw new Error('kaboom');
      },
    };
    const result = await runTool(tool, {}, ctx(makeSources()));
    expect(result.ok).toBe(false);
    expect(result.error).toBe('kaboom');
  });

  it('normalizes non-error throws into a fallback message', async () => {
    const tool: CopilotTool = {
      name: 't',
      description: 't',
      permission: 'org.read',
      async execute() {
        throw 'raw-string';
      },
    };
    const result = await runTool(tool, {}, ctx(makeSources()));
    expect(result.ok).toBe(false);
    expect(result.error).toBe('Tool execution failed.');
  });
});

describe('createDefaultTools', () => {
  const tools = createDefaultTools();

  it('exposes the standard tool set', () => {
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'explain_recommendation',
      'generate_optimization_plan',
      'generate_report',
      'get_alerts',
      'interpret_metrics',
      'list_plans',
      'list_recommendations',
      'suggest_safe_actions',
      'summarize_crawl',
      'summarize_execution',
    ]);
  });

  it('protects mutating tools behind manage permissions', () => {
    const byName = new Map(tools.map((tool) => [tool.name, tool]));
    expect(byName.get('generate_optimization_plan')?.permission).toBe(COPILOT_PERMISSIONS.manage);
    expect(byName.get('suggest_safe_actions')?.permission).toBe(COPILOT_PERMISSIONS.manage);
    expect(byName.get('list_recommendations')?.permission).toBe(COPILOT_PERMISSIONS.read);
    expect(byName.get('generate_report')?.permission).toBe(COPILOT_PERMISSIONS.read);
  });

  it('lists recommendations', async () => {
    const tool = createDefaultTools().find((t) => t.name === 'list_recommendations');
    const result = await tool?.execute({ storeId: 'store_1', limit: 1 }, ctx(makeSources()));
    expect(result?.ok).toBe(true);
    expect((result?.output as Array<{ id: string }>)).toHaveLength(1);
  });

  it('degrades when recommendations are absent', async () => {
    const tool = createDefaultTools().find((t) => t.name === 'list_recommendations');
    const result = await tool?.execute({}, ctx(makeSources({ recommendations: undefined })));
    expect(result?.ok).toBe(false);
    expect(result?.error).toContain('not wired');
  });

  it('explains a recommendation by id', async () => {
    const tool = createDefaultTools().find((t) => t.name === 'explain_recommendation');
    const result = await tool?.execute({ id: 'r1' }, ctx(makeSources()));
    expect(result?.ok).toBe(true);
    expect((result?.output as { id: string }).id).toBe('r1');
  });

  it('explains a recommendation by rule', async () => {
    const tool = createDefaultTools().find((t) => t.name === 'explain_recommendation');
    const result = await tool?.execute({ rule: 'missing-description' }, ctx(makeSources()));
    expect(result?.ok).toBe(true);
    expect((result?.output as { rule: string }).rule).toBe('missing-description');
  });

  it('fails to explain unknown recommendations', async () => {
    const tool = createDefaultTools().find((t) => t.name === 'explain_recommendation');
    const result = await tool?.execute({ id: 'nope' }, ctx(makeSources()));
    expect(result?.ok).toBe(false);
    expect(result?.error).toContain('not found');
  });

  it('fails to explain unknown recommendations by rule', async () => {
    const tool = createDefaultTools().find((t) => t.name === 'explain_recommendation');
    const result = await tool?.execute({ rule: 'nope' }, ctx(makeSources()));
    expect(result?.ok).toBe(false);
    expect(result?.error).toContain('nope');
  });

  it('degrades when explaining without recommendations', async () => {
    const tool = createDefaultTools().find((t) => t.name === 'explain_recommendation');
    const result = await tool?.execute({ id: 'r1' }, ctx(makeSources({ recommendations: undefined })));
    expect(result?.ok).toBe(false);
    expect(result?.error).toContain('not wired');
  });

  it('interprets metrics', async () => {
    const tool = createDefaultTools().find((t) => t.name === 'interpret_metrics');
    const result = await tool?.execute({}, ctx(makeSources()));
    expect(result?.ok).toBe(true);
    expect((result?.output as { overview: { latestSeoScore: number } }).overview.latestSeoScore).toBe(71);
  });

  it('degrades when observability is absent', async () => {
    const tool = createDefaultTools().find((t) => t.name === 'interpret_metrics');
    const result = await tool?.execute({}, ctx(makeSources({ observability: undefined })));
    expect(result?.ok).toBe(false);
  });

  it('degrades crawl, execution and alerts tools when observability is absent', async () => {
    const sources = makeSources({ observability: undefined });
    for (const name of ['summarize_crawl', 'summarize_execution', 'get_alerts']) {
      const tool = createDefaultTools().find((t) => t.name === name);
      const result = await tool?.execute({}, ctx(sources));
      expect(result?.ok).toBe(false);
      expect(result?.error).toContain('not wired');
    }
  });

  it('summarizes crawls and executions', async () => {
    const crawl = await createDefaultTools().find((t) => t.name === 'summarize_crawl')?.execute({}, ctx(makeSources()));
    const execution = await createDefaultTools().find((t) => t.name === 'summarize_execution')?.execute({}, ctx(makeSources()));
    expect((crawl?.output as { latestScore: number }).latestScore).toBe(71);
    expect((execution?.output as { totalExecutions: number }).totalExecutions).toBe(2);
  });

  it('lists alerts', async () => {
    const tool = createDefaultTools().find((t) => t.name === 'get_alerts');
    const result = await tool?.execute({ limit: 5 }, ctx(makeSources()));
    expect((result?.output as { total: number }).total).toBe(1);
  });

  it('lists plans', async () => {
    const tool = createDefaultTools().find((t) => t.name === 'list_plans');
    const result = await tool?.execute({}, ctx(makeSources()));
    expect(result?.ok).toBe(true);
    expect((result?.output as Array<{ id: string }>)[0]?.id).toBe('plan_1');
  });

  it('degrades when planning is absent', async () => {
    const tool = createDefaultTools().find((t) => t.name === 'list_plans');
    const result = await tool?.execute({}, ctx(makeSources({ decision: undefined })));
    expect(result?.ok).toBe(false);
    expect(result?.error).toContain('not wired');
  });

  it('generates an optimization plan', async () => {
    const tool = createDefaultTools().find((t) => t.name === 'generate_optimization_plan');
    const result = await tool?.execute({}, ctx(makeSources()));
    expect(result?.ok).toBe(true);
    expect((result?.output as { summary: { count: number } }).summary.count).toBe(2);
  });

  it('suggests safe actions', async () => {
    const tool = createDefaultTools().find((t) => t.name === 'suggest_safe_actions');
    const result = await tool?.execute({ limit: 10 }, ctx(makeSources()));
    expect(result?.ok).toBe(true);
    expect((result?.output as Array<{ suggestedAction: string }>).length).toBeGreaterThan(0);
  });

  it('degrades the planning tools when recommendations are absent', async () => {
    const sources = makeSources({ recommendations: undefined });
    for (const name of ['generate_optimization_plan', 'suggest_safe_actions']) {
      const tool = createDefaultTools().find((t) => t.name === name);
      const result = await tool?.execute({}, ctx(sources));
      expect(result?.ok).toBe(false);
      expect(result?.error).toContain('not wired');
    }
  });

  it('generates a report', async () => {
    const tool = createDefaultTools().find((t) => t.name === 'generate_report');
    const result = await tool?.execute({ kind: 'kpi', days: 7 }, ctx(makeSources()));
    expect(result?.ok).toBe(true);
    const output = result?.output as { kind: string; sections: Array<{ title: string }> };
    expect(output.kind).toBe('kpi');
    expect(output.sections[0]?.title).toBe('KPIs');
  });

  it('generates a report without optional arguments', async () => {
    const tool = createDefaultTools().find((t) => t.name === 'generate_report');
    const result = await tool?.execute({ compare: true }, ctx(makeSources()));
    expect(result?.ok).toBe(true);
  });

  it('degrades when reports are absent', async () => {
    const tool = createDefaultTools().find((t) => t.name === 'generate_report');
    const result = await tool?.execute({}, ctx(makeSources({ reports: undefined })));
    expect(result?.ok).toBe(false);
  });

  it('forwards tool schemas to the model', () => {
    const schemas = new ToolRegistry(createDefaultTools()).toolSchemas();
    expect(schemas.length).toBe(10);
    for (const schema of schemas) {
      expect(schema.name.length).toBeGreaterThan(0);
      expect(typeof schema.parameters).toBe('object');
    }
  });
});
