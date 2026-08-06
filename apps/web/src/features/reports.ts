import { createApiFunctions } from './api-helpers.js';
import { badgeEl, cardEl, formEl, inputEl, selectEl, tableEl } from '../ui/primitives.js';
import { gridEl, pageHeaderEl } from '../ui/layout.js';
import { className, h } from '../vdom.js';
import type { ApiClient } from '../api/client.js';
import type { BadgeTone, Kpi, Report, ReportDraft, ReportKind, VNode } from '../types.js';

export const REPORT_KIND_LABELS: Record<ReportKind, string> = {
  'seo-health': 'SEO health',
  crawl: 'Crawl report',
  execution: 'Execution report',
  rankings: 'Rankings',
  traffic: 'Traffic',
};

/** Badge tone for a report status. */
export function reportStatusTone(status: Report['status']): BadgeTone {
  switch (status) {
    case 'ready':
      return 'success';
    case 'generating':
      return 'info';
    case 'failed':
      return 'danger';
    default:
      return 'neutral';
  }
}

export type ReportDraftErrors = Partial<Record<'kind' | 'storeId' | 'days', string>>;

/** Validates a report generation draft. */
export function validateReportDraft(draft: ReportDraft): ReportDraftErrors {
  const errors: ReportDraftErrors = {};
  if (!(draft.kind in REPORT_KIND_LABELS)) {
    errors.kind = 'Choose a report type.';
  }
  if (draft.storeId.trim().length === 0) {
    errors.storeId = 'Store ID is required.';
  }
  if (!Number.isInteger(draft.days) || draft.days < 1 || draft.days > 365) {
    errors.days = 'Days must be between 1 and 365.';
  }
  return errors;
}

/** Renders the reports page: list + generation form. */
export function renderReportsPage(model: {
  reports: Report[];
  canWrite: boolean;
  draft: ReportDraft;
  draftErrors: ReportDraftErrors;
  error?: string;
}): VNode {
  const rows = model.reports.map((report) => ({
    id: report.id,
    title: report.title,
    kind: badgeEl({ label: REPORT_KIND_LABELS[report.kind] ?? report.kind, tone: 'info' }),
    status: badgeEl({ label: report.status, tone: reportStatusTone(report.status) }),
    store: report.storeId,
    created: new Date(report.createdAt).toLocaleDateString(),
  }));

  const table = tableEl({
    id: 'reports-table',
    caption: 'Generated reports',
    columns: [
      { key: 'id', label: 'Report' },
      { key: 'title', label: 'Title' },
      { key: 'kind', label: 'Kind' },
      { key: 'status', label: 'Status' },
      { key: 'store', label: 'Store' },
      { key: 'created', label: 'Created' },
    ],
    rows,
    emptyText: 'No reports yet.',
  });

  const kindOptions = (Object.keys(REPORT_KIND_LABELS) as ReportKind[]).map((kind) => ({
    value: kind,
    label: REPORT_KIND_LABELS[kind],
  }));

  const form = model.canWrite
    ? formEl({
        id: 'generate-report-form',
        title: 'Generate a report',
        fields: [
          selectEl({ id: 'report-kind', label: 'Report type', options: kindOptions, value: model.draft.kind, invalid: Boolean(model.draftErrors.kind), errorText: model.draftErrors.kind }),
          inputEl({ id: 'report-store', label: 'Store ID', value: model.draft.storeId, required: true, invalid: Boolean(model.draftErrors.storeId), errorText: model.draftErrors.storeId }),
          inputEl({ id: 'report-days', label: 'Days', type: 'number', value: String(model.draft.days), invalid: Boolean(model.draftErrors.days), errorText: model.draftErrors.days }),
        ],
        submitLabel: 'Generate',
        errorText: model.error,
      })
    : undefined;

  return h(
    'main',
    { id: 'main', class: 'page' },
    pageHeaderEl({ title: 'Reports', subtitle: 'Generate and inspect SEO reports' }),
    gridEl([cardEl({ title: 'Reports', children: [table] }), form ? cardEl({ title: 'Generate a report', children: [form] }) : undefined]),
  );
}

/** Renders a KPI list. */
export function kpiListEl(kpis: Kpi[]): VNode {
  const items = kpis.map((kpi) => {
    const change =
      kpi.changePct !== undefined
        ? h('span', { class: className('kpi-change', kpi.changePct >= 0 ? 'kpi-change--up' : 'kpi-change--down') }, `${kpi.changePct >= 0 ? '+' : ''}${kpi.changePct.toFixed(1)}%`)
        : undefined;
    return h('li', { class: 'report-kpi', key: kpi.label }, h('span', { class: 'report-kpi__value' }, kpi.value), h('span', { class: 'report-kpi__label' }, kpi.label), change);
  });
  return h('ul', { class: 'report-kpis' }, ...items);
}

/** Renders a single report's detail page. */
export function renderReportDetailPage(report: Report): VNode {
  const sections = report.sections.map((section) =>
    cardEl({
      title: section.title,
      subtitle: section.summary,
      children: [kpiListEl(section.kpis)],
    }),
  );
  const status = badgeEl({ label: report.status, tone: reportStatusTone(report.status) });
  return h(
    'main',
    { id: 'main', class: 'page' },
    pageHeaderEl({ title: report.title, subtitle: `Report ${report.id} · ${report.storeId}` }),
    h('div', {}, status),
    sections.length > 0 ? gridEl(sections, { sm: 1, lg: 2 }) : h('p', { class: 'muted' }, 'Report has no sections yet.'),
  );
}

/** REST wrappers for report endpoints. */
export function createReportsApi(api: ApiClient) {
  const call = createApiFunctions(api);
  return {
    list() {
      return call.get<Report[]>('reportsList');
    },
    generate(draft: ReportDraft) {
      return call.post<Report>('reportsGenerate', draft);
    },
    get(id: string) {
      return call.get<Report>('reportsGet', { id });
    },
  };
}
