import { describe, expect, it } from 'vitest';
import {
  EnterpriseConflictError,
  EnterpriseIsolationError,
  EnterpriseNotFoundError,
  EnterpriseValidationError,
} from './errors.js';
import { Permissions, RoleManager } from './rbac.js';
import { OrgService } from './orgs.js';

const FIXED = '2026-01-01T00:00:00.000Z';

function makeService(): OrgService {
  return new OrgService({ now: () => FIXED });
}

describe('organizations', () => {
  it('creates and lists organizations per tenant', async () => {
    const service = makeService();
    const org = await service.createOrganization('t1', '  Acme Inc  ');
    expect(org.organizationId).toMatch(/^org_/);
    expect(org.name).toBe('Acme Inc');
    expect(org.tenantId).toBe('t1');
    await service.createOrganization('t1', 'Beta');
    await service.createOrganization('t2', 'Other');
    const names = (await service.listOrganizations('t1')).map((o) => o.name);
    expect(names).toEqual(['Acme Inc', 'Beta']);
    expect(await service.listOrganizations('t2')).toHaveLength(1);
  });

  it('rejects blank names and unknown organizations', async () => {
    const service = makeService();
    await expect(service.createOrganization('t1', '   ')).rejects.toThrow(EnterpriseValidationError);
    await expect(service.getOrganization('t1', 'org_missing')).rejects.toThrow(EnterpriseNotFoundError);
  });

  it('updates and removes organizations cascading teams and members', async () => {
    const service = makeService();
    const org = await service.createOrganization('t1', 'Acme');
    const team = await service.createTeam('t1', org.organizationId, 'SEO');
    await service.addMember('t1', org.organizationId, 'u1', 'member');

    const updated = await service.updateOrganization('t1', org.organizationId, 'Acme Corp');
    expect(updated.name).toBe('Acme Corp');
    await expect(service.updateOrganization('t1', org.organizationId, ' ')).rejects.toThrow(
      EnterpriseValidationError,
    );

    await service.removeOrganization('t1', org.organizationId);
    await expect(service.getOrganization('t1', org.organizationId)).rejects.toThrow(EnterpriseNotFoundError);
    expect(await service.listTeams('t1')).toHaveLength(0);
    await expect(service.listMembers('t1', org.organizationId)).rejects.toThrow(EnterpriseNotFoundError);
    await expect(service.getTeam('t1', team.teamId)).rejects.toThrow(EnterpriseNotFoundError);
  });

  it('isolates organizations between tenants', async () => {
    const service = makeService();
    const org = await service.createOrganization('t1', 'Acme');
    await expect(service.getOrganization('t2', org.organizationId)).rejects.toThrow(EnterpriseIsolationError);
  });
});

describe('teams', () => {
  it('creates and lists teams scoped to an organization', async () => {
    const service = makeService();
    const org = await service.createOrganization('t1', 'Acme');
    const seo = await service.createTeam('t1', org.organizationId, 'SEO');
    expect(seo.teamId).toMatch(/^org_/);
    await service.createTeam('t1', org.organizationId, 'Growth');
    await expect(service.createTeam('t2', org.organizationId, 'Foreign')).rejects.toThrow(EnterpriseIsolationError);
    const names = (await service.listTeams('t1')).map((t) => t.name);
    expect(names).toEqual(['Growth', 'SEO']);
    expect(await service.listTeams('t1', org.organizationId)).toHaveLength(2);
    expect(await service.listTeams('t2')).toHaveLength(0);
  });

  it('rejects teams for unknown orgs and blank names', async () => {
    const service = makeService();
    await expect(service.createTeam('t1', 'org_missing', 'SEO')).rejects.toThrow(EnterpriseNotFoundError);
    const org = await service.createOrganization('t1', 'Acme');
    await expect(service.createTeam('t1', org.organizationId, ' ')).rejects.toThrow(EnterpriseValidationError);
  });

  it('updates and removes teams', async () => {
    const service = makeService();
    const org = await service.createOrganization('t1', 'Acme');
    const team = await service.createTeam('t1', org.organizationId, 'SEO');
    await service.addTeamMember('t1', team.teamId, 'u1', 'member');

    const updated = await service.updateTeam('t1', team.teamId, 'Organic');
    expect(updated.name).toBe('Organic');
    await expect(service.updateTeam('t1', team.teamId, ' ')).rejects.toThrow(EnterpriseValidationError);

    await service.removeTeam('t1', team.teamId);
    await expect(service.getTeam('t1', team.teamId)).rejects.toThrow(EnterpriseNotFoundError);
    await expect(service.listTeamMembers('t1', team.teamId)).rejects.toThrow(EnterpriseNotFoundError);
  });
});

