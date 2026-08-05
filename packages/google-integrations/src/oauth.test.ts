import { describe, expect, it } from 'vitest';
import {
  GoogleAuthError,
  GoogleNetworkError,
  GoogleValidationError,
} from './errors.js';
import { GoogleOAuth } from './oauth.js';

const CONFIG = {
  clientId: 'client-1',
  clientSecret: 'secret-1',
  redirectUri: 'https://app.example.com/oauth/google/callback',
  scopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
};

function oauth(fetchImpl?: typeof fetch): GoogleOAuth {
  return new GoogleOAuth({ ...CONFIG, fetchImpl });
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('GoogleOAuth', () => {
  it('requires clientId, clientSecret and redirectUri', () => {
    expect(() => new GoogleOAuth({ clientId: '', clientSecret: 's', redirectUri: 'r', scopes: [] })).toThrow(
      GoogleValidationError,
    );
    expect(() => new GoogleOAuth({ clientId: 'c', clientSecret: '', redirectUri: 'r', scopes: [] })).toThrow(
      GoogleValidationError,
    );
    expect(() => new GoogleOAuth({ clientId: 'c', clientSecret: 's', redirectUri: '', scopes: [] })).toThrow(
      GoogleValidationError,
    );
  });

  describe('buildAuthorizationUrl', () => {
    it('builds the consent URL with client, redirect, scope and offline access', () => {
      const url = new URL(oauth().buildAuthorizationUrl({ state: 'abc' }));
      expect(url.origin).toBe('https://accounts.google.com');
      expect(url.pathname).toBe('/o/oauth2/v2/auth');
      expect(url.searchParams.get('client_id')).toBe('client-1');
      expect(url.searchParams.get('redirect_uri')).toBe(CONFIG.redirectUri);
      expect(url.searchParams.get('response_type')).toBe('code');
      expect(url.searchParams.get('scope')).toBe(CONFIG.scopes[0]);
      expect(url.searchParams.get('state')).toBe('abc');
      expect(url.searchParams.get('access_type')).toBe('offline');
    });

    it('appends PKCE params, a prompt and a redirect override when provided', () => {
      const url = new URL(
        oauth().buildAuthorizationUrl({
          state: 'abc',
          codeChallenge: 'challenge-1',
          prompt: 'consent',
          redirectUri: 'https://other.example.com/cb',
        }),
      );
      expect(url.searchParams.get('code_challenge')).toBe('challenge-1');
      expect(url.searchParams.get('code_challenge_method')).toBe('S256');
      expect(url.searchParams.get('prompt')).toBe('consent');
      expect(url.searchParams.get('redirect_uri')).toBe('https://other.example.com/cb');
    });

    it('uses overridden scopes and access type', () => {
      const url = new URL(
        oauth().buildAuthorizationUrl({
          state: 'abc',
          scopes: ['openid'],
          accessType: 'online',
        }),
      );
      expect(url.searchParams.get('scope')).toBe('openid');
      expect(url.searchParams.get('access_type')).toBe('online');
    });

    it('rejects an empty state', () => {
      expect(() => oauth().buildAuthorizationUrl({ state: '' })).toThrow(GoogleValidationError);
    });
  });

  describe('validateState', () => {
    it('matches in constant time and passes when no expectation is set', () => {
      expect(oauth().validateState('abc', 'abc')).toBe(true);
      expect(oauth().validateState('abc', 'abd')).toBe(false);
      expect(oauth().validateState('abc', undefined)).toBe(true);
    });
  });

  describe('exchangeCode', () => {
    it('posts form-encoded params and returns typed tokens', async () => {
      let body = '';
      const client = oauth(async (input, init) => {
        expect(String(input)).toBe('https://oauth2.googleapis.com/token');
        expect(init?.method).toBe('POST');
        body = String(init?.body);
        return jsonResponse({
          access_token: 'at-1',
          refresh_token: 'rt-1',
          expires_in: 3600,
          scope: 'scope-a scope-b',
          token_type: 'Bearer',
        });
      });

      const result = await client.exchangeCode('code-1', { codeVerifier: 'verifier-1' });
      const params = new URLSearchParams(body);
      expect(params.get('code')).toBe('code-1');
      expect(params.get('grant_type')).toBe('authorization_code');
      expect(params.get('code_verifier')).toBe('verifier-1');
      expect(params.get('client_id')).toBe('client-1');
      expect(result).toMatchObject({
        accessToken: 'at-1',
        refreshToken: 'rt-1',
        expiresIn: 3600,
        scope: 'scope-a scope-b',
        tokenType: 'Bearer',
      });
    });

    it('rejects an empty code', async () => {
      await expect(oauth().exchangeCode('')).rejects.toBeInstanceOf(GoogleValidationError);
    });

    it('throws a typed auth error when the response is missing an access token', async () => {
      const client = oauth(async () => jsonResponse({ refresh_token: 'rt' }));
      await expect(client.exchangeCode('code-1')).rejects.toBeInstanceOf(GoogleAuthError);
    });

    it('tolerates a token response missing the optional fields', async () => {
      const client = oauth(async () => jsonResponse({ access_token: 'at-1' }));
      const result = await client.exchangeCode('code-1');
      expect(result).toEqual({
        accessToken: 'at-1',
        refreshToken: undefined,
        expiresIn: undefined,
        scope: '',
        tokenType: 'Bearer',
      });
    });

    it('throws a typed auth error on a non-ok status', async () => {
      const client = oauth(async () => jsonResponse({ error: 'invalid_grant' }, 400));
      await expect(client.exchangeCode('code-1')).rejects.toBeInstanceOf(GoogleAuthError);
    });

    it('throws a network error when fetch rejects', async () => {
      const client = oauth(async () => {
        throw new TypeError('boom');
      });
      await expect(client.exchangeCode('code-1')).rejects.toBeInstanceOf(GoogleNetworkError);
    });
  });

  describe('refreshAccessToken', () => {
    it('exchanges a refresh token for a new access token', async () => {
      const client = oauth(async (_input, init) => {
        const params = new URLSearchParams(String(init?.body));
        expect(params.get('grant_type')).toBe('refresh_token');
        expect(params.get('refresh_token')).toBe('rt-1');
        return jsonResponse({ access_token: 'at-2', expires_in: 1800, scope: 's', token_type: 'Bearer' });
      });
      const result = await client.refreshAccessToken('rt-1');
      expect(result.accessToken).toBe('at-2');
      expect(result.expiresIn).toBe(1800);
    });

    it('rejects an empty refresh token', async () => {
      await expect(oauth().refreshAccessToken('')).rejects.toBeInstanceOf(GoogleValidationError);
    });
  });

  describe('revoke', () => {
    it('posts the token to the revoke endpoint', async () => {
      let called = false;
      const client = oauth(async (input, init) => {
        called = true;
        expect(String(input)).toContain('token=at-1');
        expect(init?.method).toBe('POST');
        return jsonResponse({}, 200);
      });
      await client.revoke('at-1');
      expect(called).toBe(true);
    });

    it('treats 400 as success (token already invalid)', async () => {
      const client = oauth(async () => jsonResponse({}, 400));
      await expect(client.revoke('at-1')).resolves.toBeUndefined();
    });

    it('throws on other non-ok statuses and rejects an empty token', async () => {
      const client = oauth(async () => jsonResponse({}, 500));
      await expect(client.revoke('at-1')).rejects.toBeInstanceOf(GoogleAuthError);
      await expect(client.revoke('')).rejects.toBeInstanceOf(GoogleValidationError);
    });

    it('throws a network error when fetch rejects', async () => {
      const client = oauth(async () => {
        throw new TypeError('boom');
      });
      await expect(client.revoke('at-1')).rejects.toBeInstanceOf(GoogleNetworkError);
    });
  });

  describe('getUserInfo', () => {
    it('returns the normalized profile', async () => {
      const client = oauth(async (_input, init) => {
        const headers = init?.headers as Record<string, string>;
        expect(headers.Authorization).toBe('Bearer at-1');
        return jsonResponse({
          sub: 'sub-1',
          email: 'owner@example.com',
          email_verified: true,
          name: 'Owner',
          picture: 'https://pic',
        });
      });
      const info = await client.getUserInfo('at-1');
      expect(info).toMatchObject({
        id: 'sub-1',
        email: 'owner@example.com',
        emailVerified: true,
        name: 'Owner',
        picture: 'https://pic',
      });
    });

    it('falls back when optional fields are missing', async () => {
      const client = oauth(async () => jsonResponse({ sub: 'sub-1', email: 'a@b.c' }));
      const info = await client.getUserInfo('at-1');
      expect(info.name).toBe('a@b.c');
      expect(info.picture).toBeNull();
      expect(info.emailVerified).toBe(false);
    });

    it('throws when sub or email is missing', async () => {
      const client = oauth(async () => jsonResponse({ name: 'x' }));
      await expect(client.getUserInfo('at-1')).rejects.toBeInstanceOf(GoogleAuthError);
    });

    it('throws on a non-ok status, an empty token and a network failure', async () => {
      const bad = oauth(async () => jsonResponse({}, 401));
      await expect(bad.getUserInfo('at-1')).rejects.toBeInstanceOf(GoogleAuthError);
      await expect(oauth().getUserInfo('')).rejects.toBeInstanceOf(GoogleValidationError);
      const network = oauth(async () => {
        throw new TypeError('boom');
      });
      await expect(network.getUserInfo('at-1')).rejects.toBeInstanceOf(GoogleNetworkError);
    });
  });
});
