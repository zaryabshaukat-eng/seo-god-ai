/**
 * Platform composition root. Wires every `@seogod/*` package into a single
 * `Platform` object shared by the HTTP layer, workers and tests.
 *
 * All persistence is in-memory: the platform runs single-process without
 * external infrastructure. Each subsystem owns its store (crawler + event
 * bus share the fake Prisma datastore) so the composition stays explicit and
 * every test starts from a deterministic, resettable world.
 */

import { randomBytes } from 'node:crypto';
import type {
  CrawlJob,
  OutboxEvent,
  Page,
  PageLink,
  PageStructuredData,
  PrismaClient,
  SeoIssue,
} from '@prisma/client';
import {
  CopilotService,
  fromDecisionEngine,
  fromEnterprise,
  fromEnterpriseAudit,
  fromLearningEngine,
  fromMetricsRegistry,
  fromObservability,
  fromReportEngine,
  type ChatModel,
  type CopilotSources,
  type ModelRequest,
  type ModelStreamChunk,
} from '@seogod/ai-copilot';
import { loadConfig, type Config } from '@seogod/config';
import { CrawlOrchestrator, type CrawlResult } from '@seogod/crawler';
import { EnterpriseMetrics, EnterpriseService, type WebhookDeliverer } from '@seogod/enterprise';
import { EventBus } from '@seogod/events';
import { InMemoryLearningStore, LearningEngineService } from '@seogod/learning-engine';
import { createLogger, type Logger } from '@seogod/logging';
import { HealthRegistry, MetricsRegistry } from '@seogod/monitoring';
import { InMemoryObservabilityStore, ObservabilityService } from '@seogod/observability';
import {
  ReportEngineService,
  type DecisionLike,
  type ExecutionPlanLike,
  type GenerateReportRequest,
  type Report,
} from '@seogod/reports';
import { PluginRegistry, type PluginLogger } from '@seogod/plugin-sdk';
import { AuthService } from './auth.js';
import { ConflictError, NotFoundError } from './errors.js';
import { NotificationsService } from './notifications.js';
import { SettingsStore } from './settings.js';

export interface PlatformOptions {
  now?: () => Date;
  id?: () => string;
  fetchImpl?: typeof fetch;
  logger?: Logger;
  config?: Config;
  /** Chat model backing the AI Copilot. Defaults to the deterministic stub. */
  model?: ChatModel;
}

interface OutboxRow {
  id: string;
  type: string;
  aggregateType: string | null;
  aggregateId: string | null;
  payload: unknown;
  status: 'PENDING' | 'PROCESSING' | 'DONE' | 'FAILED';
  attempts: number;
  nextAttemptAt: Date;
  createdAt: Date;
  processedAt: Date | null;
}

/** In-memory Prisma surface used by the crawler and the outbox event bus. */
export class FakeDb {
  readonly jobs = new Map<string, CrawlJob>();
  readonly pages = new Map<string, Page>();
  readonly links: PageLink[] = [];
  readonly structuredData: PageStructuredData[] = [];
  readonly issues: SeoIssue[] = [];
  readonly outbox: OutboxRow[] = [];
  readonly prisma: PrismaClient;
  private jobSeq = 0;
  private pageSeq = 0;

  constructor(private readonly now: () => Date) {
    this.prisma = this.buildPrisma();
  }

