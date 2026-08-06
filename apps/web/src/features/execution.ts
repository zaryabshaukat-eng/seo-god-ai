import { createApiFunctions } from './api-helpers.js';
import { badgeEl, cardEl, tableEl } from '../ui/primitives.js';
import { pageHeaderEl } from '../ui/layout.js';
import { className, h } from '../vdom.js';
import type { ApiClient } from '../api/client.js';
import type { BadgeTone, Execution, ExecutionAction, Permission, Role, TimelineEvent, VNode } from '../types.js';

const ROLE_RANK: Record<Role, number> = { viewer: 0, member: 1, admin: 2, owner: 3 };

/** Numeric rank of a role for approval gating. */
export function roleRank(role: Role): number {
  return ROLE_RANK[role] ?? 0;
}

/** Badge tone for an execution status. */
export function executionStatusTone(status: Execution['status']): BadgeTone {
  switch (status) {
    case 'completed':
      return 'success';
    case 'running':
    case 'approved':
      return 'info';
    case 'awaiting-approval':
    case 'draft':
      return 'warning';
    case 'failed':
    case 'rolled-back':
    case 'cancelled':
      return 'danger';
    default:
      return 'neutral';
  }
}

/**
 * Whether the current user may act on an execution: they need the write
 * permission and a role at least as high as the execution's approval role.
 */
export function canActOnExecution(
  execution: Execution,
  userRole: Role,
  permissions: readonly Permission[],
): boolean {
  return permissions.includes('execution.write') && roleRank(userRole) >= roleRank(execution.approvalRole);
}

/** Builds an ordered timeline from an execution's lifecycle. */
export function buildExecutionTimeline(execution: Execution): TimelineEvent[] {
  const events: TimelineEvent[] = [
    { id: `${execution.id}-created`, at: execution.createdAt, type: 'execution', title: `Created by ${execution.createdBy}`, status: 'info' },
  ];
  if (execution.startedAt !== undefined) {
    events.push({ id: `${execution.id}-started`, at: execution.startedAt, type: 'execution', title: 'Execution started', status: 'running' });
  }
  if (execution.completedAt !== undefined) {
    const success = execution.status === 'completed';
    events.push({ id: `${execution.id}-done`, at: execution.completedAt, type: 'execution', title: success ? 'Execution completed' : `Execution ${execution.status}`, status: success ? 'success' : 'error' });
  }
  return events.sort((a, b) => a.at - b.at);
}

export interface ExecutionActionModel {
  action: ExecutionAction;
  label: string;
  tone: 'secondary' | 'danger';
}

/** Action buttons available for an execution given the actor. */
export function availableActions(
  execution: Execution,
  userRole: Role,
  permissions: readonly Permission[],
): ExecutionActionModel[] {
  if (!canActOnExecution(execution, userRole, permissions)) {
    return [];
  }
  switch (execution.status) {
    case 'awaiting-approval':
      return [
        { action: 'approve', label: 'Approve', tone: 'secondary' },
        { action: 'reject', label: 'Reject', tone: 'danger' },
      ];
    case 'approved':
      return [{ action: 'run', label: 'Run', tone: 'secondary' }];
    case 'running':
      return [{ action: 'rollback', label: 'Roll back', tone: 'danger' }];
    default:
      return [];
  }
}

/** Renders the execution management page. */
export function renderExecutionsPage(model: {
  executions: Execution[];
  userRole: Role;
  permissions: readonly Permission[];
}): VNode {
  const rows = model.executions.map((execution) => {
    const actions = availableActions(execution, model.userRole, model.permissions).map((action) =>
      h(
        'a',
        {
          class: className('btn', action.tone === 'danger' ? 'btn--danger' : 'btn--secondary'),
          href: '#',
          'data-action': `execution:${action.action}:${execution.id}`,
        },
        action.label,
      ),
    );
    return {
      id: execution.id,
      title: execution.title,
      store: execution.storeId,
      status: badgeEl({ label: execution.status, tone: executionStatusTone(execution.status) }),
      risk: badgeEl({ label: execution.risk, tone: riskTone(execution.risk) }),
      changes: String(execution.changes),
      actions: actions.length > 0 ? h('div', { class: 'row-actions' }, ...actions) : '—',
    };
  });

  const table = tableEl({
    id: 'executions-table',
    caption: 'Executions',
    columns: [
      { key: 'id', label: 'Execution' },
      { key: 'title', label: 'Title' },
      { key: 'store', label: 'Store' },
      { key: 'status', label: 'Status' },
      { key: 'risk', label: 'Risk' },
      { key: 'changes', label: 'Changes', align: 'right' },
      { key: 'actions', label: 'Actions' },
    ],
    rows,
    emptyText: 'No executions to review.',
  });

  return h(
    'main',
    { id: 'main', class: 'page' },
    pageHeaderEl({ title: 'Execution management', subtitle: 'Review and approve AI-driven changes' }),
    cardEl({ title: 'Executions', children: [table] }),
  );
}

/** Renders an execution detail page with its timeline. */
export function renderExecutionDetailPage(execution: Execution, timeline: TimelineEvent[]): VNode {
  const steps = timeline.map((event) =>
    h(
      'li',
      { class: 'timeline__item', key: event.id },
      h('span', { class: className('timeline__dot', `timeline__dot--${event.status}`) }),
      h('div', {}, h('strong', {}, event.title), h('time', {}, new Date(event.at).toLocaleString())),
    ),
  );
  const error = execution.error ? h('p', { class: 'form__error', role: 'alert' }, execution.error) : undefined;
  return h(
    'main',
    { id: 'main', class: 'page' },
    pageHeaderEl({ title: execution.title, subtitle: `Execution ${execution.id} · ${execution.storeId}` }),
    cardEl({ title: 'Timeline', children: [h('ul', { class: 'timeline' }, ...steps)] }),
    error,
  );
}

function riskTone(risk: Execution['risk']): BadgeTone {
  switch (risk) {
    case 'high':
      return 'danger';
    case 'medium':
      return 'warning';
    default:
      return 'success';
  }
}

/** REST wrappers for execution endpoints. */
export function createExecutionApi(api: ApiClient) {
  const call = createApiFunctions(api);
  return {
    list() {
      return call.get<Execution[]>('executionsList');
    },
    get(id: string) {
      return call.get<Execution>('executionsGet', { id });
    },
    approve(id: string) {
      return call.post<Execution>('executionsApprove', undefined, { id });
    },
    reject(id: string) {
      return call.post<Execution>('executionsReject', undefined, { id });
    },
    rollback(id: string) {
      return call.post<Execution>('executionsRollback', undefined, { id });
    },
    run(id: string) {
      return call.post<Execution>('executionsRun', undefined, { id });
    },
  };
}
