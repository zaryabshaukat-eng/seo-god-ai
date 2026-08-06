/**
 * `@seogod/reports` — reporting package.
 *
 * Generates executive dashboards, SEO/KPI/trend/alert reports from
 * observability, learning, decision and Google-integration sources; renders
 * JSON/CSV/PDF; tracks KPI history and supports scheduled report runs.
 */

export * from './types.js';
export * from './utils.js';
export * from './errors.js';
export * from './aggregation.js';
export * from './csv.js';
export * from './pdf-writer.js';
export * from './pdf-renderer.js';
export * from './kpis.js';
export * from './sources.js';
export * from './templates.js';
export * from './engine.js';
export * from './scheduler.js';
export * from './metrics.js';
export * from './service.js';