  private buildPrisma(): PrismaClient {
    const crawlJob = {
      create: async (args: { data: { storeId: string; seeds?: unknown } }): Promise<CrawlJob> => {
        const job: CrawlJob = {
          id: `job-${++this.jobSeq}`,
          storeId: args.data.storeId,
          status: 'PENDING',
          totalPages: 0,
          seeds: (args.data.seeds as string[] | null) ?? null,
          statistics: null,
          error: null,
          createdAt: this.now(),
          startedAt: null,
          finishedAt: null,
        } as CrawlJob;
        this.jobs.set(job.id, job);
        return job;
      },
      findUnique: async (args: { where: { id: string } }): Promise<CrawlJob | null> =>
        this.jobs.get(args.where.id) ?? null,
      update: async (args: { where: { id: string }; data: Partial<CrawlJob> }): Promise<CrawlJob> => {
        const existing = this.jobs.get(args.where.id);
        if (existing === undefined) throw new Error(`CrawlJob ${args.where.id} not found`);
        const updated = { ...existing, ...args.data } as CrawlJob;
        this.jobs.set(args.where.id, updated);
        return updated;
      },
    };
    const page = {
      upsert: async (args: {
        where: { crawlJobId_url: { crawlJobId: string; url: string } };
        update: Record<string, unknown>;
        create: Record<string, unknown>;
      }): Promise<Page> => {
        const key = `${args.where.crawlJobId_url.crawlJobId}|${args.where.crawlJobId_url.url}`;
        const existing = this.pages.get(key);
        const record = {
          id: existing?.id ?? `page-${++this.pageSeq}`,
          ...existing,
          ...args.update,
          ...args.create,
          crawlJobId: args.where.crawlJobId_url.crawlJobId,
          url: args.where.crawlJobId_url.url,
        } as Page;
        this.pages.set(key, record);
        return record;
      },
      count: async (args: { where: { crawlJobId: string } }): Promise<number> =>
        [...this.pages.values()].filter((p) => p.crawlJobId === args.where.crawlJobId).length,
      findMany: async (args: {
        where: { crawlJobId: string };
        orderBy?: unknown;
        take?: number;
      }): Promise<Page[]> =>
        [...this.pages.values()]
          .filter((p) => p.crawlJobId === args.where.crawlJobId)
          .sort((a, b) => (a.url ?? '').localeCompare(b.url ?? ''))
          .slice(0, args.take),
    };
    const pageLink = {
      createMany: async (args: { data: Array<Partial<PageLink>> }): Promise<{ count: number }> => {
        for (const link of args.data) {
          this.links.push({ id: `link-${this.links.length}`, createdAt: this.now(), ...link } as PageLink);
        }
        return { count: args.data.length };
      },
    };
    const pageStructuredData = {
      createMany: async (args: {
        data: Array<Partial<PageStructuredData>>;
      }): Promise<{ count: number }> => {
        for (const block of args.data) {
          this.structuredData.push({
            id: `sd-${this.structuredData.length}`,
            createdAt: this.now(),
            ...block,
          } as PageStructuredData);
        }
        return { count: args.data.length };
      },
    };
    const seoIssue = {
      createMany: async (args: { data: Array<Partial<SeoIssue>> }): Promise<{ count: number }> => {
        for (const issue of args.data) {
          this.issues.push({ id: `issue-${this.issues.length}`, createdAt: this.now(), ...issue } as SeoIssue);
        }
        return { count: args.data.length };
      },
    };
    const outboxEvent = {
      create: async (args: {
        data: {
          type: string;
          aggregateType?: string;
          aggregateId?: string;
          payload?: unknown;
          nextAttemptAt: Date;
        };
      }): Promise<OutboxEvent> => {
        const row: OutboxRow = {
          id: `evt-${this.outbox.length + 1}`,
          type: args.data.type,
          aggregateType: args.data.aggregateType ?? null,
          aggregateId: args.data.aggregateId ?? null,
          payload: args.data.payload ?? null,
          status: 'PENDING',
          attempts: 0,
          nextAttemptAt: args.data.nextAttemptAt,
          createdAt: this.now(),
          processedAt: null,
        };
        this.outbox.push(row);
        return row as unknown as OutboxEvent;
      },
      findMany: async (args: {
        where: { status?: string; nextAttemptAt?: { lte?: Date } };
        orderBy?: unknown;
        take?: number;
      }): Promise<OutboxEvent[]> =>
        this.outbox
          .filter((row) => args.where.status === undefined || row.status === args.where.status)
          .filter(
            (row) =>
              args.where.nextAttemptAt?.lte === undefined ||
              row.nextAttemptAt.getTime() <= args.where.nextAttemptAt.lte.getTime(),
          )
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
          .slice(0, args.take)
          .map((row) => row as unknown as OutboxEvent),
      updateMany: async (args: {
        where: { id?: { in: string[] }; status?: string };
        data: Partial<OutboxRow>;
      }): Promise<{ count: number }> => {
        let count = 0;
        for (const row of this.outbox) {
          if (args.where.status !== undefined && row.status !== args.where.status) continue;
          if (args.where.id?.in !== undefined && !args.where.id.in.includes(row.id)) continue;
          Object.assign(row, args.data);
          count += 1;
        }
        return { count };
      },
      update: async (args: { where: { id: string }; data: Partial<OutboxRow> }): Promise<OutboxEvent> => {
        const row = this.outbox.find((r) => r.id === args.where.id);
        if (row === undefined) throw new Error(`OutboxEvent ${args.where.id} not found`);
        Object.assign(row, args.data);
        return row as unknown as OutboxEvent;
      },
    };
    return { crawlJob, page, pageLink, pageStructuredData, seoIssue, outboxEvent } as unknown as PrismaClient;
  }

  reset(): void {
    this.jobs.clear();
    this.pages.clear();
    this.links.length = 0;
    this.structuredData.length = 0;
    this.issues.length = 0;
    this.outbox.length = 0;
    this.jobSeq = 0;
    this.pageSeq = 0;
  }
}

