/**
 * The single entry point for talking to Google.
 *
 * Wires OAuth, credential management, the five API clients, incremental
 * sync and outbox event publishing together behind one facade. The rest of
 * the application must never call Google's REST APIs directly; everything
 * goes through this service so tokens, rate limits, retries and errors stay
 * consistent.
 */

import { createLogger, type Logger } from '@seogod/logging';
import type { EventBus } from '@seogod/events';
import type { MetricsRegistry } from '@seogod/monitoring';
import {
  AnalyticsClient,
  IndexingClient,
  PageSpeedClient,
  RichResultsClient,
  SearchConsoleClient,
  ANALYTICS_BASE_URL,
  INDEXING_BASE_URL,
  PAGESPEED_BASE_URL,
  RICH_RESULTS_BASE_URL,
  SEARCH_CONSOLE_BASE_URL,
  type PageSpeedQuery,
  type RichResultsRunTestInput,
} from './clients.js';
import {
  CredentialManager,
  EncryptedCredentialStorage,
  MemoryCredentialStorage,
  type CredentialStorage,
} from './credentials.js';
import { GoogleApiError, GoogleAuthError, GoogleValidationError } from './errors.js';
import { EventBusPublisher, type GoogleEventPublisher } from './events.js';
import { GoogleHttpClient } from './http-client.js';
import { IncrementalSync, type SyncClients, type SyncRequest, type SyncRunResult } from './incremental-sync.js';
import { GoogleMetrics } from './metrics.js';
import { GoogleOAuth, type BuildAuthorizationUrlInput } from './oauth.js';
import { MemoryGoogleSyncRepository, type GoogleSyncRepository } from './repository.js';
import type {
  Ga4RunReportQuery,
  Ga4RunReportResponse,
  GoogleProvider,
  GscSite,
  IndexingNotificationResponse,
  IndexingNotificationType,
  PageSpeedResult,
  RichResultsRunTestResponse,
  RichResultsTestStatusResponse,
  SearchAnalyticsQuery,
  SearchAnalyticsResponse,
  SitemapEntry,
  StoredCredential,
} from './types.js';

/** Scopes required to read the profile when identifying the account. */
export const GOOGLE_PROFILE_SCOPES = [
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
] as const;

/** Minimal, safe per-provider scope sets. Widen deliberately, never blindly. */
export const DEFAULT_PROVIDER_SCOPES: Record<GoogleProvider, readonly string[]> = {
  'search-console': ['https://www.googleapis.com/auth/webmasters.readonly'],
  analytics: ['https://www.googleapis.com/auth/analytics.readonly'],
  pagespeed: [],
  'rich-results': [],
  indexing: ['https://www.googleapis.com/auth/indexing'],
};

const AUTH_REQUIRING_PROVIDERS: readonly GoogleProvider[] = ['search-console', 'analytics', 'indexing'];

export interface GoogleIntegrationsServiceOptions {
  /** Google OAuth client ID. */
  clientId: string;
  /** Google OAuth client secret. Never log or commit this. */
  clientSecret: string;
  /** Redirect URI registered with the OAuth client. */
  redirectUri: string;
  /** Per-provider default scopes. Defaults to {@link DEFAULT_PROVIDER_SCOPES}. */
  scopes?: Partial<Record<GoogleProvider, readonly string[]>>;
  /** Credential persistence. Defaults to in-memory (tests/development). */
  credentialStorage?: CredentialStorage;
  /**
   * 32-byte AES key that enables at-rest encryption of stored credentials
   * (64-char hex string or Buffer). Defaults to plain in-memory storage.
   */
  credentialEncryptionKey?: string | Buffer;
  /** Sync checkpoint persistence. Defaults to in-memory. */
  syncRepository?: GoogleSyncRepository;
  /** Injectable fetch for tests. Defaults to the global fetch. */
  fetchImpl?: typeof fetch;
  maxRetries?: number;
  retryBackoffMs?: number;
  timeoutMs?: number;
  /** Outbox event bus; Google events are skipped when omitted. */
  eventBus?: Pick<EventBus, 'publish'>;
  logger?: Logger;
  metrics?: MetricsRegistry;
  /** Clock injection for deterministic tests. */
  now?: () => Date;
}

export interface BuildAuthorizationUrlInputOptions {
  /** Anti-CSRF value you persist and verify on the callback. */
  state: string;
  /** Product to authorize. Defaults to the union of all provider scopes. */
  provider?: GoogleProvider;
  /** Overrides the provider's default scopes. */
  scopes?: string[];
  /** Overrides the config `redirectUri`. */
  redirectUri?: string;
  /** S256 PKCE challenge derived from a `codeVerifier` you keep. */
  codeChallenge?: string;
  accessType?: 'offline' | 'online';
  prompt?: 'consent' | 'select_account' | 'none';
}

