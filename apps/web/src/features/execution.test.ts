import { describe, expect, it } from 'vitest';
import { renderToString } from '../vdom.js';
import type { Execution } from '../types.js';
import { Permissions } from '../api/endpoints.js';
import {
  availableActions,
  buildExecutionTimeline,
  canActOnExecution,
  createExecutionApi,
  executionStatusTone,
  renderExecutionDetailPage,
  renderExecutionsPage,
  roleRank,
} from './execution.js';

const EXECUTION: Execution = {
  id: 'e1',
  title: 'Fix title tags',
  storeId: 'store-1',
  status: 'awaiting-approval',
  risk: 'high',
  changes: 5,
  createdAt: 100,
  createdBy: 'ada@x.com',
  approvalRole: 'admin',
  startedAt: undefined,
  completedAt: undefined,
  error: undefined,
};

const WRITE = [Permissions.executionWrite];

describe('roleRank', () => {
  it('ranks roles', () => {
    expect(roleRank('viewer')).toBe(0);
    expect(roleRank('member')).toBe(1);
    expect(roleRank('admin')).toBe(2);
    expect(roleRank('owner')).toBe(3);
  });

  it('defaults unknown roles to zero', () => {
    expect(roleRank('custom' as never)).toBe(0);
  });
});

describe('executionStatusTone', () => {
  it('maps statuses to tones', () => {
    expect(executionStatusTone('completed')).toBe('success');
    expect(executionStatusTone('running')).toBe('info');
    expect(executionStatusTone('approved')).toBe('info');
    expect(executionStatusTone('awaiting-approval')).toBe('warning');
    expect(executionStatusTone('draft')).toBe('warning');
    expect(executionStatusTone('failed')).toBe('danger');
    expect(executionStatusTone('rolled-back')).toBe('danger');
    expect(executionStatusTone('cancelled')).toBe('danger');
  });

  it('defaults unknown statuses to neutral', () => {
    expect(executionStatusTone('queued' as never)).toBe('neutral');
  });
});

describe('canActOnExecution', () => {
  it('requires the write permission and sufficient role', () => {
    expect(canActOnExecution(EXECUTION, 'admin', WRITE)).toBe(true);
    expect(canActOnExecution(EXECUTION, 'member', WRITE)).toBe(false);
    expect(canActOnExecution(EXECUTION, 'owner', [Permissions.executionRead])).toBe(false);
  });
});

describe('buildExecutionTimeline', () => {
  it('builds a sorted timeline', () => {
    const timeline = buildExecutionTimeline({ ...EXECUTION, startedAt: 150, completedAt: 200, status: 'completed' });
    expect(timeline.map((event) => event.title)).toEqual(['Created by ada@x.com', 'Execution started', 'Execution completed']);
  });

  it('marks failure with an error status', () => {
    const timeline = buildExecutionTimeline({ ...EXECUTION, startedAt: 150, completedAt: 200, status: 'failed' });
    expect(timeline[2]).toMatchObject({ status: 'error' });
  });

  it('omits optional lifecycle events', () => {
    expect(buildExecutionTimeline(EXECUTION)).toHaveLength(1);
  });
});

describe('availableActions', () => {
  it('offers approve/reject for pending work', () => {
    expect(availableActions(EXECUTION, 'admin', WRITE).map((a) => a.action)).toEqual(['approve', 'reject']);
  });

  it('offers run once approved', () => {
    expect(availableActions({ ...EXECUTION, status: 'approved' }, 'admin', WRITE).map((a) => a.action)).toEqual(['run']);
  });

  it('offers rollback while running', () => {
    expect(availableActions({ ...EXECUTION, status: 'running' }, 'admin', WRITE).map((a) => a.action)).toEqual(['rollback']);
  });

  it('returns nothing without permission or for terminal states', () => {
    expect(availableActions(EXECUTION, 'member', WRITE)).toEqual([]);
    expect(availableActions({ ...EXECUTION, status: 'completed' }, 'admin', WRITE)).toEqual([]);
  });
});

describe('renderExecutionsPage', () => {
  it('renders rows with action buttons', () => {
    const html = renderToString(renderExecutionsPage({ executions: [EXECUTION], userRole: 'admin', permissions: WRITE }));
    expect(html).toContain('id="executions-table"');
    expect(html).toContain('data-action="execution:approve:e1"');
    expect(html).toContain('badge--danger');
  });

  it('renders a read-only empty table', () => {
    const html = renderToString(renderExecutionsPage({ executions: [], userRole: 'viewer', permissions: [] }));
    expect(html).toContain('No executions to review.');
  });

  it('renders a dash for rows without actions', () => {
    const html = renderToString(
      renderExecutionsPage({
        executions: [{ ...EXECUTION, status: 'completed', risk: 'medium' }],
        userRole: 'admin',
        permissions: WRITE,
      }),
    );
    expect(html).toContain('>—</td>');
    expect(html).toContain('badge--warning');
  });
});

describe('renderExecutionDetailPage', () => {
  it('renders the timeline and an error', () => {
    const html = renderToString(
      renderExecutionDetailPage({ ...EXECUTION, error: 'boom' }, [{ id: 't', at: 100, type: 'execution', title: 'Created', status: 'info' }]),
    );
    expect(html).toContain('Fix title tags');
    expect(html).toContain('class="timeline"');
    expect(html).toContain('timeline__dot--info');
    expect(html).toContain('>boom</p>');
  });

  it('renders without an error', () => {
    const html = renderToString(
      renderExecutionDetailPage(EXECUTION, [{ id: 't', at: 100, type: 'execution', title: 'Created', status: 'info' }]),
    );
    expect(html).not.toContain('role="alert"');
  });

  it('tones low-risk executions as success', () => {
    const html = renderToString(
      renderExecutionsPage({
        executions: [{ ...EXECUTION, status: 'awaiting-approval', risk: 'low' }],
        userRole: 'admin',
        permissions: WRITE,
      }),
    );
    expect(html).toContain('badge--success');
  });
});

describe('createExecutionApi', () => {
  it('wraps execution endpoints onto the client', async () => {
    const calls: Array<{ method: string; url: string; body: unknown }> = [];
    const api = {
      request: async <T>(method: string, url: string, body: unknown): Promise<T> => {
        calls.push({ method, url, body });
        return { ok: true } as T;
      },
    } as never;
    const execApi = createExecutionApi(api);
    await execApi.list();
    await execApi.get('e1');
    await execApi.approve('e1');
    await execApi.reject('e1');
    await execApi.rollback('e1');
    await execApi.run('e1');
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      'GET /api/v1/executions',
      'GET /api/v1/executions/e1',
      'POST /api/v1/executions/e1/approve',
      'POST /api/v1/executions/e1/reject',
      'POST /api/v1/executions/e1/rollback',
      'POST /api/v1/executions/e1/run',
    ]);
  });
});