/** In-memory decision/plan reader used by reports and the copilot. */
export class InMemoryDecisionReader {
  private readonly decisions = new Map<string, DecisionLike>();
  private readonly plans = new Map<string, ExecutionPlanLike>();

  listPlans(storeId?: string): Promise<ExecutionPlanLike[]> {
    const rows = [...this.plans.values()].filter((plan) => storeId === undefined || plan.storeId === storeId);
    return Promise.resolve(rows);
  }

  getDecision(id: string): Promise<DecisionLike | null> {
    return Promise.resolve(this.decisions.get(id) ?? null);
  }

  ingestDecision(decision: DecisionLike): void {
    this.decisions.set(decision.id, decision);
  }

  ingestPlan(plan: ExecutionPlanLike): void {
    this.plans.set(plan.id, plan);
  }

  reset(): void {
    this.decisions.clear();
    this.plans.clear();
  }
}

function randomHex(bytes: number): string {
  return randomBytes(bytes).toString('hex');
}

/**
 * Deterministic demo model. Emits a fixed text reply so the copilot streams
 * without an external provider; tool calls are still exercised because the
 * default tool set runs against the wired platform sources.
 */
function createStubChatModel(): ChatModel {
  return {
    name: 'seogod-stub',
    models: ['seogod-demo'],
    async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
      const lastUser = [...request.messages].reverse().find((message) => message.role === 'user');
      const content = lastUser?.content ?? '';
      const text = `I am the demo assistant. You asked: ${content}`;
      yield { type: 'delta', text };
      yield {
        type: 'done',
        response: {
          text,
          toolCalls: [],
          usage: { promptTokens: 1, completionTokens: text.length, totalTokens: text.length + 1 },
          model: 'seogod-demo',
        },
      };
    },
  };
}

/** Delivers webhook payloads over HTTP(S) through the platform fetch impl. */
function createHttpWebhookDeliverer(fetchImpl: typeof fetch): WebhookDeliverer {
  return {
    async deliver(endpoint, _event, headers, body) {
      const response = await fetchImpl(endpoint.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body,
      });
      return { status: response.status };
    },
  };
}

export class Platform {
  readonly config: Config;
  readonly logger: Logger;
  readonly metrics: MetricsRegistry;
  readonly health: HealthRegistry;
  readonly db: FakeDb;
  readonly eventBus: EventBus;
  readonly enterprise: EnterpriseService;
  readonly auth: AuthService;
  readonly observabilityStore: InMemoryObservabilityStore;
  readonly observability: ObservabilityService;
  readonly learningStore: InMemoryLearningStore;
  readonly learning: LearningEngineService;
  readonly decision: InMemoryDecisionReader;
  readonly reports: ReportEngineService;
  readonly copilot: CopilotService;
  readonly crawler: CrawlOrchestrator;
  readonly notifications: NotificationsService;
  readonly settings: SettingsStore;
  /** Plugin registry hosting installed `@seogod/plugin-sdk` extensions. */
  plugins: PluginRegistry;
  readonly reportStore = new Map<string, Report>();
  readonly acknowledgedAlerts = new Set<string>();
  readonly recommendationOverrides = new Map<string, Record<string, unknown>>();
  readonly executionStates = new Map<string, Record<string, unknown>>();
  readonly now: () => Date;
  readonly id: () => string;

