import { describe, expect, it } from 'vitest';
import { BlogAgent } from './blog-agent.js';
import { makeEntity, makeInput } from '../test/helpers.js';

function article(data: Record<string, unknown>): ReturnType<typeof makeEntity> {
  return makeEntity({ type: 'article', ref: `https://acme.example/blog/${data.id ?? 'x'}`, data });
}

function blog(data: Record<string, unknown>): ReturnType<typeof makeEntity> {
  return makeEntity({ type: 'blog', ref: 'https://acme.example/blog', data });
}

function run(data: Array<ReturnType<typeof makeEntity>>) {
  return new BlogAgent().analyze(makeInput({ entities: data }));
}

function rulesOf(result: ReturnType<BlogAgent['analyze']>): string[] {
  return result.recommendations.map((recommendation) => recommendation.rule);
}

describe('BlogAgent', () => {
  it('flags thin articles', () => {
    const out = run([article({ body: 'short copy' })]);
    expect(rulesOf(out)).toContain('blog.thin-article');
  });

  it('proposes an excerpt action for articles without one', () => {
    const out = run([article({ body: 'x'.repeat(2000), wordCount: 400, title: 'Post' })]);
    expect(rulesOf(out)).toContain('blog.missing-excerpt');
    expect(out.actions[0]?.actionType).toBe('update_meta_description');
  });

  it('flags missing article titles', () => {
    const out = run([article({ body: 'x'.repeat(2000), wordCount: 400, excerpt: 'e' })]);
    expect(rulesOf(out)).toContain('blog.missing-title');
  });

  it('flags blogs without any articles', () => {
    const out = run([blog({})]);
    expect(rulesOf(out)).toContain('blog.no-articles');
  });

  it('does not flag a blog when articles exist', () => {
    const out = run([blog({}), article({ body: 'x'.repeat(2000), wordCount: 400, title: 'Post', excerpt: 'e' })]);
    expect(rulesOf(out)).not.toContain('blog.no-articles');
  });

  it('passes healthy articles', () => {
    const out = run([article({ body: 'x'.repeat(2000), wordCount: 400, title: 'Post', excerpt: 'e' })]);
    expect(out.recommendations).toHaveLength(0);
  });

  it('falls back to the content field for article copy', () => {
    const out = run([
      article({ content: 'x'.repeat(2000), wordCount: 400, title: 'Post', excerpt: 'e' }),
    ]);
    expect(out.recommendations).toHaveLength(0);
  });

  it('ignores whitespace-only bodies and falls back to content', () => {
    const out = run([
      article({ body: '  ', content: 'x'.repeat(2000), wordCount: 400, title: 'Post', excerpt: 'e' }),
    ]);
    expect(out.recommendations).toHaveLength(0);
  });

  it('treats articles without body or content as empty copy', () => {
    const out = run([article({ wordCount: 400, title: 'Post', excerpt: 'e' })]);
    expect(out.recommendations).toHaveLength(0);
  });
});
