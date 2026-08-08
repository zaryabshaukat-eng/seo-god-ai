/**
 * Low-level HTTP helpers for the raw `node:http` server: JSON body parsing,
 * response writing and CORS. All responses are JSON with a canonical
 * envelope; streaming endpoints bypass these helpers and write directly.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { BadRequestError } from './errors.js';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS';

export interface HttpMethods {
  method: HttpMethod;
}

const MAX_BODY_BYTES = 1_048_576;

/** Resolves the request method as a known HTTP verb. */
export function methodOf(req: IncomingMessage): HttpMethod {
  const value = (req.method ?? 'GET').toUpperCase();
  if (value === 'GET' || value === 'POST' || value === 'PUT' || value === 'PATCH' || value === 'DELETE' || value === 'OPTIONS') {
    return value;
  }
  return 'GET';
}

/** Reads the request body into a JSON value (or `undefined` for empty bodies). */
export async function readJsonBody(req: IncomingMessage, options: { maxBytes?: number } = {}): Promise<unknown> {
  const maxBytes = options.maxBytes ?? MAX_BODY_BYTES;
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) {
      throw new BadRequestError(`Request body exceeds the ${maxBytes}-byte limit.`);
    }
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) return undefined;
  const raw = Buffer.concat(chunks).toString('utf8');
  if (raw.trim().length === 0) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    throw new BadRequestError('Request body must be valid JSON.', { cause: error });
  }
}

/** Writes a JSON response body with the given status. */
export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

/** Writes a 204 No Content response. */
export function sendNoContent(res: ServerResponse): void {
  res.writeHead(204);
  res.end();
}

/** Writes a plain-text response (used by the Prometheus metrics endpoint). */
export function sendText(res: ServerResponse, status: number, body: string, contentType = 'text/plain; charset=utf-8'): void {
  res.writeHead(status, {
    'content-type': contentType,
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

/** Writes a binary buffer response (used by generated SDK downloads). */
export function sendBuffer(res: ServerResponse, status: number, body: Buffer, contentType: string, filename?: string): void {
  const headers: Record<string, string> = { 'content-type': contentType };
  if (filename !== undefined) {
    headers['content-disposition'] = `attachment; filename="${filename}"`;
  }
  headers['content-length'] = String(body.length);
  res.writeHead(status, headers);
  res.end(body);
}

/** Applies permissive CORS headers to the response. */
export function applyCors(res: ServerResponse, origin = '*'): void {
  res.setHeader('access-control-allow-origin', origin);
  res.setHeader('access-control-allow-methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type, authorization, x-request-id');
  res.setHeader('access-control-max-age', '600');
}

/** Resolves the client IP from socket + proxy headers. */
export function clientIp(req: IncomingMessage): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    const first = forwarded.split(',')[0]?.trim();
    if (first !== undefined && first.length > 0) return first;
  }
  const remote = req.socket?.remoteAddress;
  return typeof remote === 'string' && remote.length > 0 ? remote : 'unknown';
}

/** Extracts the `Authorization: Bearer <token>` value, if present. */
export function bearerToken(headers: { authorization?: unknown }): string | undefined {
  const header = headers.authorization;
  if (typeof header !== 'string') return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1];
}

/** A normalized request URL: pathname plus parsed query parameters. */
export function parseUrl(req: IncomingMessage): { pathname: string; query: URLSearchParams } {
  const url = req.url ?? '/';
  const index = url.indexOf('?');
  const pathname = index === -1 ? url : url.slice(0, index);
  const query = index === -1 ? '' : url.slice(index + 1);
  return { pathname: pathname || '/', query: new URLSearchParams(query) };
}