  constructor(options: PlatformOptions = {}) {
    this.config = options.config ?? loadConfig();
    this.now = options.now ?? (() => new Date());
    this.id = options.id ?? (() => randomHex(16));
    this.logger = options.logger ?? createLogger({ name: 'api', level: this.config.app.logLevel, nodeEnv: this.config.app.nodeEnv });
    const fetchImpl = options.fetchImpl ?? globalThis.fetch;

    this.metrics = new MetricsRegistry();
    this.health = new HealthRegistry();
    this.db = new FakeDb(this.now);
    this.eventBus = new EventBus(this.db.prisma, { now: this.now });

    this.enterprise = new EnterpriseService({
      now: () => this.now().toISOString(),
      id: this.id,
      webhookDeliverer: createHttpWebhookDeliverer(fetchImpl),
      metrics: new EnterpriseMetrics(this.metrics),
    });

    this.auth = new AuthService(this.enterprise, {
      now: () => this.now().getTime(),
      id: this.id,
    });

    this.observabilityStore = new InMemoryObservabilityStore();
    this.observability = new ObservabilityService(this.observabilityStore, {
      now: () => this.now().toISOString(),
      metrics: this.metrics,
    });

    this.learningStore = new InMemoryLearningStore();
    this.learning = new LearningEngineService({
      store: this.learningStore,
      now: () => this.now().toISOString(),
      metrics: this.metrics,
    });

    this.decision = new InMemoryDecisionReader();

    this.reports = new ReportEngineService({
      sources: {
        observability: this.observabilityStore,
        learning: this.learning,
        decision: this.decision,
      },
      registry: this.metrics,
      onScheduleRun: async (_definition, report) => {
        this.reportStore.set(report.id, report);
      },
    });

    this.notifications = new NotificationsService({
      now: () => this.now().toISOString(),
      id: this.id,
    });
    this.settings = new SettingsStore();
    this.plugins = this.createPluginRegistry();

    this.copilot = new CopilotService({
      model: options.model ?? createStubChatModel(),
      sources: this.copilotSources(),
      authorize: fromEnterprise((role, permission, context) =>
        this.enterprise.authorize(role, permission, context),
      ),
      audit: fromEnterpriseAudit(this.enterprise.audit),
      metrics: fromMetricsRegistry(this.metrics),
      now: () => this.now().toISOString(),
      id: this.id,
    });
    this.crawler = new CrawlOrchestrator(
      {
        prisma: this.db.prisma,
        logger: this.logger,
        metrics: this.metrics,
        eventBus: this.eventBus,
        now: this.now,
        fetchImpl: options.fetchImpl,
      },
      {
        userAgent: 'SeoGodBot/1.0',
        concurrency: 2,
        respectRobotsTxt: this.config.crawler.respectRobotsTxt,
        maxPages: this.config.crawler.maxPages,
        rateLimitMs: this.config.crawler.rateLimitMs,
        fetchTimeoutMs: 10_000,
        maxRetries: 2,
      },
    );

    this.health.register('platform.memory', () => {
      if (this.db.jobs.size < 0) throw new Error('unreachable');
    });
    this.health.register('platform.event-bus', async () => {
      await this.eventBus.processNext(1);
    });
  }

  private createPluginRegistry(): PluginRegistry {
    const logger: PluginLogger = {
      info: (message) => this.logger.info({}, message),
      warn: (message) => this.logger.warn({}, message),
      error: (message) => this.logger.error({}, message),
    };
    return new PluginRegistry({
      logger,
      sdkVersion: '0.3.6',
      apiVersion: '0.3.6',
    });
  }

  private copilotSources(): CopilotSources {
    return {
      observability: fromObservability(this.observability),
      learning: fromLearningEngine(this.learning),
      reports: fromReportEngine(this.reports),
      decision: fromDecisionEngine({
        listPlans: async (storeId) => {
          const plans = await this.decision.listPlans(storeId);
          return plans.map((plan) => ({
            id: plan.id,
            status: plan.status,
            risk: plan.risk,
            taskCount: plan.tasks.length,
            totalImpact: plan.totalImpact,
            createdAt: plan.createdAt.toISOString(),
            updatedAt: plan.updatedAt.toISOString(),
          }));
        },
      }),
    };
  }

  async startCrawl(storeId: string, seeds: string[]): Promise<CrawlResult> {
    return this.crawler.crawl(storeId, seeds);
  }

  listCrawlJobs(): CrawlJob[] {
    return [...this.db.jobs.values()].sort(
      (a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0),
    );
  }

  getCrawlJob(id: string): CrawlJob | null {
    return this.db.jobs.get(id) ?? null;
  }

  cancelCrawl(id: string): CrawlJob {
    const job = this.db.jobs.get(id);
    if (job === undefined) {
      throw new NotFoundError(`Crawl job '${id}' not found.`);
    }
    if (job.status === 'COMPLETED' || job.status === 'FAILED' || job.status === 'CANCELLED') {
      throw new ConflictError(`Crawl job '${id}' is already ${job.status.toLowerCase()}.`);
    }
    const updated = { ...job, status: 'CANCELLED', finishedAt: this.now() } as CrawlJob;
    this.db.jobs.set(id, updated);
    return updated;
  }

  generateReport(request: GenerateReportRequest): Promise<Report> {
    return this.reports.generate(request);
  }

  runScheduledReports(now: Date = new Date()) {
    return this.reports.runScheduled(now);
  }

  processEvents(batchSize = 100): Promise<number> {
    return this.eventBus.processNext(batchSize);
  }

  /** Resets every owned store; call between tests or on admin reset. */
  async reset(): Promise<void> {
    await this.observability.reset();
    await this.observabilityStore.reset();
    await this.learningStore.reset();
    this.db.reset();
    this.decision.reset();
    this.auth.reset();
    this.metrics.reset();
    this.notifications.reset();
    this.settings.reset();
    this.plugins.dispose();
    this.plugins = this.createPluginRegistry();
    this.reportStore.clear();
    this.acknowledgedAlerts.clear();
    this.recommendationOverrides.clear();
    this.executionStates.clear();
  }
}
