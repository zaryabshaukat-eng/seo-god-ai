/**
 * Outbound webhooks: endpoint management, HMAC-signed payloads and reliable
 * delivery with retries, backoff and per-attempt audit records. Only 2xx
 * responses count as delivered; the final attempt is marked `expired`.
 */

import { EnterpriseValidationError, EnterpriseWebhookError } from './errors.js';
import { assertSameTenant, scopeRecords } from './tenant.js';
import type {
  WebhookDeliverer,
  WebhookDeliveryAttempt,
  WebhookDeliveryOptions,
  WebhookDeliveryResult,
  WebhookEndpoint,
  WebhookEventLike,
} from './types.js';
import { newId, randomSecret, signWebhookPayload } from './utils.js';

export interface WebhookEndpointInput {
  url: string;
  events: readonly string[];
  secret?: string;
  description?: string;
}

export interface WebhookEndpointPatch {
  url?: string;
  events?: readonly string[];
  enabled?: boolean;
  description?: string;
}

export interface WebhookServiceOptions {
  now?: () => string;
  id?: () => string;
  deliverer?: WebhookDeliverer;
  delay?: (ms: number) => Promise<void>;
}

const MAX_ATTEMPTS = 10;

export class WebhookService {
  private readonly endpoints = new Map<string, WebhookEndpoint>();
  private readonly deliveries: WebhookDeliveryAttempt[] = [];
  private readonly now: () => string;
  private readonly id: () => string;
  private readonly deliverer?: WebhookDeliverer;
  private readonly delay?: (ms: number) => Promise<void>;

