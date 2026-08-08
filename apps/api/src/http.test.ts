/**
 * Unit tests for the low-level HTTP helpers: method resolution, body parsing
 * (including size limits and malformed JSON), response writers and request
 * normalization helpers.
 */

import { describe, it, expect, vi } from 'vitest';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { BadRequestError } from './errors.js';
import {
  applyCors,
  bearerToken,
  clientIp,
  methodOf,
  parseUrl,
  readJsonBody,
  sendBuffer,
  sendJson,
  sendNoContent,
  sendText,
} from './http.js';

function mockRes(): ServerResponse & Record<string, unknown> {
  return {
    writeHead: vi.fn(),
    end: vi.fn(),
    setHeader: vi.fn(),
    getHeader: vi.fn(),
  } as unknown as ServerResponse & Record<string, unknown>;
}

function streamOf(chunks: Array<string | Buffer>): IncomingMessage {
  return Readable.from(chunks) as unknown as IncomingMessage;
}

describe('methodOf', () => {
  it('resolves known verbs', () => {
    for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
      expect(methodOf({ method } as IncomingMessage)).toBe(method);
    }
  });

  it('falls back to GET for unknown or missing methods', () => {
    expect(methodOf({ method: 'PROPFIND' } as IncomingMessage)).toBe('GET');
    expect(methodOf({} as IncomingMessage)).toBe('GET');
  });
});

describe('readJsonBody', () => {
  it('parses a JSON payload', async () => {
    await expect(readJsonBody(streamOf([Buffer.from('{"a":1}')]))).resolves.toEqual({ a: 1 });
  });

  it('returns undefined for empty or whitespace-only bodies', async () => {
    await expect(readJsonBody(streamOf([]))).resolves.toBeUndefined();
    await expect(readJsonBody(streamOf(['   ']))).resolves.toBeUndefined();
  });

  it('accepts non-buffer string chunks', async () => {
    await expect(readJsonBody(streamOf(['{"b":2}']))).resolves.toEqual({ b: 2 });
  });

  it('throws a BadRequestError for malformed JSON', async () => {
    await expect(readJsonBody(streamOf(['not json']))).rejects.toBeInstanceOf(BadRequestError);
  });

  it('rejects bodies exceeding the byte limit', async () => {
    const big = Buffer.from(JSON.stringify({ data: 'x'.repeat(1024) }));
    await expect(readJsonBody(streamOf([big]), { maxBytes: 64 })).rejects.toBeInstanceOf(BadRequestError);
  });
});

describe('response writers', () => {
  it('sendJson writes the canonical content headers', () => {
    const res = mockRes();
    sendJson(res, 200, { ok: true });
    expect(res.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({ 'content-type': 'application/json; charset=utf-8' }));
    expect(res.end).toHaveBeenCalledWith('{"ok":true}');
  });

  it('sendNoContent writes a bare 204', () => {
    const res = mockRes();
    sendNoContent(res);
    expect(res.writeHead).toHaveBeenCalledWith(204);
    expect(res.end).toHaveBeenCalled();
  });

  it('sendText writes plain text with a default content type', () => {
    const res = mockRes();
    sendText(res, 200, 'metrics');
    expect(res.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({ 'content-type': 'text/plain; charset=utf-8' }));
  });

  it('sendBuffer writes with and without a download filename', () => {
    const plain = mockRes();
    sendBuffer(plain, 200, Buffer.from('abc'), 'text/typescript');
    expect(plain.writeHead).toHaveBeenCalledWith(200, expect.not.objectContaining({ 'content-disposition': expect.any(String) }));

    const named = mockRes();
    sendBuffer(named, 200, Buffer.from('abc'), 'text/typescript', 'sdk.ts');
    expect(named.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({ 'content-disposition': 'attachment; filename="sdk.ts"' }));
    expect(named.end).toHaveBeenCalledWith(Buffer.from('abc'));
  });
});

describe('applyCors', () => {
  it('sets permissive headers and honors a custom origin', () => {
    const res = mockRes();
    applyCors(res, 'https://app.example.test');
    expect(res.setHeader).toHaveBeenCalledWith('access-control-allow-origin', 'https://app.example.test');
    expect(res.setHeader).toHaveBeenCalledWith('access-control-allow-methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  });
});

describe('clientIp', () => {
  it('prefers the first x-forwarded-for entry', () => {
    const req = { headers: { 'x-forwarded-for': '10.0.0.1, 10.0.0.2' }, socket: { remoteAddress: '127.0.0.1' } };
    expect(clientIp(req as unknown as IncomingMessage)).toBe('10.0.0.1');
  });

  it('ignores an empty forwarded header and falls back to the socket', () => {
    const req = { headers: { 'x-forwarded-for': '   ' }, socket: { remoteAddress: '127.0.0.1' } };
    expect(clientIp(req as unknown as IncomingMessage)).toBe('127.0.0.1');
  });

  it('reports unknown when no remote address is available', () => {
    const req = { headers: {}, socket: {} };
    expect(clientIp(req as unknown as IncomingMessage)).toBe('unknown');
  });
});

describe('bearerToken', () => {
  it('extracts the token case-insensitively and trims', () => {
    expect(bearerToken({ authorization: 'Bearer abc.def' })).toBe('abc.def');
    expect(bearerToken({ authorization: 'bearer   xyz' })).toBe('xyz');
  });

  it('returns undefined for non-string or missing headers', () => {
    expect(bearerToken({})).toBeUndefined();
    expect(bearerToken({ authorization: 42 })).toBeUndefined();
    expect(bearerToken({ authorization: 'Basic abc' })).toBeUndefined();
  });
});

describe('parseUrl', () => {
  it('splits pathname and query', () => {
    const parsed = parseUrl({ url: '/api/v1/x?a=1&b=2' } as IncomingMessage);
    expect(parsed.pathname).toBe('/api/v1/x');
    expect(parsed.query.get('a')).toBe('1');
    expect(parsed.query.get('b')).toBe('2');
  });

  it('handles missing query, missing url and bare slash', () => {
    expect(parseUrl({ url: '/api/v1/y' } as IncomingMessage).pathname).toBe('/api/v1/y');
    expect(parseUrl({} as IncomingMessage).pathname).toBe('/');
    expect(parseUrl({ url: '/' } as IncomingMessage).pathname).toBe('/');
    expect(parseUrl({ url: '?only=query' } as IncomingMessage).pathname).toBe('/');
  });
});
