import { describe, expect, it, vi } from 'vitest';
import { EnterpriseIsolationError, EnterpriseValidationError, EnterpriseWebhookError } from './errors.js';
import { signWebhookPayload } from './utils.js';
import { WebhookService } from './webhooks.js';
import type { WebhookDeliverer, WebhookEventLike } from './types.js';

const FIXED = '2026-08-06T12:00:00.000Z';
const FIXED_SECONDS = Math.floor(Date.parse(FIXED) / 1000);

function makeEvent(overrides: Partial<WebhookEventLike> = {}): WebhookEventLike {
  return {
    id: 'evt_1',
    tenantId: 't1',
    type: 'report.completed',
    createdAt: FIXED,
    payload: { reportId: 'r1', score: 87 },
    ...overrides,
  };
}

function makeDeliverer(status = 200): { deliverer: WebhookDeliverer; headers: Record<string, string>[]; bodies: string[] } {
  const headers: Record<string, string>[] = [];
  const bodies: string[] = [];
  return {
    deliverer: {
      async deliver(_endpoint, _event, requestHeaders, body) {
        headers.push(requestHeaders);
        bodies.push(body);
        return { status };
      },
    },
    headers,
    bodies,
  };
}

describe('WebhookService endpoints', () => {
  it('registers endpoints with generated secrets', () => {
    const service = new WebhookService({ now: () => FIXED });
    const endpoint = service.register('t1', { url: 'https://hooks.example.com/seo', events: ['report.completed'] });
    expect(endpoint.webhookId).toMatch(/^whk_/);
    expect(endpoint.secret).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(endpoint.enabled).toBe(true);
    expect(endpoint.createdAt).toBe(FIXED);
  });

  it('accepts a caller-provided secret and description', () => {
    const service = new WebhookService();
    const endpoint = service.register('t1', {
      url: 'https://hooks.example.com/a',
      events: ['a'],
      secret: 'whsec_test',
      description: 'primary',
    });
    expect(endpoint.secret).toBe('whsec_test');
    expect(endpoint.description).toBe('primary');
  });

  it('rejects invalid urls and empty event lists', () => {
    const service = new WebhookService();
    expect(() => service.register('t1', { url: 'not a url', events: ['a'] })).toThrow(EnterpriseValidationError);
    expect(() => service.register('t1', { url: 'ftp://x', events: ['a'] })).toThrow(EnterpriseValidationError);
    expect(() => service.register('t1', { url: 'https://ok', events: [] })).toThrow(EnterpriseValidationError);
  });

  it('updates, enables, disables and removes endpoints', async () => {
    const service = new WebhookService({ now: () => FIXED });
    const endpoint = service.register('t1', { url: 'https://a', events: ['a'] });

    const updated = await service.updateEndpoint('t1', endpoint.webhookId, {
      url: 'https://b',
      events: ['a', 'b'],
      enabled: false,
      description: 'changed',
    });
    expect(updated.url).toBe('https://b');
    expect(updated.events).toEqual(['a', 'b']);
    expect(updated.enabled).toBe(false);

    await expect(
      service.updateEndpoint('t1', endpoint.webhookId, { url: 'junk' }),
    ).rejects.toThrow(EnterpriseValidationError);
    await expect(
      service.updateEndpoint('t1', endpoint.webhookId, { events: [] }),
    ).rejects.toThrow(EnterpriseValidationError);

    const reEnabled = await service.enableEndpoint('t1', endpoint.webhookId);
    expect(reEnabled.enabled).toBe(true);
    const disabled = await service.disableEndpoint('t1', endpoint.webhookId);
    expect(disabled.enabled).toBe(false);

    expect(await service.listEndpoints('t1')).toHaveLength(1);
    await service.removeEndpoint('t1', endpoint.webhookId);
    expect(await service.listEndpoints('t1')).toHaveLength(0);
    await expect(service.getEndpoint('t1', endpoint.webhookId)).rejects.toThrow(EnterpriseValidationError);
  });

  it('isolates endpoints between tenants', async () => {
    const service = new WebhookService();
    const endpoint = service.register('t1', { url: 'https://a', events: ['a'] });
    await expect(service.getEndpoint('t2', endpoint.webhookId)).rejects.toThrow(EnterpriseIsolationError);
  });
});