  constructor(options: WebhookServiceOptions = {}) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.id = options.id ?? (() => newId('whk'));
    this.deliverer = options.deliverer;
    this.delay = options.delay;
  }

  /** Registers a webhook endpoint for the given event types. */
  register(tenantId: string, input: WebhookEndpointInput): WebhookEndpoint {
    validateUrl(input.url);
    if (input.events.length === 0) {
      throw new EnterpriseValidationError('Webhook requires at least one event type.');
    }
    const timestamp = this.now();
    const endpoint: WebhookEndpoint = {
      webhookId: this.id(),
      tenantId,
      url: input.url,
      secret: input.secret ?? randomSecret(32),
      events: input.events.slice(),
      enabled: true,
      description: input.description,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.endpoints.set(endpoint.webhookId, endpoint);
    return { ...endpoint };
  }

  async listEndpoints(tenantId: string): Promise<WebhookEndpoint[]> {
    return scopeRecords([...this.endpoints.values()], tenantId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((endpoint) => ({ ...endpoint }));
  }

  async getEndpoint(tenantId: string, webhookId: string): Promise<WebhookEndpoint> {
    return this.getOrThrow(tenantId, webhookId);
  }

  async updateEndpoint(tenantId: string, webhookId: string, patch: WebhookEndpointPatch): Promise<WebhookEndpoint> {
    const endpoint = this.getOrThrow(tenantId, webhookId);
    if (patch.url !== undefined) {
      validateUrl(patch.url);
      endpoint.url = patch.url;
    }
    if (patch.events !== undefined) {
      if (patch.events.length === 0) {
        throw new EnterpriseValidationError('Webhook requires at least one event type.');
      }
      endpoint.events = patch.events.slice();
    }
    if (patch.enabled !== undefined) endpoint.enabled = patch.enabled;
    if (patch.description !== undefined) endpoint.description = patch.description;
    endpoint.updatedAt = this.now();
    return { ...endpoint };
  }

  async enableEndpoint(tenantId: string, webhookId: string): Promise<WebhookEndpoint> {
    const endpoint = this.getOrThrow(tenantId, webhookId);
    if (!endpoint.enabled) {
      endpoint.enabled = true;
      endpoint.updatedAt = this.now();
    }
    return { ...endpoint };
  }

  async disableEndpoint(tenantId: string, webhookId: string): Promise<WebhookEndpoint> {
    const endpoint = this.getOrThrow(tenantId, webhookId);
    if (endpoint.enabled) {
      endpoint.enabled = false;
      endpoint.updatedAt = this.now();
    }
    return { ...endpoint };
  }

  async removeEndpoint(tenantId: string, webhookId: string): Promise<void> {
    const endpoint = this.getOrThrow(tenantId, webhookId);
    this.endpoints.delete(endpoint.webhookId);
  }

  /** Dispatches an event to every enabled endpoint subscribed to its type. */
  async dispatch(tenantId: string, event: WebhookEventLike, options: WebhookDeliveryOptions = {}): Promise<WebhookDeliveryResult[]> {
    assertSameTenant(event.tenantId, tenantId);
    const subscribers = [...this.endpoints.values()].filter(
      (endpoint) => endpoint.tenantId === tenantId && endpoint.enabled && endpoint.events.includes(event.type),
    );
    const results: WebhookDeliveryResult[] = [];
    for (const endpoint of subscribers) {
      results.push(await this.deliver(endpoint, event, options));
    }
    return results;
  }

  /** Delivers a single payload with retries and backoff. */
  async deliver(endpoint: WebhookEndpoint, event: WebhookEventLike, options: WebhookDeliveryOptions = {}): Promise<WebhookDeliveryResult> {
    if (this.deliverer === undefined) {
      throw new EnterpriseWebhookError('No webhook deliverer configured.', { tenantId: endpoint.tenantId });
    }
    const attempts = Math.min(Math.max(options.attempts ?? 3, 1), MAX_ATTEMPTS);
    const backoffMs = Math.max(options.backoffMs ?? 1000, 0);
    const attemptsMade: WebhookDeliveryAttempt[] = [];
    let delivered = false;

    for (let attemptNumber = 1; attemptNumber <= attempts && !delivered; attemptNumber += 1) {
      if (attemptNumber > 1 && this.delay !== undefined) {
        await this.delay(backoffMs * (attemptNumber - 1));
      }
      const body = JSON.stringify(event.payload);
      const now = this.now();
      const signature = signWebhookPayload(endpoint.secret, body, timestampSeconds(now));
      const headers: Record<string, string> = {
        'content-type': 'application/json',
        'x-seogod-event': event.type,
        'x-seogod-delivery': this.id(),
        'x-seogod-signature': signature,
      };
      let status: WebhookDeliveryAttempt['status'] = 'delivered';
      let httpStatus: number | undefined;
      let error: string | undefined;
      try {
        const response = await this.deliverer.deliver(endpoint, event, headers, body);
        httpStatus = response.status;
        if (response.status >= 200 && response.status < 300) {
          delivered = true;
        } else {
          status = 'failed';
          error = `Non-2xx response: ${response.status}`;
        }
      } catch (err) {
        status = 'failed';
        error = err instanceof Error ? err.message : String(err);
      }
      attemptsMade.push({
        attemptId: this.id(),
        webhookId: endpoint.webhookId,
        tenantId: endpoint.tenantId,
        eventId: event.id,
        status,
        attemptNumber,
        httpStatus,
        error,
        attemptedAt: now,
      });
    }

    if (!delivered && attemptsMade.length > 0) {
      const last = attemptsMade[attemptsMade.length - 1];
      if (last !== undefined) last.status = 'expired';
    }
    this.deliveries.push(...attemptsMade);
    return { webhookId: endpoint.webhookId, eventId: event.id, attempts: attemptsMade, delivered };
  }

  /** Per-attempt delivery history, newest first. */
  listDeliveries(tenantId: string): WebhookDeliveryAttempt[] {
    return scopeRecords(this.deliveries, tenantId)
      .sort((a, b) => b.attemptedAt.localeCompare(a.attemptedAt))
      .map((attempt) => ({ ...attempt }));
  }

  private getOrThrow(tenantId: string, webhookId: string): WebhookEndpoint {
    const endpoint = this.endpoints.get(webhookId);
    if (endpoint === undefined) {
      throw new EnterpriseValidationError(`Webhook '${webhookId}' not found.`, {
        tenantId,
        resourceId: webhookId,
      });
    }
    assertSameTenant(endpoint.tenantId, tenantId);
    return endpoint;
  }
}

function validateUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new EnterpriseValidationError(`Invalid webhook URL '${url}'.`);
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new EnterpriseValidationError(`Webhook URL must use http(s), got '${parsed.protocol}'.`);
  }
}

function timestampSeconds(iso: string): number {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : Math.floor(Date.now() / 1000);
}
