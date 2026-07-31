import { createHmac, timingSafeEqual } from 'node:crypto';
import { ShopifyAuthError, ShopifyNetworkError, ShopifyValidationError } from './errors.js';

/** Maximum length Shopify allows for a shop subdomain (my-shop part). */
const MAX_SUBDOMAIN_LENGTH = 255;

const SHOP_DOMAIN_PATTERN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i;

/**
 * Validates a Shopify store subdomain.
 *
 * Must be a bare subdomain like `my-store.myshopify.com`. Anything else
 * (URLs, `..evil.com` suffixes, too-short names) is rejected to prevent
 * phishing-style shop spoofing.
 */
export function isValidShopDomain(shopDomain: string): boolean {
  if (
    typeof shopDomain !== 'string' ||
    shopDomain.length === 0 ||
    shopDomain.length > MAX_SUBDOMAIN_LENGTH
  ) {
    return false;
  }
  if (!SHOP_DOMAIN_PATTERN.test(shopDomain)) {
    return false;
  }
  const subdomain = shopDomain.split('.')[0] ?? '';
  return subdomain.length >= 3;
}

export interface AuthorizationUrlOptions {
  clientId: string;
  scopes: string[];
  redirectUri: string;
  shopDomain: string;
  /** Anti-CSRF value you generate and store for the session. */
  state: string;
  /** Request an online (per-user) token instead of an offline token. */
  isOnline?: boolean;
}

/**
 * Builds the Shopify OAuth authorization URL for the embedded/standalone app flow.
 */
export function buildAuthorizationUrl(options: AuthorizationUrlOptions): string {
  if (!isValidShopDomain(options.shopDomain)) {
    throw new ShopifyValidationError(`Invalid shop domain: ${options.shopDomain}`, {
      shopDomain: options.shopDomain,
      operation: 'buildAuthorizationUrl',
    });
  }
  const query = new URLSearchParams({
    client_id: options.clientId,
    scope: options.scopes.join(','),
    redirect_uri: options.redirectUri,
    state: options.state,
  });
  if (options.isOnline) {
    query.append('grant_options[]', 'per-user');
  }
  return `https://${options.shopDomain}/admin/oauth/authorize?${query.toString()}`;
}

/**
 * Verifies the HMAC signature Shopify appends to OAuth callback queries.
 *
 * Algorithm: sort every query param except `hmac`/`signature`, URL-encode
 * keys and values, join as `k=v` with `&`, HMAC-SHA256 with the client
 * secret, compare in constant time.
 */
export function validateHmac(query: URLSearchParams, clientSecret: string): boolean {
  const provided = query.get('hmac');
  if (!provided) {
    return false;
  }
  const message = [...query.entries()]
    .filter(([key]) => key !== 'hmac' && key !== 'signature')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .sort()
    .join('&');

  const digest = createHmac('sha256', clientSecret).update(message).digest('hex');

  const a = Buffer.from(digest, 'utf8');
  const b = Buffer.from(provided, 'utf8');
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

export interface ExchangeTokenOptions {
  shopDomain: string;
  code: string;
  clientId: string;
  clientSecret: string;
}

export interface ExchangeTokenResult {
  accessToken: string;
  scope: string;
  /** Present only for online tokens. */
  expiresIn?: number;
}

/**
 * Exchanges the temporary OAuth `code` for a durable access token.
 *
 * Never log the returned token.
 */
export async function exchangeAccessToken(
  options: ExchangeTokenOptions,
  fetchImpl: typeof fetch = fetch,
): Promise<ExchangeTokenResult> {
  if (!isValidShopDomain(options.shopDomain)) {
    throw new ShopifyValidationError(`Invalid shop domain: ${options.shopDomain}`, {
      shopDomain: options.shopDomain,
      operation: 'exchangeAccessToken',
    });
  }
  if (!options.code) {
    throw new ShopifyValidationError('OAuth code is required', {
      operation: 'exchangeAccessToken',
    });
  }

  let response: Response;
  try {
    response = await fetchImpl(`https://${options.shopDomain}/admin/oauth/access_token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        client_id: options.clientId,
        client_secret: options.clientSecret,
        code: options.code,
      }),
    });
  } catch (cause) {
    throw new ShopifyNetworkError(
      'Failed to reach the Shopify OAuth token endpoint',
      {
        shopDomain: options.shopDomain,
        operation: 'exchangeAccessToken',
      },
      cause,
    );
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new ShopifyAuthError(`Token exchange failed with status ${response.status}`, {
      shopDomain: options.shopDomain,
      operation: 'exchangeAccessToken',
      status: response.status,
      body,
    });
  }

  const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (typeof json.access_token !== 'string' || json.access_token === '') {
    throw new ShopifyAuthError('Token exchange response did not include an access token', {
      shopDomain: options.shopDomain,
      operation: 'exchangeAccessToken',
    });
  }

  return {
    accessToken: json.access_token,
    scope: typeof json.scope === 'string' ? json.scope : '',
    expiresIn: typeof json.expires_in === 'number' ? json.expires_in : undefined,
  };
}
