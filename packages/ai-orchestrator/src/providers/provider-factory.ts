import type { Provider, ProviderConfig } from '../types/provider.js';
import { UnsupportedProviderError } from '../errors.js';
import { OpenAIProvider } from './openai-provider.js';
import type { FetchLike } from './openai-provider.js';

export interface ProviderFactoryOptions {
  fetchFn?: FetchLike;
}

export interface ProviderFactory {
  get(name: string): Provider;
  list(): Provider[];
}

/**
 * Creates providers from config without hard-coding which vendor is used.
 * Adding Anthropic, Gemini, or a local provider is a new case here and
 * nothing changes in the orchestrator itself.
 */
export class DefaultProviderFactory implements ProviderFactory {
  private readonly providers = new Map<string, Provider>();

  constructor(configs: readonly ProviderConfig[], options: ProviderFactoryOptions = {}) {
    for (const config of configs) {
      this.register(config, options);
    }
  }

  register(config: ProviderConfig, options: ProviderFactoryOptions = {}): Provider {
    let provider: Provider;
    switch (config.name) {
      case 'openai':
        provider = new OpenAIProvider(config, { fetchFn: options.fetchFn });
        break;
      default:
        throw new UnsupportedProviderError(
          `Provider "${config.name}" is not supported; supported: openai`,
        );
    }
    const existing = this.providers.get(provider.name);
    if (existing !== undefined) {
      throw new UnsupportedProviderError(`Provider "${provider.name}" is already registered`);
    }
    this.providers.set(provider.name, provider);
    return provider;
  }

  get(name: string): Provider {
    const provider = this.providers.get(name);
    if (provider === undefined) {
      throw new UnsupportedProviderError(`Provider "${name}" is not registered`);
    }
    return provider;
  }

  list(): Provider[] {
    return [...this.providers.values()];
  }
}
