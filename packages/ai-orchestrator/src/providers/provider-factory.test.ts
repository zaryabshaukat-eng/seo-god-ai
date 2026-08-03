import { describe, expect, it } from 'vitest';
import { UnsupportedProviderError } from '../errors.js';
import type { ProviderConfig } from '../types/provider.js';
import { DefaultProviderFactory } from './provider-factory.js';
import type { FetchLike } from './openai-provider.js';

const openai: ProviderConfig = { name: 'openai', model: 'gpt-4o-mini' };
const noopFetch: FetchLike = async () => ({ ok: true, status: 200, text: async () => '{}' });

describe('DefaultProviderFactory', () => {
  it('registers and returns configured providers', () => {
    const factory = new DefaultProviderFactory([openai], { fetchFn: noopFetch });
    expect(factory.get('openai').name).toBe('openai');
    expect(factory.list()).toHaveLength(1);
  });

  it('registers a provider after construction', () => {
    const factory = new DefaultProviderFactory([], { fetchFn: noopFetch });
    factory.register(openai, { fetchFn: noopFetch });
    expect(factory.get('openai').name).toBe('openai');
  });

  it('rejects unknown providers', () => {
    const factory = new DefaultProviderFactory([], { fetchFn: noopFetch });
    expect(() => factory.register({ name: 'anthropic', model: 'x' })).toThrow(UnsupportedProviderError);
  });

  it('rejects duplicate registrations', () => {
    const factory = new DefaultProviderFactory([openai], { fetchFn: noopFetch });
    expect(() => factory.register(openai, { fetchFn: noopFetch })).toThrow(/already registered/);
  });

  it('rejects lookups of unregistered providers', () => {
    const factory = new DefaultProviderFactory([], { fetchFn: noopFetch });
    expect(() => factory.get('gemini')).toThrow(/not registered/);
  });
});
