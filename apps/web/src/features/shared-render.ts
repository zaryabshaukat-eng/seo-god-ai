import { className, h } from '../vdom.js';
import type { BadgeTone, VNode } from '../types.js';

export interface SharedKpiCardModel {
  id: string;
  label: string;
  value: string;
  tone: BadgeTone;
}

/** Renders a KPI card (reused across feature pages). */
export function kpiCardEl(card: SharedKpiCardModel): VNode {
  return h(
    'div',
    { class: className('kpi-card', `kpi-card--${card.tone}`), id: `kpi-${card.id}` },
    h('div', { class: 'kpi-card__value' }, card.value),
    h('div', { class: 'kpi-card__label' }, card.label),
  );
}
