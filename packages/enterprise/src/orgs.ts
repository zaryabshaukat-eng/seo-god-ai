/**
 * Organizations, teams and membership. Every operation is tenant-scoped and
 * RBAC-guarded: callers must hold the relevant `*Manage` permission before
 * mutating an organization or its teams.
 */

import { EnterpriseConflictError, EnterpriseNotFoundError, EnterpriseValidationError } from './errors.js';
import { RoleManager, type Permission } from './rbac.js';
import { assertSameTenant, scopeRecords } from './tenant.js';
import type { Organization, OrganizationMember, Role, Team, TeamMember } from './types.js';
import { newId } from './utils.js';

export interface OrgServiceOptions {
  now?: () => string;
  id?: () => string;
  roleManager?: RoleManager;
}

const MEMBER_ROLES: readonly Role[] = ['owner', 'admin', 'member', 'viewer'];

export class OrgService {
  private readonly organizations = new Map<string, Organization>();
  private readonly teams = new Map<string, Team>();
  private readonly memberships = new Map<string, OrganizationMember>();
  private readonly teamMembers = new Map<string, TeamMember>();
  private readonly now: () => string;
  private readonly id: () => string;
  private readonly rbac: RoleManager;

  constructor(options: OrgServiceOptions = {}) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.id = options.id ?? (() => newId('org'));
    this.rbac = options.roleManager ?? new RoleManager();
  }

  /** Guards the calling role against a permission. */
  authorize(role: string, permission: Permission, context: { userId?: string; tenantId?: string } = {}): void {
    this.rbac.requirePermission(role, permission, context);
  }

  // -------------------------------------------------------------------------
  // Organizations
  // -------------------------------------------------------------------------

  async createOrganization(tenantId: string, name: string): Promise<Organization> {
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      throw new EnterpriseValidationError('Organization name is required.');
    }
    const timestamp = this.now();
    const organization: Organization = {
      organizationId: this.id(),
      tenantId,
      name: trimmed,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.organizations.set(organization.organizationId, organization);
    return { ...organization };
  }

  async getOrganization(tenantId: string, organizationId: string): Promise<Organization> {
    return this.getOrgOrThrow(tenantId, organizationId);
  }

  async listOrganizations(tenantId: string): Promise<Organization[]> {
    return scopeRecords([...this.organizations.values()], tenantId)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((org) => ({ ...org }));
  }

  async updateOrganization(tenantId: string, organizationId: string, name: string): Promise<Organization> {
    const organization = this.getOrgOrThrow(tenantId, organizationId);
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      throw new EnterpriseValidationError('Organization name is required.');
    }
    organization.name = trimmed;
    organization.updatedAt = this.now();
    return { ...organization };
  }

  async removeOrganization(tenantId: string, organizationId: string): Promise<void> {
    const organization = this.getOrgOrThrow(tenantId, organizationId);
    this.organizations.delete(organization.organizationId);
    for (const [key, team] of this.teams) {
      if (team.organizationId === organizationId && team.tenantId === tenantId) {
        this.teams.delete(key);
      }
    }
    for (const [key, member] of this.memberships) {
      if (member.organizationId === organizationId && member.tenantId === tenantId) {
        this.memberships.delete(key);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Teams
  // -------------------------------------------------------------------------

  async createTeam(tenantId: string, organizationId: string, name: string): Promise<Team> {
    this.getOrgOrThrow(tenantId, organizationId);
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      throw new EnterpriseValidationError('Team name is required.');
    }
    const timestamp = this.now();
    const team: Team = {
      teamId: this.id(),
      tenantId,
      organizationId,
      name: trimmed,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.teams.set(team.teamId, team);
    return { ...team };
  }

  async getTeam(tenantId: string, teamId: string): Promise<Team> {
    return this.getTeamOrThrow(tenantId, teamId);
  }

  async listTeams(tenantId: string, organizationId?: string): Promise<Team[]> {
    const teams = scopeRecords([...this.teams.values()], tenantId).filter(
      (team) => organizationId === undefined || team.organizationId === organizationId,
    );
    return teams.sort((a, b) => a.name.localeCompare(b.name)).map((team) => ({ ...team }));
  }

  async updateTeam(tenantId: string, teamId: string, name: string): Promise<Team> {
    const team = this.getTeamOrThrow(tenantId, teamId);
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      throw new EnterpriseValidationError('Team name is required.');
    }
    team.name = trimmed;
    team.updatedAt = this.now();
    return { ...team };
  }

  async removeTeam(tenantId: string, teamId: string): Promise<void> {
    const team = this.getTeamOrThrow(tenantId, teamId);
    this.teams.delete(team.teamId);
    for (const [key, member] of this.teamMembers) {
      if (member.teamId === teamId && member.tenantId === tenantId) {
        this.teamMembers.delete(key);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Organization membership
  // -------------------------------------------------------------------------

  async addMember(tenantId: string, organizationId: string, userId: string, role: Role): Promise<OrganizationMember> {
    this.getOrgOrThrow(tenantId, organizationId);
    assertRole(role);
    if (this.hasMembership(tenantId, organizationId, userId)) {
      throw new EnterpriseConflictError(
        `User '${userId}' is already a member of organization '${organizationId}'.`,
        { tenantId, resourceId: organizationId },
      );
    }
    const timestamp = this.now();
    const member: OrganizationMember = {
      membershipId: this.id(),
      tenantId,
      organizationId,
      userId,
      role,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.memberships.set(member.membershipId, member);
    return { ...member };
  }

  async listMembers(tenantId: string, organizationId: string): Promise<OrganizationMember[]> {
    this.getOrgOrThrow(tenantId, organizationId);
    return [...this.memberships.values()]
      .filter((member) => member.organizationId === organizationId && member.tenantId === tenantId)
      .sort((a, b) => a.userId.localeCompare(b.userId))
      .map((member) => ({ ...member }));
  }

  async updateMemberRole(
    tenantId: string,
    organizationId: string,
    userId: string,
    role: Role,
  ): Promise<OrganizationMember> {
    const member = this.getMembershipOrThrow(tenantId, organizationId, userId);
    assertRole(role);
    member.role = role;
    member.updatedAt = this.now();
    return { ...member };
  }

  async removeMember(tenantId: string, organizationId: string, userId: string): Promise<void> {
    const member = this.getMembershipOrThrow(tenantId, organizationId, userId);
    this.memberships.delete(member.membershipId);
  }

  // -------------------------------------------------------------------------
  // Team membership
  // -------------------------------------------------------------------------

  async addTeamMember(tenantId: string, teamId: string, userId: string, role: Role): Promise<TeamMember> {
    const team = this.getTeamOrThrow(tenantId, teamId);
    assertRole(role);
    if (this.hasTeamMember(tenantId, teamId, userId)) {
      throw new EnterpriseConflictError(`User '${userId}' is already on team '${teamId}'.`, {
        tenantId,
        resourceId: teamId,
      });
    }
    const timestamp = this.now();
    const member: TeamMember = {
      teamMemberId: this.id(),
      tenantId,
      teamId: team.teamId,
      userId,
      role,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.teamMembers.set(member.teamMemberId, member);
    return { ...member };
  }

  async listTeamMembers(tenantId: string, teamId: string): Promise<TeamMember[]> {
    this.getTeamOrThrow(tenantId, teamId);
    return [...this.teamMembers.values()]
      .filter((member) => member.teamId === teamId && member.tenantId === tenantId)
      .sort((a, b) => a.userId.localeCompare(b.userId))
      .map((member) => ({ ...member }));
  }

  async updateTeamMemberRole(tenantId: string, teamId: string, userId: string, role: Role): Promise<TeamMember> {
    const member = this.getTeamMemberOrThrow(tenantId, teamId, userId);
    assertRole(role);
    member.role = role;
    member.updatedAt = this.now();
    return { ...member };
  }

  async removeTeamMember(tenantId: string, teamId: string, userId: string): Promise<void> {
    const member = this.getTeamMemberOrThrow(tenantId, teamId, userId);
    this.teamMembers.delete(member.teamMemberId);
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private getOrgOrThrow(tenantId: string, organizationId: string): Organization {
    const organization = this.organizations.get(organizationId);
    if (organization === undefined) {
      throw new EnterpriseNotFoundError(`Organization '${organizationId}' not found.`, {
        tenantId,
        resourceId: organizationId,
      });
    }
    assertSameTenant(organization.tenantId, tenantId);
    return organization;
  }

  private getTeamOrThrow(tenantId: string, teamId: string): Team {
    const team = this.teams.get(teamId);
    if (team === undefined) {
      throw new EnterpriseNotFoundError(`Team '${teamId}' not found.`, { tenantId, resourceId: teamId });
    }
    assertSameTenant(team.tenantId, tenantId);
    return team;
  }

  private hasMembership(tenantId: string, organizationId: string, userId: string): boolean {
    return [...this.memberships.values()].some(
      (member) =>
        member.tenantId === tenantId && member.organizationId === organizationId && member.userId === userId,
    );
  }

  private hasTeamMember(tenantId: string, teamId: string, userId: string): boolean {
    return [...this.teamMembers.values()].some(
      (member) => member.tenantId === tenantId && member.teamId === teamId && member.userId === userId,
    );
  }

  private getMembershipOrThrow(tenantId: string, organizationId: string, userId: string): OrganizationMember {
    const member = [...this.memberships.values()].find(
      (candidate) =>
        candidate.tenantId === tenantId &&
        candidate.organizationId === organizationId &&
        candidate.userId === userId,
    );
    if (member === undefined) {
      throw new EnterpriseNotFoundError(
        `User '${userId}' is not a member of organization '${organizationId}'.`,
        { tenantId, resourceId: organizationId },
      );
    }
    return member;
  }

  private getTeamMemberOrThrow(tenantId: string, teamId: string, userId: string): TeamMember {
    const member = [...this.teamMembers.values()].find(
      (candidate) => candidate.tenantId === tenantId && candidate.teamId === teamId && candidate.userId === userId,
    );
    if (member === undefined) {
      throw new EnterpriseNotFoundError(`User '${userId}' is not a member of team '${teamId}'.`, {
        tenantId,
        resourceId: teamId,
      });
    }
    return member;
  }
}

function assertRole(role: string): void {
  if (!MEMBER_ROLES.includes(role as Role)) {
    throw new EnterpriseValidationError(`Invalid role '${role}'.`, { permission: role });
  }
}
