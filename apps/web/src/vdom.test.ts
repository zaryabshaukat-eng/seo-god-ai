import { describe, expect, it } from 'vitest';
import { className, documentHtml, escapeAttr, escapeHtml, flatten, h, renderAttrs, renderNode, renderToString } from './vdom.js';

describe('escapeHtml', () => {
  it('escapes the HTML-significant characters', () => {
    expect(escapeHtml(`<a href="x">'&</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&lt;/a&gt;');
  });
});

describe('escapeAttr', () => {
  it('escapes double-quote-sensitive characters', () => {
    expect(escapeAttr('a"b&c<d')).toBe('a&quot;b&amp;c&lt;d');
  });
});

describe('flatten', () => {
  it('flattens nested arrays and drops falsy nodes', () => {
    const flat = flatten([h('span'), [null, undefined, false, 0, 'x'], ['nested', [h('b')]]] as unknown as Parameters<typeof flatten>[0]);
    expect(flat).toHaveLength(5);
    expect(flat[0]).toEqual(h('span'));
    expect(flat[1]).toBe(0);
  });
});

describe('className', () => {
  it('joins truthy parts', () => {
    expect(className('a', '', false, null, undefined, 'b')).toBe('a b');
  });
});

describe('h', () => {
  it('drops undefined attributes', () => {
    const node = h('button', { id: undefined, disabled: false, value: 0 });
    expect(node.attrs).toEqual({ disabled: false, value: 0 });
  });
});

describe('renderAttrs', () => {
  it('renders values, booleans and skips undefined', () => {
    const node = h('input', { disabled: true, 'aria-label': 'a b', data: undefined, count: 0 });
    expect(renderAttrs(node)).toBe(' disabled aria-label="a b" count="0"');
  });

  it('skips undefined attribute values on raw nodes', () => {
    const node = { tag: 'div', attrs: { 'data-x': undefined, 'data-y': 'z' }, children: [] };
    expect(renderAttrs(node)).toBe(' data-y="z"');
  });
});

describe('renderNode', () => {
  it('escapes text children', () => {
    expect(renderNode(h('p', {}, 'a<b'))).toBe('<p>a&lt;b</p>');
  });

  it('serializes void elements without a closing tag', () => {
    expect(renderNode(h('br'))).toBe('<br>');
    expect(renderNode(h('input', { type: 'text' }))).toBe('<input type="text">');
  });

  it('renders numbers as text', () => {
    expect(renderNode(42)).toBe('42');
  });
});

describe('renderToString', () => {
  it('renders an array of children', () => {
    expect(renderToString([h('span', {}, 'a'), 'b'])).toBe('<span>a</span>b');
  });

  it('renders a single child and strings', () => {
    expect(renderToString('hi')).toBe('hi');
    expect(renderToString(h('div', {}, 'x'))).toBe('<div>x</div>');
  });
});

describe('documentHtml', () => {
  it('wraps content in a document shell', () => {
    const html = documentHtml('<p>hi</p>', { title: 'T', meta: [h('meta', { name: 'viewport', content: 'width=device-width' })] });
    expect(html).toContain('<!doctype html><html lang="en">');
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain('<meta name="viewport" content="width=device-width">');
    expect(html).toContain('<title>T</title>');
    expect(html).toContain('<body><p>hi</p></body>');
  });

  it('escapes title and lang', () => {
    const html = documentHtml('x', { lang: 'en"', title: 'a<b' });
    expect(html).toContain('lang="en&quot;"');
    expect(html).toContain('<title>a&lt;b</title>');
  });

  it('uses defaults when no options are passed', () => {
    expect(documentHtml('<main></main>')).toContain('<title></title>');
  });
});
