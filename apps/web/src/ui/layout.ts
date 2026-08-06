import { className, h } from '../vdom.js';
import { ariaCurrent } from './access.js';
import type { BreakpointName } from '../theme/responsive.js';
import type { VChild, VNode } from '../types.js';

/** Column span per breakpoint. */
export type ColSpans = Partial<Record<BreakpointName, number>>;

export function containerEl(children: VChild[], maxWidthPx = 1280): VNode {
  return h('div', { class: 'container', style: `max-width:${maxWidthPx}px` }, ...children);
}

export function gridEl(children: VChild[], cols: ColSpans = {}): VNode {
  const classes = Object.entries(cols).map(([bp, span]) => `grid-cols-${bp}:${span}`);
  return h('div', { class: className('grid', ...classes) }, ...children);
}

export function colEl(children: VChild[], spans: ColSpans = {}): VNode {
  const classes = Object.entries(spans).map(([bp, span]) => `col-${bp}:${span}`);
  return h('div', { class: className('col', ...classes) }, ...children);
}

export function stackEl(children: VChild[], gap: 'xs' | 'sm' | 'md' | 'lg' = 'md'): VNode {
  return h('div', { class: className('stack', `stack--${gap}`) }, ...children);
}

export interface NavLinkProps {
  href: string;
  label: string;
  icon?: string;
  active?: boolean;
  dataAction?: string;
}

export function navLinkEl(props: NavLinkProps): VNode {
  const icon = props.icon ? h('span', { class: 'nav__icon', 'aria-hidden': 'true' }, props.icon) : undefined;
  return h(
    'a',
    {
      class: className('nav__link', props.active && 'nav__link--active'),
      href: props.href,
      'aria-current': ariaCurrent(props.active ?? false),
      'data-action': props.dataAction,
    },
    icon,
    h('span', { class: 'nav__label' }, props.label),
  );
}

export interface PageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: VChild[];
  id?: string;
}

export function pageHeaderEl(props: PageHeaderProps): VNode {
  const heading = h('h1', { class: 'page-header__title', id: props.id ?? 'main-title' }, props.title);
  const subtitle = props.subtitle ? h('p', { class: 'page-header__subtitle' }, props.subtitle) : undefined;
  const actions = props.actions && props.actions.length > 0 ? h('div', { class: 'page-header__actions' }, ...props.actions) : undefined;
  return h('header', { class: 'page-header' }, heading, subtitle, actions);
}

export interface AppShellModel {
  sidebar: VChild[];
  topbar: VChild[];
  main: VChild[];
  footer?: VChild[];
}

/** Full application shell: skip link, sidebar, topbar and `<main id="main">`. */
export function appShellEl(model: AppShellModel): VNode {
  return h(
    'div',
    { class: 'app-shell' },
    h('aside', { class: 'app-shell__sidebar', 'aria-label': 'Primary' }, ...model.sidebar),
    h('div', { class: 'app-shell__content' }, h('header', { class: 'app-shell__topbar' }, ...model.topbar), h('main', { id: 'main', class: 'app-shell__main' }, ...model.main)),
  );
}
