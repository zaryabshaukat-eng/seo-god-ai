import { createApiFunctions } from './api-helpers.js';
import { badgeEl, cardEl, formEl, inputEl, tableEl } from '../ui/primitives.js';
import { gridEl, pageHeaderEl } from '../ui/layout.js';
import { kpiCardEl } from './shared-render.js';
import { h } from '../vdom.js';
import type { ApiClient } from '../api/client.js';
import type { BadgeTone, Crawl, VNode } from '../types.js';

export interface CrawlStartInput {
  storeId: string;
}

/** Validates the start-crawl form. */
export function validateStartCrawlInput(input: CrawlStartInput): { storeId?: string } {
  const errors: { storeId?: string } = {};
  if (input.storeId.trim().length === 0) {
    errors.storeId = 'Store ID is required.';
  }
  return errors;
}

/** Badge tone for a crawl status. */
export function crawlStatusTone(status: Crawl['status']): BadgeTone {
  switch (status) {
    case 'completed':
      return 'success';
    case 'running':
    case 'queued':
      return 'info';
    case 'paused':
      return 'warning';
    case 'failed':
    case 'cancelled':
      return 'danger';
    default:
      return 'neutral';
  }
}

/** Builds KPI cards describing a crawl's outcome. */
export function crawlStats(crawl: Crawl): Array<{ id: string; label: string; value: string; tone: BadgeTone }> {
  return [
    { id: 'pages', label: 'Pages crawled', value: String(crawl.pages), tone: 'neutral' },
    { id: 'issues', label: 'Issues found', value: String(crawl.issues), tone: crawl.issues > 0 ? 'warning' : 'success' },
    { id: 'status', label: 'Status', value: crawl.status, tone: crawlStatusTone(crawl.status) },
  ];
}

/** Renders the crawl management page: list table + start form. */
export function renderCrawlsPage(model: {
  crawls: Crawl[];
  canWrite: boolean;
  startInput: CrawlStartInput;
  startErrors: { storeId?: string };
  error?: string;
}): VNode {
  const rows = model.crawls.map((crawl) => ({
    id: crawl.id,
    store: crawl.storeId,
    status: badgeEl({ label: crawl.status, tone: crawlStatusTone(crawl.status) }),
    pages: String(crawl.pages),
    issues: String(crawl.issues),
    started: new Date(crawl.startedAt).toLocaleString(),
  }));

  const table = tableEl({
    id: 'crawls-table',
    caption: 'Recent crawls',
    columns: [
      { key: 'id', label: 'Crawl' },
      { key: 'store', label: 'Store' },
      { key: 'status', label: 'Status' },
      { key: 'pages', label: 'Pages', align: 'right' },
      { key: 'issues', label: 'Issues', align: 'right' },
      { key: 'started', label: 'Started' },
    ],
    rows,
    emptyText: 'No crawls yet. Start your first crawl.',
  });

  const startForm = model.canWrite
    ? formEl({
        id: 'start-crawl-form',
        title: 'Start a crawl',
        fields: [
          inputEl({
            id: 'crawl-store-id',
            label: 'Store ID',
            value: model.startInput.storeId,
            required: true,
            invalid: Boolean(model.startErrors.storeId),
            errorText: model.startErrors.storeId,
          }),
        ],
        submitLabel: 'Start crawl',
        errorText: model.error,
      })
    : undefined;

  return h(
    'main',
    { id: 'main', class: 'page' },
    pageHeaderEl({ title: 'Crawl management', subtitle: 'Schedule and inspect site crawls' }),
    gridEl([cardEl({ title: 'Crawls', children: [table] }), startForm ? cardEl({ title: 'Start a crawl', children: [startForm] }) : undefined]),
  );
}

/** Renders a single crawl's detail page. */
export function renderCrawlDetailPage(crawl: Crawl): VNode {
  const stats = crawlStats(crawl).map((stat) => kpiCardEl(stat));
  const error = crawl.error ? h('p', { class: 'form__error', role: 'alert' }, crawl.error) : undefined;
  return h(
    'main',
    { id: 'main', class: 'page' },
    pageHeaderEl({ title: `Crawl ${crawl.id}`, subtitle: `Store ${crawl.storeId}` }),
    gridEl(stats),
    error,
  );
}

/** REST wrappers for crawl endpoints. */
export function createCrawlApi(api: ApiClient) {
  const call = createApiFunctions(api);
  return {
    list() {
      return call.get<Crawl[]>('crawlsList');
    },
    start(storeId: string) {
      return call.post<Crawl>('crawlsStart', { storeId });
    },
    get(id: string) {
      return call.get<Crawl>('crawlsGet', { id });
    },
    cancel(id: string) {
      return call.post<void>('crawlsCancel', undefined, { id });
    },
  };
}
