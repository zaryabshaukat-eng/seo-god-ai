/**
 * Authentication service. Owns the user directory, session lifecycle and
 * password hashing. Sessions issue opaque bearer access + refresh tokens
 * stored in memory; passwords are hashed with scrypt and per-user salts.
 * Tenant provisioning on registration delegates to `@seogod/enterprise`.
 */

import { randomBytes, scrypt as scryptCb } from 'node:crypto';
import type { EnterpriseService } from '@seogod/enterprise';
import { promisify } from 'node:util';
import {
  ConflictError,
  NotFoundError,
  UnauthorizedError,
} from './errors.js';
import { permissionsForRole, type Role } from './permissions.js';
import { requireEmail, requirePassword, requireString } from './validation.js';

const scrypt = promisify(scryptCb);

export interface UserRecord {
  userId: string;
  email: string;
  name: string;
  role: Role;
  tenantId: string;
  orgIds: string[];
  locale: string;
  timezone: string;
  createdAt: number;
  passwordSalt: string;
  passwordHash: string;
}

export interface SessionRecord {
  sessionId: string;
  userId: string;
  tenantId: string;
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: number;
  refreshExpiresAt: number;
  createdAt: number;
}

export interface AuthSession {
  user: {
    id: string;
    email: string;
    name: string;
    role: Role;
    tenantId: string;
    orgIds: string[];
    locale: string;
    timezone: string;
  };
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  permissions: string[];
}

export interface AuthServiceOptions {
  now?: () => number;
  id?: () => string;
  accessTokenTtlMs?: number;
  refreshTokenTtlMs?: number;
}

