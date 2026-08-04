import { describe, expect, it } from 'vitest';
import { ImageSeoAgent } from './image-seo-agent.js';
import { makeEntity, makeInput } from '../test/helpers.js';

function page(data: Record<string, unknown>): ReturnType<typeof makeEntity> {
  return makeEntity({ data });
}

function run(data: Array<Record<string, unknown>>) {
  return new ImageSeoAgent().analyze(makeInput({ entities: data.map(page) }));
}

function rulesOf(result: ReturnType<ImageSeoAgent['analyze']>): string[] {
  return result.recommendations.map((recommendation) => recommendation.rule);
}

describe('ImageSeoAgent', () => {
  it('proposes alt text derived from the file name for missing alt', () => {
    const out = run([{ images: [{ url: '/red-shoes.jpg', fileName: 'red-shoes.jpg' }] }]);
    expect(rulesOf(out)).toContain('image-seo.missing-alt-text');
    expect(out.actions[0]?.actionType).toBe('update_alt_text');
    expect((out.actions[0]?.payload as { alt: string }).alt).toBe('red shoes');
  });

  it('falls back to the entity name when no file name exists', () => {
    const out = run([{ name: 'Running Shoe', images: ['/shoes.png'] }]);
    expect(rulesOf(out)).toContain('image-seo.missing-alt-text');
    expect((out.actions[0]?.payload as { alt: string }).alt).toBe('image of Running Shoe');
  });

  it('flags generic alt text', () => {
    const out = run([{ images: [{ url: '/a.jpg', alt: 'image' }] }]);
    expect(rulesOf(out)).toContain('image-seo.generic-alt-text');
  });

  it('flags oversized images with execution hints', () => {
    const out = run([{ images: [{ url: '/big.jpg', sizeKb: 500, alt: 'good alt' }] }]);
    expect(rulesOf(out)).toContain('image-seo.large-image');
    expect(out.executionHints.length).toBeGreaterThan(0);
  });

  it('handles string images without proposing actions when nothing can be derived', () => {
    const out = run([{ images: ['/a.jpg'] }, {}]);
    expect(out.recommendations).toHaveLength(1);
    expect(out.actions).toHaveLength(0);
  });

  it('proposes an action for generic alt text when a file name exists', () => {
    const out = run([
      { name: 'Running Shoe', images: [{ url: '/a.jpg', alt: 'image', fileName: 'running-shoe.jpg' }] },
    ]);
    expect(rulesOf(out)).toContain('image-seo.generic-alt-text');
    expect(out.actions[0]?.actionType).toBe('update_alt_text');
  });

  it('falls back to the title for alt text derivation', () => {
    const out = run([{ title: 'Running Shoe', images: ['/shoes.png'] }]);
    expect((out.actions[0]?.payload as { alt: string }).alt).toBe('image of Running Shoe');
  });

  it('skips object images without a url', () => {
    const out = run([{ images: [{ alt: 'good alt' }] }, { images: [{ url: '/b.jpg', alt: 'good' }] }]);
    expect(out.recommendations).toHaveLength(0);
  });

  it('derives no alt from separator-only file names', () => {
    const out = run([{ name: 'Widget', images: [{ url: '/a.jpg', fileName: '---' }] }]);
    expect((out.actions[0]?.payload as { alt: string }).alt).toBe('image of Widget');
  });
});
