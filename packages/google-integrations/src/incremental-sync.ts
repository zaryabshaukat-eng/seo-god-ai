/**
 * Incremental sync engine.
 *
 * Runs provider-specific syncs against Google, resuming from the last
 * persisted cursor so only the delta since the previous run is fetched.
 * Every run persists its checkpoint, emits an outbox event (best-effort)
 * and never throws: failures are captured in the returned result so the
 * caller always gets a total function.
 */

import type { Logger } from '@seogod/logging';
import type {
  AnalyticsClient,
  IndexingClient,
  PageSpeedClient,
  RichResultsClient,
  SearchConsoleClient,
} from './clients.js';
import type { GoogleEventInput, GoogleEventPublisher } from './events.js';
import type { GoogleMetrics } from './metrics.js';
import type {
  GoogleSyncRepository,
  SyncState,
} from './repository.js';
import type {
  Ga4RunReportQuery,
  GoogleProvider,
  IndexingNotificationType,
  PageSpeedStrategy,
} from './types.js';

export interface SyncClients {
  searchConsole: SearchConsoleClient;
  analytics: AnalyticsClient;
  pageSpeed: PageSpeedClient;
  richResults: RichResultsClient;
  indexing: IndexingClient;
}

export interface SyncDependencies {
  repository: GoogleSyncRepository;
  clients: SyncClients;
  /** Outbox publisher; sync events are skipped when omitted. */
  publisher?: GoogleEventPublisher;
  logger: Logger;
  metrics?: GoogleMetrics;
  /** Clock injection for deterministic tests. */
  now?: () => Date;
  /** How far back to look on the first run (no cursor yet). Default 30 days. */
  firstRunWindowDays?: number;
}

export interface SyncRequest {
  provider: GoogleProvider;
  /** Account whose credential authorizes the request. */
  account: string;
  /** Data resource being synced (site URL, property id, page URL, ...). */
  resource: string;
  /** Pre-resolved, valid access token (resolved by the caller). */
  accessToken?: string;
  /** Target page URL for page-speed / rich-results / indexing syncs. */
  url?: string;
  /** PageSpeed strategy. Default `mobile`. */
  strategy?: PageSpeedStrategy;
  /** Indexing notification type. Default `URL_UPDATED`. */
  indexingType?: IndexingNotificationType;
  /** Window start for the first search-console / analytics run. */
  startDate?: string;
  /** Window end for search-console / analytics runs. Defaults to today. */
  endDate?: string;
  /** Optional API key for public (page-speed / rich-results) endpoints. */
  apiKey?: string;
  /** Maximum rows requested from the APIs. */
  maxRows?: number;
}

export interface SyncRunResult {
  provider: GoogleProvider;
  resource: string;
  status: 'SUCCESS' | 'FAILED';
  /** New checkpoint after the run. */
  cursor: string;
  rowsProcessed: number;
  data?: unknown;
  error?: string;
}

const DEFAULT_FIRST_RUN_WINDOW_DAYS = 30;

export class IncrementalSync {
  private readonly repository: GoogleSyncRepository;
  private readonly clients: SyncClients;
  private readonly publisher?: GoogleEventPublisher;
  private readonly logger: Logger;
  private readonly metrics?: GoogleMetrics;
  private readonly now: () => Date;
  private readonly firstRunWindowDays: number;

  constructor(deps: SyncDependencies) {
    this.repository = deps.repository;
    this.clients = deps.clients;
    this.publisher = deps.publisher;
    this.logger = deps.logger;
    this.metrics = deps.metrics;
    this.now = deps.now ?? (() => new Date());
    this.firstRunWindowDays = deps.firstRunWindowDays ?? DEFAULT_FIRST_RUN_WINDOW_DAYS;
  }

  /** Runs an incremental sync, resuming from the last stored cursor. */
  async run(request: SyncRequest): Promise<SyncRunResult> {
    const startedAt = this.now().getTime();
    const previous = await this.repository.getState(request.provider, request.resource);

    try {
      const outcome = await this.perform(request, previous);
      const state: SyncState = {
        provider: request.provider,
        resource: request.resource,
        cursor: outcome.cursor,
        lastSyncedAt: new Date(startedAt).toISOString(),
        status: 'SYNCED',
      };
      await this.repository.saveState(state);
      await this.publishBestEffort(outcome.event, request);
      this.metrics?.syncs();
      this.metrics?.rowsProcessed(outcome.rowsProcessed);
      this.metrics?.setSyncDurationSeconds((this.now().getTime() - startedAt) / 1000);

      return {
        provider: request.provider,
        resource: request.resource,
        status: 'SUCCESS',
        cursor: outcome.cursor,
        rowsProcessed: outcome.rowsProcessed,
        data: outcome.data,
      };
    } catch (err) {
      return this.fail(request, previous, err, startedAt);
    }
  }

  private async perform(
    request: SyncRequest,
    previous: SyncState | null,
  ): Promise<{ cursor: string; rowsProcessed: number; data: unknown; event: GoogleEventInput }> {
    switch (request.provider) {
      case 'search-console':
        return this.syncSearchConsole(request, previous);
      case 'analytics':
        return this.syncAnalytics(request, previous);
      case 'pagespeed':
        return this.syncPageSpeed(request);
      case 'rich-results':
        return this.syncRichResults(request);
      case 'indexing':
        return this.syncIndexing(request);
    }
  }