describe('WebhookService delivery', () => {
  it('delivers signed payloads and records successful attempts', async () => {
    const { deliverer, headers, bodies } = makeDeliverer(200);
    const service = new WebhookService({ now: () => FIXED, deliverer });
    const endpoint = service.register('t1', {
      url: 'https://hooks.example.com/seo',
      events: ['report.completed'],
      secret: 'whsec_test',
    });
    const event = makeEvent();
    const result = await service.deliver(endpoint, event);

    expect(result.delivered).toBe(true);
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0]?.status).toBe('delivered');
    expect(result.attempts[0]?.httpStatus).toBe(200);
    expect(bodies[0]).toBe(JSON.stringify(event.payload));
    const signature = headers[0]?.['x-seogod-signature'] ?? '';
    expect(signature).toBe(signWebhookPayload('whsec_test', bodies[0] ?? '', FIXED_SECONDS));
    expect(headers[0]?.['x-seogod-event']).toBe('report.completed');

    const history = service.listDeliveries('t1');
    expect(history).toHaveLength(1);
  });

  it('retries non-2xx responses and marks the final attempt expired', async () => {
    const { deliverer } = makeDeliverer(500);
    const delays: number[] = [];
    const service = new WebhookService({
      now: () => FIXED,
      deliverer,
      delay: async (ms) => {
        delays.push(ms);
      },
    });
    const endpoint = service.register('t1', { url: 'https://a', events: ['a'], secret: 's' });
    const result = await service.deliver(endpoint, makeEvent(), { attempts: 3, backoffMs: 100 });
    expect(result.delivered).toBe(false);
    expect(result.attempts).toHaveLength(3);
    expect(result.attempts.map((a) => a.status)).toEqual(['failed', 'failed', 'expired']);
    expect(delays).toEqual([100, 200]);
  });

  it('retries on thrown delivery errors', async () => {
    const deliverer: WebhookDeliverer = {
      async deliver() {
        throw new Error('connection refused');
      },
    };
    const service = new WebhookService({ now: () => FIXED, deliverer, delay: async () => undefined });
    const endpoint = service.register('t1', { url: 'https://a', events: ['a'], secret: 's' });
    const result = await service.deliver(endpoint, makeEvent(), { attempts: 2, backoffMs: 0 });
    expect(result.delivered).toBe(false);
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts.map((a) => a.status)).toEqual(['failed', 'expired']);
    expect(result.attempts[0]?.error).toBe('connection refused');
  });

  it('succeeds on the second attempt after a failure', async () => {
    let calls = 0;
    const deliverer: WebhookDeliverer = {
      async deliver() {
        calls += 1;
        return { status: calls === 1 ? 503 : 200 };
      },
    };
    const service = new WebhookService({ now: () => FIXED, deliverer, delay: async () => undefined });
    const endpoint = service.register('t1', { url: 'https://a', events: ['a'], secret: 's' });
    const result = await service.deliver(endpoint, makeEvent(), { attempts: 3, backoffMs: 0 });
    expect(result.delivered).toBe(true);
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts[0]?.status).toBe('failed');
    expect(result.attempts[1]?.status).toBe('delivered');
  });

  it('throws when no deliverer is configured', async () => {
    const service = new WebhookService();
    const endpoint = service.register('t1', { url: 'https://a', events: ['a'] });
    await expect(service.deliver(endpoint, makeEvent())).rejects.toThrow(EnterpriseWebhookError);
  });

  it('dispatches to subscribed enabled endpoints only', async () => {
    const deliver = vi.fn(async () => ({ status: 200 }));
    const service = new WebhookService({ now: () => FIXED, deliverer: { deliver } });
    service.register('t1', { url: 'https://a', events: ['report.completed'], secret: 's' });
    const disabled = service.register('t1', { url: 'https://b', events: ['report.completed'], secret: 's' });
    service.register('t1', { url: 'https://c', events: ['other.event'], secret: 's' });
    await service.disableEndpoint('t1', disabled.webhookId);

    const results = await service.dispatch('t1', makeEvent());
    expect(results).toHaveLength(1);
    expect(deliver).toHaveBeenCalledTimes(1);

    const none = await service.dispatch('t1', makeEvent({ type: 'unknown.event' }));
    expect(none).toHaveLength(0);
  });

  it('rejects dispatching events from another tenant', async () => {
    const service = new WebhookService({ now: () => FIXED, deliverer: makeDeliverer().deliverer });
    await expect(service.dispatch('t1', makeEvent({ tenantId: 't2' }))).rejects.toThrow(EnterpriseIsolationError);
  });
});