describe('membership', () => {
  it('manages organization members and their roles', async () => {
    const service = makeService();
    const org = await service.createOrganization('t1', 'Acme');
    const member = await service.addMember('t1', org.organizationId, 'u1', 'viewer');
    expect(member.membershipId).toMatch(/^org_/);
    await service.addMember('t1', org.organizationId, 'u2', 'admin');

    const roles = new Map(
      (await service.listMembers('t1', org.organizationId)).map((m) => [m.userId, m.role]),
    );
    expect(roles.get('u1')).toBe('viewer');
    expect(roles.get('u2')).toBe('admin');

    const promoted = await service.updateMemberRole('t1', org.organizationId, 'u1', 'owner');
    expect(promoted.role).toBe('owner');

    await service.removeMember('t1', org.organizationId, 'u2');
    const remaining = await service.listMembers('t1', org.organizationId);
    expect(remaining.map((m) => m.userId)).toEqual(['u1']);
  });

  it('rejects duplicate memberships, bad roles and unknown users', async () => {
    const service = makeService();
    const org = await service.createOrganization('t1', 'Acme');
    await service.addMember('t1', org.organizationId, 'u1', 'member');
    await expect(service.addMember('t1', org.organizationId, 'u1', 'admin')).rejects.toThrow(
      EnterpriseConflictError,
    );
    await expect(service.addMember('t1', org.organizationId, 'u2', 'superuser' as never)).rejects.toThrow(
      EnterpriseValidationError,
    );
    await expect(service.removeMember('t1', org.organizationId, 'ghost')).rejects.toThrow(EnterpriseNotFoundError);
    await expect(service.updateMemberRole('t1', org.organizationId, 'ghost', 'admin')).rejects.toThrow(
      EnterpriseNotFoundError,
    );
  });

  it('manages team members', async () => {
    const service = makeService();
    const org = await service.createOrganization('t1', 'Acme');
    const team = await service.createTeam('t1', org.organizationId, 'SEO');
    const member = await service.addTeamMember('t1', team.teamId, 'u1', 'member');
    expect(member.teamMemberId).toMatch(/^org_/);
    await service.addTeamMember('t1', team.teamId, 'u2', 'viewer');

    await expect(service.addTeamMember('t1', team.teamId, 'u1', 'admin')).rejects.toThrow(EnterpriseConflictError);
    await expect(service.addTeamMember('t1', team.teamId, 'u3', 'boss' as never)).rejects.toThrow(EnterpriseValidationError);

    const promoted = await service.updateTeamMemberRole('t1', team.teamId, 'u2', 'admin');
    expect(promoted.role).toBe('admin');
    await expect(service.updateTeamMemberRole('t1', team.teamId, 'ghost', 'admin')).rejects.toThrow(
      EnterpriseNotFoundError,
    );

    await service.removeTeamMember('t1', team.teamId, 'u1');
    const remaining = await service.listTeamMembers('t1', team.teamId);
    expect(remaining.map((m) => m.userId)).toEqual(['u2']);
    await expect(service.removeTeamMember('t1', team.teamId, 'ghost')).rejects.toThrow(EnterpriseNotFoundError);
  });
});

describe('RBAC guard', () => {
  it('delegates to the shared role manager', () => {
    const rbac = new RoleManager();
    const service = new OrgService({ roleManager: rbac });
    expect(() => service.authorize('admin', Permissions.teamManage)).not.toThrow();
    expect(() => service.authorize('viewer', Permissions.teamManage)).toThrow();
  });
});