export interface HandleOAuthCallbackInput {
  provider: GoogleProvider;
  /** OAuth `code` from the callback query. */
  code: string;
  /** OAuth `state` echoed by Google. */
  state: string;
  /** The `state` value you issued; verified when provided. */
  expectedState?: string;
  /** Optional `error` value present on declined flows. */
  error?: string;
  /** PKCE `codeVerifier` used when building the authorization URL. */
  codeVerifier?: string;
  /** Account key override (defaults to the profile email from userinfo). */
  account?: string;
}

export type SyncRequestInput = Omit<SyncRequest, 'accessToken'>;

/**
 * Facade over every Google integration. Construct once and reuse; tokens
 * are resolved and refreshed automatically through the credential manager.
 */
export class GoogleIntegrationsService {
  private readonly oauth: GoogleOAuth;
  private readonly credentialManager: CredentialManager;
  private readonly clients: SyncClients;
  private readonly publisher?: GoogleEventPublisher;
  private readonly syncEngine: IncrementalSync;

  constructor(options: GoogleIntegrationsServiceOptions) {
    if (!options.clientId || !options.clientSecret || !options.redirectUri) {
      throw new GoogleValidationError('clientId, clientSecret and redirectUri are required');
    }
    const fetchImpl = options.fetchImpl ?? fetch;
    const now = options.now;
    const logger = options.logger ?? createLogger({ level: 'silent' });
    const metrics = options.metrics ? new GoogleMetrics(options.metrics) : undefined;

    this.oauth = new GoogleOAuth({
      clientId: options.clientId,
      clientSecret: options.clientSecret,
      redirectUri: options.redirectUri,
      scopes: [],
      fetchImpl,
    });

    let credentialStorage: CredentialStorage =
      options.credentialStorage ?? new MemoryCredentialStorage();
    if (options.credentialEncryptionKey) {
      credentialStorage = new EncryptedCredentialStorage({
        delegate: credentialStorage,
        masterKey: options.credentialEncryptionKey,
      });
    }
    this.credentialManager = new CredentialManager({ oauth: this.oauth, storage: credentialStorage, now });

    const httpFor = (baseUrl: string) =>
      new GoogleHttpClient({
        baseUrl,
        fetchImpl,
        maxRetries: options.maxRetries,
        retryBackoffMs: options.retryBackoffMs,
        timeoutMs: options.timeoutMs,
        metrics,
      });

    const searchConsoleHttp = httpFor(SEARCH_CONSOLE_BASE_URL);
    const analyticsHttp = httpFor(ANALYTICS_BASE_URL);
    const pagespeedHttp = httpFor(PAGESPEED_BASE_URL);
    const richResultsHttp = httpFor(RICH_RESULTS_BASE_URL);
    const indexingHttp = httpFor(INDEXING_BASE_URL);

    this.clients = {
      searchConsole: new SearchConsoleClient(searchConsoleHttp),
      analytics: new AnalyticsClient(analyticsHttp),
      pageSpeed: new PageSpeedClient(pagespeedHttp),
      richResults: new RichResultsClient(richResultsHttp),
      indexing: new IndexingClient(indexingHttp),
    };

    this.publisher = options.eventBus ? new EventBusPublisher(options.eventBus) : undefined;
    this.syncEngine = new IncrementalSync({
      repository: options.syncRepository ?? new MemoryGoogleSyncRepository(),
      clients: this.clients,
      publisher: this.publisher,
      logger,
      metrics,
      now,
    });
  }

  // ------------------------------------------------------------------
  // OAuth
  // ------------------------------------------------------------------

  /** Builds the URL to send a user to for Google OAuth consent. */
  buildAuthorizationUrl(input: BuildAuthorizationUrlInputOptions): string {
    const scopes = input.scopes ?? this.scopesFor(input.provider);
    const base: BuildAuthorizationUrlInput = {
      state: input.state,
      redirectUri: input.redirectUri,
      scopes,
      codeChallenge: input.codeChallenge,
      accessType: input.accessType,
      prompt: input.prompt,
    };
    return this.oauth.buildAuthorizationUrl(base);
  }

  /**
   * Completes the OAuth handshake from the Google callback: verifies the
   * state, exchanges the code, identifies the account and persists the
   * credential.
   */
  async handleOAuthCallback(input: HandleOAuthCallbackInput): Promise<StoredCredential> {
    if (input.error) {
      throw new GoogleAuthError(`Google OAuth flow failed: ${input.error}`, {
        provider: input.provider,
        operation: 'handleOAuthCallback',
      });
    }
    if (!input.code) {
      throw new GoogleValidationError('OAuth callback is missing code', {
        provider: input.provider,
        operation: 'handleOAuthCallback',
      });
    }
    if (!this.oauth.validateState(input.state, input.expectedState)) {
      throw new GoogleAuthError('OAuth callback state mismatch', {
        provider: input.provider,
        operation: 'handleOAuthCallback',
      });
    }

    const tokens = await this.oauth.exchangeCode(input.code, {
      codeVerifier: input.codeVerifier,
    });
    const userInfo = await this.oauth.getUserInfo(tokens.accessToken);
    const account = input.account ?? userInfo.email;

    return this.credentialManager.storeTokens(input.provider, account, tokens);
  }