const DEFAULT_ACCESS_TTL_MS = 15 * 60 * 1000;
const DEFAULT_REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export class AuthService {
  private readonly users = new Map<string, UserRecord>();
  private readonly usersByEmail = new Map<string, UserRecord>();
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly tokens = new Map<string, SessionRecord>();
  private readonly now: () => number;
  private readonly id: () => string;
  private readonly accessTtlMs: number;
  private readonly refreshTtlMs: number;

  constructor(
    private readonly enterprise: EnterpriseService,
    options: AuthServiceOptions = {},
  ) {
    this.now = options.now ?? (() => Date.now());
    this.id = options.id ?? (() => `u_${randomHex(12)}`);
    this.accessTtlMs = options.accessTokenTtlMs ?? DEFAULT_ACCESS_TTL_MS;
    this.refreshTtlMs = options.refreshTokenTtlMs ?? DEFAULT_REFRESH_TTL_MS;
  }

  /** Registers a new tenant + owner user and returns an authenticated session. */
  async register(input: { name: string; email: string; password: string; storeName: string }): Promise<AuthSession> {
    const name = requireString(input as Record<string, unknown>, 'name', 'Name');
    const email = requireEmail(input as Record<string, unknown>);
    const password = requirePassword(input as Record<string, unknown>);
    const storeName = requireString(input as Record<string, unknown>, 'storeName', 'Store name');

    if (this.usersByEmail.has(email.toLowerCase())) {
      throw new ConflictError(`An account already exists for '${email}'.`);
    }

    const tenant = await this.enterprise.tenant.provision({
      name: storeName,
      slug: slugFrom(storeName, this.id),
    });
    const organization = await this.enterprise.orgs.createOrganization(tenant.tenantId, storeName);
    const userId = this.id();
    const { salt, hash } = await hashPassword(password);
    const timestamp = this.now();
    const user: UserRecord = {
      userId,
      email: email.toLowerCase(),
      name,
      role: 'owner',
      tenantId: tenant.tenantId,
      orgIds: [organization.organizationId],
      locale: 'en',
      timezone: 'UTC',
      createdAt: timestamp,
      passwordSalt: salt,
      passwordHash: hash,
    };
    this.users.set(userId, user);
    this.usersByEmail.set(user.email, user);
    await this.enterprise.orgs.addMember(tenant.tenantId, organization.organizationId, userId, 'owner');
    this.enterprise.audit.record({
      tenantId: tenant.tenantId,
      actorId: userId,
      actorType: 'user',
      action: 'auth.register',
      resourceType: 'tenant',
      resourceId: tenant.tenantId,
    });
    return this.createSession(user);
  }

  /** Authenticates an existing user and returns a fresh session. */
  async login(input: { email: string; password: string }): Promise<AuthSession> {
    const email = requireEmail(input as Record<string, unknown>);
    const password = requireString(input as Record<string, unknown>, 'password', 'Password');
    const user = this.usersByEmail.get(email.toLowerCase());
    if (user === undefined || !(await verifyPassword(password, user.passwordSalt, user.passwordHash))) {
      throw new UnauthorizedError('Invalid email or password.');
    }
    await this.enterprise.tenant.assertActive(user.tenantId);
    this.enterprise.audit.record({
      tenantId: user.tenantId,
      actorId: user.userId,
      actorType: 'user',
      action: 'auth.login',
      resourceType: 'user',
      resourceId: user.userId,
    });
    return this.createSession(user);
  }

  /** Rotates a refresh token into a new session pair. */
  async refresh(refreshToken: string): Promise<AuthSession> {
    const session = this.tokens.get(refreshToken);
    if (session === undefined) {
      throw new UnauthorizedError('Invalid refresh token.');
    }
    if (this.now() >= session.refreshExpiresAt) {
      this.revokeSession(session);
      throw new UnauthorizedError('Refresh token has expired.');
    }
    const user = this.users.get(session.userId);
    if (user === undefined) {
      throw new UnauthorizedError('Session user no longer exists.');
    }
    await this.enterprise.tenant.assertActive(user.tenantId);
    this.revokeSession(session);
    return this.createSession(user);
  }

  /** Revokes the session bound to an access token. */
  logout(accessToken: string): void {
    const session = this.tokens.get(accessToken);
    if (session !== undefined) {
      this.revokeSession(session);
    }
  }

  /** Resolves the current user from an access token, or `null`. */
  async me(accessToken: string): Promise<AuthSession | null> {
    const session = this.tokens.get(accessToken);
    if (session === undefined || this.now() >= session.accessExpiresAt) {
      return null;
    }
    const user = this.users.get(session.userId);
    if (user === undefined) {
      return null;
    }
    return this.toSession(session, user);
  }

  /** Requests a password reset; returns a token that dev flows can redeem. */
  async requestPasswordReset(input: { email: string }): Promise<{ resetRequested: boolean }> {
    const email = requireEmail(input as Record<string, unknown>);
    const user = this.usersByEmail.get(email.toLowerCase());
    if (user !== undefined) {
      this.enterprise.audit.record({
        tenantId: user.tenantId,
        actorId: user.userId,
        actorType: 'user',
        action: 'auth.password_reset_requested',
        resourceType: 'user',
        resourceId: user.userId,
      });
    }
    return { resetRequested: true };
  }

  /** Verifies an access token and returns the bound session, or `null`. */
  verifyAccess(accessToken: string): SessionRecord | null {
    const session = this.tokens.get(accessToken);
    if (session === undefined || this.now() >= session.accessExpiresAt) {
      return null;
    }
    return session;
  }

  /** Lists users for a tenant (used by admin/settings endpoints). */
  listUsers(tenantId: string): UserRecord[] {
    return [...this.users.values()]
      .filter((user) => user.tenantId === tenantId)
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((user) => ({ ...user }));
  }

  /** Looks up a single user or throws. */
  requireUser(userId: string): UserRecord {
    const user = this.users.get(userId);
    if (user === undefined) {
      throw new NotFoundError(`User '${userId}' not found.`);
    }
    return user;
  }

  /** Resolves a user by email or throws a validation error. */
  userByEmail(email: string): UserRecord | null {
    return this.usersByEmail.get(email.toLowerCase()) ?? null;
  }

  /**
   * Creates a user inside an existing tenant (invite flow). When the email
   * already belongs to the tenant the existing user is added to the org
   * instead; an email from another tenant is a conflict.
   */
  async inviteUser(input: {
    tenantId: string;
    organizationId: string;
    email: string;
    name: string;
    role: Role;
  }): Promise<UserRecord> {
    const email = requireEmail(input as unknown as Record<string, unknown>);
    const existing = this.usersByEmail.get(email.toLowerCase());
    if (existing !== undefined) {
      if (existing.tenantId !== input.tenantId) {
        throw new ConflictError(`An account already exists for '${email}'.`);
      }
      if (!existing.orgIds.includes(input.organizationId)) {
        await this.enterprise.orgs.addMember(input.tenantId, input.organizationId, existing.userId, input.role);
        existing.orgIds = [...new Set([...existing.orgIds, input.organizationId])];
      }
      return { ...existing };
    }
    const { salt, hash } = await hashPassword(randomHex(16));
    const userId = this.id();
    const user: UserRecord = {
      userId,
      email: email.toLowerCase(),
      name: input.name,
      role: input.role,
      tenantId: input.tenantId,
      orgIds: [input.organizationId],
      locale: 'en',
      timezone: 'UTC',
      createdAt: this.now(),
      passwordSalt: salt,
      passwordHash: hash,
    };
    this.users.set(userId, user);
    this.usersByEmail.set(user.email, user);
    await this.enterprise.orgs.addMember(input.tenantId, input.organizationId, userId, input.role);
    this.enterprise.audit.record({
      tenantId: input.tenantId,
      actorId: userId,
      actorType: 'user',
      action: 'auth.member_invited',
      resourceType: 'user',
      resourceId: userId,
    });
    return { ...user };
  }

  /** Updates a user's role across every org membership in the tenant. */
  async updateUserRole(tenantId: string, userId: string, role: Role): Promise<UserRecord> {
    const user = this.users.get(userId);
    if (user === undefined || user.tenantId !== tenantId) {
      throw new NotFoundError(`User '${userId}' not found in tenant '${tenantId}'.`);
    }
    user.role = role;
    for (const organizationId of user.orgIds) {
      await this.enterprise.orgs.updateMemberRole(tenantId, organizationId, userId, role);
    }
    return { ...user };
  }

  private async createSession(user: UserRecord): Promise<AuthSession> {
    const timestamp = this.now();
    const accessToken = `at_${randomHex(24)}`;
    const refreshToken = `rt_${randomHex(24)}`;
    const session: SessionRecord = {
      sessionId: this.id(),
      userId: user.userId,
      tenantId: user.tenantId,
      accessToken,
      refreshToken,
      accessExpiresAt: timestamp + this.accessTtlMs,
      refreshExpiresAt: timestamp + this.refreshTtlMs,
      createdAt: timestamp,
    };
    this.sessions.set(session.sessionId, session);
    this.tokens.set(accessToken, session);
    this.tokens.set(refreshToken, session);
    return this.toSession(session, user);
  }

  private toSession(session: SessionRecord, user: UserRecord): AuthSession {
    return {
      user: {
        id: user.userId,
        email: user.email,
        name: user.name,
        role: user.role,
        tenantId: user.tenantId,
        orgIds: [...user.orgIds],
        locale: user.locale,
        timezone: user.timezone,
      },
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      expiresAt: session.accessExpiresAt,
      permissions: [...permissionsForRole(user.role)],
    };
  }

  private revokeSession(session: SessionRecord): void {
    this.sessions.delete(session.sessionId);
    this.tokens.delete(session.accessToken);
    this.tokens.delete(session.refreshToken);
  }

  /** Clears every user and session (used by tests and on reset). */
  reset(): void {
    this.users.clear();
    this.usersByEmail.clear();
    this.sessions.clear();
    this.tokens.clear();
  }
}

export async function hashPassword(password: string): Promise<{ salt: string; hash: string }> {
  const salt = randomHex(16);
  const hash = await scrypt(password, salt, 64) as Buffer;
  return { salt, hash: hash.toString('hex') };
}

export async function verifyPassword(password: string, salt: string, expected: string): Promise<boolean> {
  const hash = await scrypt(password, salt, 64) as Buffer;
  return timingSafeEqualHex(hash.toString('hex'), expected);
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  if (left.length !== right.length || left.length === 0) return false;
  return left.equals(right);
}

function randomHex(bytes: number): string {
  return randomBytes(bytes).toString('hex');
}

function slugFrom(storeName: string, id: () => string): string {
  const base = storeName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  const candidate = base.length >= 3 ? base : `store-${id().replace(/^u_/, '').slice(0, 8)}`;
  return candidate;
}
