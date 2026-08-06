import { describe, expect, it } from 'vitest';
import { renderToString } from '../vdom.js';
import { kpiCardEl } from './shared-render.js';

describe('kpiCardEl', () => {
  it('renders a card with a tone class', () => {
    const html = renderToString(kpiCardEl({ id: 'pages', label: 'Pages', value: '120', tone: 'success' }));
    expect(html).toContain('kpi-card--success');
    expect(html).toContain('id="kpi-pages"');
    expect(html).toContain('>120</div>');
    expect(html).toContain('>Pages</div>');
  });
});