  // ------------------------------------------------------------------
  // Credentials
  // ------------------------------------------------------------------

  /** Returns the stored credential for a provider/account, or null. */
  async getCredentials(provider: GoogleProvider, account: string): Promise<StoredCredential | null> {
    return this.credentialManager.getValidTokens(provider, account).catch(() => null);
  }

  /** Removes a stored credential. */
  async disconnect(provider: GoogleProvider, account: string): Promise<void> {
    await this.credentialManager.delete(provider, account);
  }

  // ------------------------------------------------------------------
  // Incremental sync
  // ------------------------------------------------------------------

  /**
   * Runs an incremental sync. Tokens are resolved (and refreshed when
   * needed) automatically for authenticated providers. Returns a total
   * result: failures are reported, never thrown.
   */
  async sync(input: SyncRequestInput): Promise<SyncRunResult> {
    const accessToken = AUTH_REQUIRING_PROVIDERS.includes(input.provider)
      ? await this.requireToken(input.provider, input.account)
      : undefined;
    return this.syncEngine.run({ ...input, accessToken });
  }

  // ------------------------------------------------------------------
  // Direct client access
  // ------------------------------------------------------------------

  /** Lists every Search Console property the account can access. */
  async listSites(account: string): Promise<GscSite[]> {
    return this.clients.searchConsole.listSites(await this.requireToken('search-console', account));
  }

  /** Runs a Search Analytics query for a property. */
  async searchAnalytics(
    account: string,
    siteUrl: string,
    query: SearchAnalyticsQuery,
  ): Promise<SearchAnalyticsResponse> {
    return this.clients.searchConsole.searchAnalytics(
      await this.requireToken('search-console', account),
      siteUrl,
      query,
    );
  }

  /** Lists the sitemaps Google knows about for a property. */
  async listSitemaps(account: string, siteUrl: string): Promise<SitemapEntry[]> {
    return this.clients.searchConsole.listSitemaps(
      await this.requireToken('search-console', account),
      siteUrl,
    );
  }

  /** Submits a sitemap for a property. */
  async submitSitemap(account: string, siteUrl: string, feedpath: string): Promise<void> {
    await this.clients.searchConsole.submitSitemap(
      await this.requireToken('search-console', account),
      { siteUrl, feedpath },
    );
  }

  /** Runs a GA4 report for a property. */
  async runReport(
    account: string,
    propertyId: string,
    query: Ga4RunReportQuery,
  ): Promise<Ga4RunReportResponse> {
    return this.clients.analytics.runReport(
      await this.requireToken('analytics', account),
      propertyId,
      query,
    );
  }

  /** Runs a Lighthouse audit (public endpoint; no OAuth required). */
  async analyzePageSpeed(query: PageSpeedQuery, apiKey?: string): Promise<PageSpeedResult> {
    return this.clients.pageSpeed.analyze(query, apiKey);
  }

  /** Starts a Rich Results test (public endpoint; no OAuth required). */
  async runRichResultsTest(input: RichResultsRunTestInput, apiKey?: string): Promise<RichResultsRunTestResponse> {
    return this.clients.richResults.runTest(input, apiKey);
  }

  /** Reads the status of a Rich Results test. */
  async getRichResultsStatus(testId: string, apiKey?: string): Promise<RichResultsTestStatusResponse> {
    return this.clients.richResults.getTestStatus(testId, apiKey);
  }

  /** Notifies Google that a URL was updated or deleted. */
  async notifyIndexing(
    account: string,
    url: string,
    type: IndexingNotificationType = 'URL_UPDATED',
  ): Promise<IndexingNotificationResponse> {
    return this.clients.indexing.notify(await this.requireToken('indexing', account), url, type);
  }

  // ------------------------------------------------------------------
  // Internals
  // ------------------------------------------------------------------

  private scopesFor(provider?: GoogleProvider): string[] {
    const profile = [...GOOGLE_PROFILE_SCOPES];
    if (provider === undefined) {
      const all = Object.values(DEFAULT_PROVIDER_SCOPES).flat();
      return [...profile, ...all];
    }
    return [...profile, ...DEFAULT_PROVIDER_SCOPES[provider]];
  }

  private async requireToken(provider: GoogleProvider, account: string): Promise<string> {
    try {
      const credential = await this.credentialManager.getValidTokens(provider, account);
      return credential.accessToken;
    } catch (cause) {
      throw new GoogleApiError(`No valid Google credential for ${provider}:${account}`, {
        status: 0,
        context: { provider, resource: account, operation: 'requireToken' },
        cause,
      });
    }
  }
}