  private async syncSearchConsole(
    request: SyncRequest,
    previous: SyncState | null,
  ): Promise<{ cursor: string; rowsProcessed: number; data: unknown; event: GoogleEventInput }> {
    const window = this.windowFor(previous, request);
    const response = await this.clients.searchConsole.searchAnalytics(request.accessToken ?? '', request.resource, {
      startDate: window.startDate,
      endDate: window.endDate,
      dimensions: ['date'],
      rowLimit: request.maxRows,
    });
    return {
      cursor: window.endDate,
      rowsProcessed: response.rows.length,
      data: response,
      event: {
        type: 'google.searchconsole.synced',
        provider: request.provider,
        resource: request.resource,
        payload: {
          siteUrl: request.resource,
          startDate: window.startDate,
          endDate: window.endDate,
          rowCount: response.rows.length,
          totalClicks: response.totalClicks,
          totalImpressions: response.totalImpressions,
        },
      },
    };
  }

  private async syncAnalytics(
    request: SyncRequest,
    previous: SyncState | null,
  ): Promise<{ cursor: string; rowsProcessed: number; data: unknown; event: GoogleEventInput }> {
    const window = this.windowFor(previous, request);
    const query: Ga4RunReportQuery = {
      dateRanges: [{ startDate: window.startDate, endDate: window.endDate }],
      dimensions: [{ name: 'date' }],
      metrics: [
        { name: 'sessions' },
        { name: 'totalUsers' },
        { name: 'screenPageViews' },
      ],
      limit: request.maxRows,
    };
    const response = await this.clients.analytics.runReport(request.accessToken ?? '', request.resource, query);
    return {
      cursor: window.endDate,
      rowsProcessed: response.rows.length,
      data: response,
      event: {
        type: 'google.analytics.synced',
        provider: request.provider,
        resource: request.resource,
        payload: {
          propertyId: request.resource,
          startDate: window.startDate,
          endDate: window.endDate,
          rowCount: response.rows.length,
        },
      },
    };
  }

  private async syncPageSpeed(
    request: SyncRequest,
  ): Promise<{ cursor: string; rowsProcessed: number; data: unknown; event: GoogleEventInput }> {
    if (!request.url) {
      throw new Error('url is required for pagespeed sync');
    }
    const result = await this.clients.pageSpeed.analyze(
      { url: request.url, strategy: request.strategy ?? 'mobile' },
      request.apiKey,
    );
    return {
      cursor: this.todayIso(),
      rowsProcessed: 1,
      data: result,
      event: {
        type: 'google.pagespeed.completed',
        provider: request.provider,
        resource: request.resource,
        payload: {
          url: request.url,
          strategy: result.strategy,
          fetchedAt: result.fetchedAt,
          scores: result.scores,
        },
      },
    };
  }

  private async syncRichResults(
    request: SyncRequest,
  ): Promise<{ cursor: string; rowsProcessed: number; data: unknown; event: GoogleEventInput }> {
    if (!request.url) {
      throw new Error('url is required for rich-results sync');
    }
    const result = await this.clients.richResults.runTest({ url: request.url }, request.apiKey);
    return {
      cursor: this.todayIso(),
      rowsProcessed: 1,
      data: result,
      event: {
        type: 'google.richresults.completed',
        provider: request.provider,
        resource: request.resource,
        payload: { url: request.url, testId: result.testId, status: result.status },
      },
    };
  }

  private async syncIndexing(
    request: SyncRequest,
  ): Promise<{ cursor: string; rowsProcessed: number; data: unknown; event: GoogleEventInput }> {
    if (!request.url) {
      throw new Error('url is required for indexing sync');
    }
    const result = await this.clients.indexing.notify(
      request.accessToken ?? '',
      request.url,
      request.indexingType ?? 'URL_UPDATED',
    );
    return {
      cursor: this.todayIso(),
      rowsProcessed: 1,
      data: result,
      event: {
        type: 'google.indexing.notified',
        provider: request.provider,
        resource: request.resource,
        payload: { url: request.url, type: request.indexingType ?? 'URL_UPDATED' },
      },
    };
  }

  private windowFor(
    previous: SyncState | null,
    request: SyncRequest,
  ): { startDate: string; endDate: string } {
    const endDate = request.endDate ?? this.todayIso();
    const startDate =
      request.startDate ??
      (previous?.cursor && looksLikeDate(previous.cursor) ? previous.cursor : this.daysAgoIso(this.firstRunWindowDays));
    return { startDate, endDate };
  }

  private async fail(
    request: SyncRequest,
    previous: SyncState | null,
    err: unknown,
    startedAt: number,
  ): Promise<SyncRunResult> {
    const message = err instanceof Error ? err.message : String(err);
    const state: SyncState = {
      provider: request.provider,
      resource: request.resource,
      cursor: previous?.cursor ?? '',
      lastSyncedAt: new Date(startedAt).toISOString(),
      status: 'FAILED',
      error: message,
    };
    await this.repository.saveState(state);
    await this.publishBestEffort(
      {
        type: 'google.sync.failed',
        provider: request.provider,
        resource: request.resource,
        payload: { provider: request.provider, resource: request.resource, error: message },
      },
      request,
    );
    this.metrics?.syncFailures();
    this.metrics?.setSyncDurationSeconds((this.now().getTime() - startedAt) / 1000);
    return {
      provider: request.provider,
      resource: request.resource,
      status: 'FAILED',
      cursor: previous?.cursor ?? '',
      rowsProcessed: 0,
      error: message,
    };
  }

  private async publishBestEffort(input: GoogleEventInput, request: SyncRequest): Promise<void> {
    if (!this.publisher) {
      return;
    }
    try {
      await this.publisher.publish(input);
    } catch (err) {
      this.logger.warn(
        { err, provider: request.provider, resource: request.resource, type: input.type },
        'google.event-publish-failed',
      );
    }
  }

  private todayIso(): string {
    return toIsoDate(this.now());
  }

  private daysAgoIso(days: number): string {
    const date = new Date(this.now().getTime() - days * 86_400_000);
    return toIsoDate(date);
  }
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function looksLikeDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}
