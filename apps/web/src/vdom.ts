import type { VChild, VNode } from './types.js';

/** HTML elements that never render a closing tag. */
const VOID_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

const ATTR_ESCAPES: Record<string, string> = { '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;' };
const TEXT_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Escapes a string for use inside HTML text. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => TEXT_ESCAPES[char] ?? char);
}

/** Escapes a string for use inside a double-quoted HTML attribute. */
export function escapeAttr(value: string): string {
  return value.replace(/[&"<>]/g, (char) => ATTR_ESCAPES[char] ?? char);
}

/** Flattens nested children into a list of renderable values. */
export function flatten(children: VChild[]): Array<VNode | string | number> {
  const out: Array<VNode | string | number> = [];
  for (const child of children) {
    if (child === null || child === undefined || typeof child === 'boolean') {
      continue;
    }
    if (Array.isArray(child)) {
      out.push(...flatten(child as VChild[]));
    } else {
      out.push(child);
    }
  }
  return out;
}

/** Merges truthy class name parts into a single space-separated string. */
export function className(...parts: Array<string | false | null | undefined>): string {
  return parts.filter((part): part is string => typeof part === 'string' && part.length > 0).join(' ');
}

/** Creates an element node. Children may be nested arrays of nodes/strings. */
export function h(tag: string, attrs?: Record<string, string | number | boolean | undefined>, ...children: VChild[]): VNode {
  const clean: Record<string, string | number | boolean | undefined> = {};
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value !== undefined) {
        clean[key] = value;
      }
    }
  }
  return { tag, attrs: clean, children: flatten(children) };
}

/** Serializes a node's attributes to an HTML string (including a leading space when non-empty). */
export function renderAttrs(node: VNode): string {
  let out = '';
  for (const [key, value] of Object.entries(node.attrs)) {
    if (value === undefined) {
      continue;
    }
    if (typeof value === 'boolean') {
      if (value) {
        out += ` ${key}`;
      }
      continue;
    }
    out += ` ${key}="${escapeAttr(String(value))}"`;
  }
  return out;
}

/** Serializes a single node/string to an HTML string. */
export function renderNode(node: VNode | string | number): string {
  if (typeof node !== 'object') {
    return escapeHtml(String(node));
  }
  const attrs = renderAttrs(node);
  if (VOID_TAGS.has(node.tag)) {
    return `<${node.tag}${attrs}>`;
  }
  const inner = node.children.map((child) => renderNode(child as VNode | string | number)).join('');
  return `<${node.tag}${attrs}>${inner}</${node.tag}>`;
}

/** Serializes a full tree to an HTML string. */
export function renderToString(node: VNode | VChild | VChild[]): string {
  const items = Array.isArray(node) ? flatten(node as VChild[]) : flatten([node as VChild]);
  return items.map((child) => renderNode(child as VNode | string | number)).join('');
}

/** Serializes a document shell around rendered content (for SSR/markup output). */
export function documentHtml(body: string, { lang = 'en', title = '', meta }: { lang?: string; title?: string; meta?: VNode[] } = {}): string {
  const metaHtml = (meta ?? []).map((node) => renderNode(node)).join('');
  return `<!doctype html><html lang="${escapeAttr(lang)}"><head><meta charset="utf-8">${metaHtml}<title>${escapeHtml(title)}</title></head><body>${body}</body></html>`;
}
