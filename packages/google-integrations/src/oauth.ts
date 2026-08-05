/**
 * Google OAuth 2.0 for installed/confidential apps.
 *
 * Implements the authorization-code flow against Google's endpoints:
 * consent URL construction (with optional PKCE), code exchange, access-token
 * refresh, token revocation and OpenID Connect userinfo lookups. Never log
 * the tokens returned by these methods.
 */

import { constantTimeEqual } from '@seogod/shared';
import { GoogleAuthError, GoogleNetworkError, GoogleValidationError } from './errors.js';
import type { GoogleUserInfo, OAuthTokenResult } from './types.js';

export const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
export const GOOGLE_REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';
export const GOOGLE_USERINFO_ENDPOINT = 'https://openidconnect.googleapis.com/v1/userinfo';

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  /** Scopes requested by default on every authorization URL. */
  scopes: string[];
  /** Injectable fetch for tests. Defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

export interface BuildAuthorizationUrlInput {
  /** Anti-CSRF value you persist and verify on the callback. */
  state: string;
  /** Overrides the config `redirectUri`. */
  redirectUri?: string;
  /** Overrides the config `scopes`. */
  scopes?: string[];
  /** S256 PKCE challenge derived from a `codeVerifier` you keep. */
  codeChallenge?: string;
  /** Requests a refresh token (`offline`) or only an access token. */
  accessType?: 'offline' | 'online';
  /** Forces account selection / consent re-display. */
  prompt?: 'consent' | 'select_account' | 'none';
}

const DEFAULT_ACCESS_TYPE = 'offline';

/**
 * OAuth client for the Google authorization-code flow.
 */
export class GoogleOAuth {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly redirectUri: string;
  private readonly scopes: string[];
  private readonly fetchImpl: typeof fetch;

  constructor(options: GoogleOAuthConfig) {
    if (!options.clientId || !options.clientSecret || !options.redirectUri) {
      throw new GoogleValidationError('clientId, clientSecret and redirectUri are required');
    }
    this.clientId = options.clientId;
    this.clientSecret = options.clientSecret;
    this.redirectUri = options.redirectUri;
    this.scopes = options.scopes;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /** Builds the URL to send a user to for OAuth consent. */
  buildAuthorizationUrl(input: BuildAuthorizationUrlInput): string {
    if (!input.state) {
      throw new GoogleValidationError('A non-empty state value is required', {
        operation: 'buildAuthorizationUrl',
      });
    }
    const query = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: input.redirectUri ?? this.redirectUri,
      response_type: 'code',
      scope: (input.scopes ?? this.scopes).join(' '),
      state: input.state,
      access_type: input.accessType ?? DEFAULT_ACCESS_TYPE,
    });
    if (input.codeChallenge) {
      query.set('code_challenge', input.codeChallenge);
      query.set('code_challenge_method', 'S256');
    }
    if (input.prompt) {
      query.set('prompt', input.prompt);
    }
    return `${GOOGLE_AUTH_ENDPOINT}?${query.toString()}`;
  }

  /**
   * Validates the `state` echoed by Google against the value you issued.
   * Comparison is constant-time to avoid CSRF replay attacks.
   */
  validateState(actual: string, expected: string | undefined): boolean {
    if (!expected) return true;
    return constantTimeEqual(actual, expected);
  }

  /**
   * Exchanges the temporary authorization `code` for tokens. Pass the
   * `codeVerifier` when PKCE was used to build the authorization URL.
   */
  async exchangeCode(code: string, options: { codeVerifier?: string } = {}): Promise<OAuthTokenResult> {
    if (!code) {
      throw new GoogleValidationError('OAuth code is required', { operation: 'exchangeCode' });
    }
    const params = new URLSearchParams({
      code,
      client_id: this.clientId,
      client_secret: this.clientSecret,
      redirect_uri: this.redirectUri,
      grant_type: 'authorization_code',
    });
    if (options.codeVerifier) {
      params.set('code_verifier', options.codeVerifier);
    }
    return this.tokenRequest(params, 'exchangeCode');
  }

  /** Refreshes an expiring access token using a refresh token. */
  async refreshAccessToken(refreshToken: string): Promise<OAuthTokenResult> {
    if (!refreshToken) {
      throw new GoogleValidationError('refreshToken is required', { operation: 'refreshAccessToken' });
    }
    const params = new URLSearchParams({
      refresh_token: refreshToken,
      client_id: this.clientId,
      client_secret: this.clientSecret,
      grant_type: 'refresh_token',
    });
    return this.tokenRequest(params, 'refreshAccessToken');
  }

  /** Revokes a token. Resolves on success; the endpoint returns 200. */
  async revoke(accessToken: string): Promise<void> {
    if (!accessToken) {
      throw new GoogleValidationError('accessToken is required', { operation: 'revoke' });
    }
    let response: Response;
    try {
      response = await this.fetchImpl(
        `${GOOGLE_REVOKE_ENDPOINT}?${new URLSearchParams({ token: accessToken })}`,
        { method: 'POST' },
      );
    } catch (cause) {
      throw new GoogleNetworkError('Failed to reach the Google revocation endpoint', { operation: 'revoke' }, cause);
    }
    if (!response.ok && response.status !== 400) {
      const body = await response.text().catch(() => '');
      throw new GoogleAuthError(`Token revocation failed with status ${response.status}`, {
        operation: 'revoke',
        status: response.status,
        body,
      });
    }
  }

  /** Fetches the profile of the account that owns `accessToken`. */
  async getUserInfo(accessToken: string): Promise<GoogleUserInfo> {
    if (!accessToken) {
      throw new GoogleValidationError('accessToken is required', { operation: 'getUserInfo' });
    }
    let response: Response;
    try {
      response = await this.fetchImpl(GOOGLE_USERINFO_ENDPOINT, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
    } catch (cause) {
      throw new GoogleNetworkError('Failed to reach the Google userinfo endpoint', { operation: 'getUserInfo' }, cause);
    }
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new GoogleAuthError(`Userinfo request failed with status ${response.status}`, {
        operation: 'getUserInfo',
        status: response.status,
        body,
      });
    }
    const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (typeof json.sub !== 'string' || typeof json.email !== 'string') {
      throw new GoogleAuthError('Userinfo response did not include an account id or email', {
        operation: 'getUserInfo',
      });
    }
    return {
      id: json.sub,
      email: json.email,
      emailVerified: json.email_verified === true,
      name: typeof json.name === 'string' ? json.name : json.email,
      picture: typeof json.picture === 'string' ? json.picture : null,
    };
  }

  private async tokenRequest(params: URLSearchParams, operation: string): Promise<OAuthTokenResult> {
    let response: Response;
    try {
      response = await this.fetchImpl(GOOGLE_TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      });
    } catch (cause) {
      throw new GoogleNetworkError('Failed to reach the Google OAuth token endpoint', { operation }, cause);
    }
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new GoogleAuthError(`Token request failed with status ${response.status}`, {
        operation,
        status: response.status,
        body,
      });
    }
    const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (typeof json.access_token !== 'string' || json.access_token === '') {
      throw new GoogleAuthError('Token response did not include an access token', { operation });
    }
    return {
      accessToken: json.access_token,
      refreshToken: typeof json.refresh_token === 'string' ? json.refresh_token : undefined,
      expiresIn: typeof json.expires_in === 'number' ? json.expires_in : undefined,
      scope: typeof json.scope === 'string' ? json.scope : '',
      tokenType: typeof json.token_type === 'string' ? json.token_type : 'Bearer',
    };
  }
}
