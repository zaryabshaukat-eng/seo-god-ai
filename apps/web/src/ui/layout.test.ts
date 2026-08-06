import { describe, expect, it } from 'vitest';
import { renderToString } from '../vdom.js';
import { appShellEl, colEl, containerEl, gridEl, navLinkEl, pageHeaderEl, stackEl } from './layout.js';

describe('containerEl', () => {
  it('renders a container with a max width', () => {
    const html = renderToString(containerEl(['a', 'b']));
    expect(html).toContain('class="container"');
    expect(html).toContain('max-width:1280px');
  });
});

describe('gridEl', () => {
  it('renders responsive column classes', () => {
    const html = renderToString(gridEl(['a'], { md: 2, lg: 3 }));
    expect(html).toContain('grid-cols-md:2');
    expect(html).toContain('grid-cols-lg:3');
  });
});

describe('colEl', () => {
  it('renders responsive span classes', () => {
    const html = renderToString(colEl(['a'], { sm: 12, md: 6 }));
    expect(html).toContain('col-sm:12');
    expect(html).toContain('col-md:6');
  });
});

describe('stackEl', () => {
  it('renders a stack with a gap size', () => {
    expect(renderToString(stackEl(['a']))).toContain('stack--md');
    expect(renderToString(stackEl(['a'], 'xs'))).toContain('stack--xs');
  });
});

describe('navLinkEl', () => {
  it('renders a nav link with icon and active state', () => {
    const html = renderToString(navLinkEl({ href: '/crawls', label: 'Crawls', icon: 'search', active: true, dataAction: 'nav:crawls' }));
    expect(html).toContain('nav__link nav__link--active');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('data-action="nav:crawls"');
    expect(html).toContain('>Crawls</span>');
  });

  it('omits icon and current when inactive', () => {
    const html = renderToString(navLinkEl({ href: '/seo', label: 'SEO' }));
    expect(html).not.toContain('nav__icon');
    expect(html).not.toContain('aria-current');
  });
});

describe('pageHeaderEl', () => {
  it('renders title, subtitle and actions', () => {
    const html = renderToString(pageHeaderEl({ title: 'Crawls', subtitle: 'All', actions: ['btn'] }));
    expect(html).toContain('<h1');
    expect(html).toContain('id="main-title"');
    expect(html).toContain('page-header__subtitle');
    expect(html).toContain('page-header__actions');
  });

  it('omits optional sections', () => {
    const html = renderToString(pageHeaderEl({ title: 'Crawls' }));
    expect(html).not.toContain('page-header__subtitle');
    expect(html).not.toContain('page-header__actions');
  });
});

describe('appShellEl', () => {
  it('renders sidebar, topbar and main landmarks', () => {
    const html = renderToString(appShellEl({ sidebar: ['s'], topbar: ['t'], main: ['m'], footer: ['f'] }));
    expect(html).toContain('class="app-shell"');
    expect(html).toContain('aria-label="Primary"');
    expect(html).toContain('class="app-shell__topbar"');
    expect(html).toContain('<main');
  });
});
