import { describe, expect, it } from 'vitest';
import type { ExecutionStep } from '../types/execution.js';
import type { ShopifyWriter } from '../types/publisher.js';
import { buildStep } from '../models/execution.js';
import { UnsupportedExecutionError } from '../utils/errors.js';
import { MemoryShopifyWriter } from './shopify-writer.js';
import { ACTION_LABELS, buildOperation, createOperation, defaultOperations, slugify } from './operations.js';
import { OperationRegistryImpl } from './operation-registry.js';

function step(overrides: Partial<ExecutionStep> = {}): ExecutionStep {
  return buildStep({
    executionId: 'e1',
    batchId: 'b1',
    storeId: 's1',
    actionType: 'update_title',
    resourceType: 'product',
    resourceId: 'p1',
    payload: { title: 'New title' },
    order: 0,
    ...overrides,
  });
}

describe('slugify', () => {
  it('normalizes handles', () => {
    expect(slugify('  My Cool Product!  ')).toBe('my-cool-product');
    expect(slugify('café')).toBe('café');
    expect(slugify('')).toBe('');
    expect(slugify('x'.repeat(300))).toHaveLength(255);
  });
});

describe('operation builder', () => {
  it('update_title on product applies through the writer in real modes', async () => {
    const operation = buildOperation('update_title', 'product');
    expect(operation.id).toBe('product.update_title');
    expect(operation.mutating).toBe(true);
    expect(operation.requiresApproval).toBe(true);
    expect(operation.supportsWrite).toBe(true);
    expect(operation.supportsRestore).toBe(true);
    const writer = new MemoryShopifyWriter();
    const result = await operation.apply(step(), writer, 'shop', 'PRODUCTION');
    expect(result.apiCalls).toBe(1);
    expect(result.after).toMatchObject({ seo: { title: 'New title' } });
    expect(writer.calls).toHaveLength(1);
  });

  it('dry-run and simulation never touch the writer', async () => {
    const operation = buildOperation('update_title', 'product');
    const writer = new MemoryShopifyWriter();
    for (const mode of ['DRY_RUN', 'SIMULATION'] as const) {
      const result = await operation.apply(step(), writer, 'shop', mode);
      expect(result.apiCalls).toBe(0);
      expect(result.after).toMatchObject({ seo: { title: 'New title' } });
    }
    expect(writer.calls).toHaveLength(0);
  });

  it('restore writes the captured previous value back', async () => {
    const operation = buildOperation('update_title', 'product');
    const theStep = step();
    theStep.before = { seo: { title: 'Old title' } };
    const writer = new MemoryShopifyWriter();
    const result = await operation.restore(theStep, writer, 'shop');
    expect(result.apiCalls).toBe(1);
    expect(writer.calls[0]!.args[1]).toEqual({ id: 'p1', seo: { title: 'Old title' } });
  });

  it('update_url slugifies the handle', async () => {
    const operation = buildOperation('update_url', 'page');
    const writer = new MemoryShopifyWriter();
    const result = await operation.apply(step({ payload: { url: 'My Page' } }), writer, 'shop', 'PRODUCTION');
    expect(result.after).toMatchObject({ handle: 'my-page' });
  });

  it('update_description maps to bodyHtml for products', async () => {
    const operation = buildOperation('update_description', 'product');
    const writer = new MemoryShopifyWriter();
    const result = await operation.apply(step({ payload: { description: '<p>hi</p>' } }), writer, 'shop', 'PRODUCTION');
    expect(result.after).toMatchObject({ descriptionHtml: '<p>hi</p>' });
  });

  it('update_body maps to bodyHtml for pages', async () => {
    const operation = buildOperation('update_body', 'page');
    const writer = new MemoryShopifyWriter();
    const result = await operation.apply(step({ payload: { body: '<p>hi</p>' } }), writer, 'shop', 'PRODUCTION');
    expect(result.after).toMatchObject({ bodyHtml: '<p>hi</p>' });
  });

  it('add_image requires a url and uses the image capability', async () => {
    const operation = buildOperation('add_image', 'product');
    const writer = new MemoryShopifyWriter();
    await expect(operation.apply(step({ payload: {} }), writer, 'shop', 'PRODUCTION')).rejects.toThrow();
    const result = await operation.apply(step({ payload: { url: 'u', alt: 'a' } }), writer, 'shop', 'PRODUCTION');
    expect(result.apiCalls).toBe(1);
    expect(result.after).toMatchObject({ image: { url: 'u', alt: 'a' } });
  });

  it('update_theme validates its payload and restores captured files', async () => {
    const operation = buildOperation('update_theme', 'store');
    const writer = new MemoryShopifyWriter();
    await expect(operation.apply(step(), writer, 'shop', 'PRODUCTION')).rejects.toThrow(/themeId/);
    await expect(
      operation.apply(step({ payload: { themeId: 't1' } }), writer, 'shop', 'PRODUCTION'),
    ).rejects.toThrow(/files/);
    const theStep = step({
      payload: { themeId: 't1', files: [{ key: 'assets/a.liquid', value: 'new' }] },
    });
    theStep.before = { files: [{ key: 'assets/a.liquid', value: 'old' }] };
    const result = await operation.apply(theStep, writer, 'shop', 'PRODUCTION');
    expect(result.after).toMatchObject({ files: [{ key: 'assets/a.liquid', value: 'new' }] });
    await operation.restore(theStep, writer, 'shop');
    expect(writer.calls[1]!.args[2]).toEqual([{ key: 'assets/a.liquid', value: 'old' }]);
  });

  it('future-ready operations reject writes in real modes', async () => {
    const operation = buildOperation('update_meta', 'product');
    expect(operation.supportsWrite).toBe(false);
    await expect(operation.apply(step(), new MemoryShopifyWriter(), 'shop', 'PRODUCTION')).rejects.toThrow(
      UnsupportedExecutionError,
    );
  });

  it('operations refuse modes outside their supported set', async () => {
    const operation = createOperation({
      actionType: 'custom_op',
      resourceType: 'store',
      capability: null,
      supportedModes: ['STAGING'],
      apply: async () => ({ apiCalls: 0, after: {}, responses: [] }),
    });
    await expect(operation.apply(step(), new MemoryShopifyWriter(), 'shop', 'PRODUCTION')).rejects.toThrow(
      UnsupportedExecutionError,
    );
  });

  it('operations throw when the writer lacks the capability', async () => {
    const operation = buildOperation('update_title', 'product');
    const writer = new MemoryShopifyWriter(['page']);
    await expect(operation.apply(step(), writer, 'shop', 'PRODUCTION')).rejects.toThrow(UnsupportedExecutionError);
  });

  it('restore refuses when unsupported', async () => {
    const operation = buildOperation('update_meta', 'product');
    await expect(operation.restore(step(), new MemoryShopifyWriter(), 'shop')).rejects.toThrow(UnsupportedExecutionError);
  });

  it('defaultOperations covers every known action type', () => {
    const registry = new OperationRegistryImpl(defaultOperations());
    expect(registry.list().length).toBeGreaterThan(30);
    for (const key of Object.keys(ACTION_LABELS)) {
      const found = registry.list().some((op) => op.actionType === key);
      expect(found, `missing action ${key}`).toBe(true);
    }
  });

  it('summarize labels steps in human terms', () => {
    const operation = buildOperation('update_title', 'product');
    expect(operation.summarize(step())).toContain('Update title on product p1');
  });

  it('update_meta_description drives the seo.description field', async () => {
    const operation = buildOperation('update_meta_description', 'product');
    const writer = new MemoryShopifyWriter();
    const result = await operation.apply(
      step({ actionType: 'update_meta_description', payload: { description: 'Fresh meta' } }),
      writer,
      'shop',
      'PRODUCTION',
    );
    expect(result.after).toMatchObject({ seo: { description: 'Fresh meta' } });
    expect(writer.calls[0]!.args[1]).toEqual({ id: 'p1', seo: { description: 'Fresh meta' } });
  });

  it('update_url dry-run previews the handle and restore rewrites it', async () => {
    const operation = buildOperation('update_url', 'product');
    const dry = await operation.apply(step({ actionType: 'update_url', payload: { url: 'Slug Me' } }), new MemoryShopifyWriter(), 'shop', 'DRY_RUN');
    expect(dry.apiCalls).toBe(0);
    expect(dry.after).toMatchObject({ handle: 'slug-me' });
    const theStep = step({ actionType: 'update_url', payload: { handle: 'new-slug' } });
    theStep.before = { handle: 'old-slug' };
    const writer = new MemoryShopifyWriter();
    await operation.restore(theStep, writer, 'shop');
    expect(writer.calls[0]!.args[1]).toEqual({ id: 'p1', handle: 'old-slug' });
  });

  it('update_description previews and restores the descriptionHtml', async () => {
    const operation = buildOperation('update_description', 'product');
    const dry = await operation.apply(
      step({ actionType: 'update_description', payload: { description: '<p>new</p>' } }),
      new MemoryShopifyWriter(),
      'shop',
      'DRY_RUN',
    );
    expect(dry.after).toMatchObject({ descriptionHtml: '<p>new</p>' });
    const theStep = step({ actionType: 'update_description', payload: { body: 'x' } });
    theStep.before = { descriptionHtml: '<p>old</p>' };
    const writer = new MemoryShopifyWriter();
    await operation.restore(theStep, writer, 'shop');
    expect(writer.calls[0]!.args[1]).toEqual({ id: 'p1', descriptionHtml: '<p>old</p>' });
  });

  it('update_body previews and restores the bodyHtml', async () => {
    const operation = buildOperation('update_body', 'page');
    const dry = await operation.apply(
      step({ actionType: 'update_body', resourceType: 'page', resourceId: 'pg1', payload: { body: '<p>new</p>' } }),
      new MemoryShopifyWriter(),
      'shop',
      'DRY_RUN',
    );
    expect(dry.after).toMatchObject({ bodyHtml: '<p>new</p>' });
    const theStep = step({ actionType: 'update_body', resourceType: 'page', resourceId: 'pg1', payload: { body: 'x' } });
    theStep.before = { bodyHtml: '<p>old</p>' };
    const writer = new MemoryShopifyWriter();
    await operation.restore(theStep, writer, 'shop');
    expect(writer.calls[0]!.args[1]).toEqual({ id: 'pg1', bodyHtml: '<p>old</p>' });
  });

  it('add_image previews in dry-run, forwards extra fields, and needs uploadImage', async () => {
    const operation = buildOperation('add_image', 'product');
    const dry = await operation.apply(step({ payload: { url: 'u', alt: 'a' } }), new MemoryShopifyWriter(), 'shop', 'DRY_RUN');
    expect(dry.apiCalls).toBe(0);
    expect(dry.after).toMatchObject({ image: { url: 'u', alt: 'a' } });
    const writer = new MemoryShopifyWriter();
    await operation.apply(step({ payload: { url: 'u', filename: 'f.png' } }), writer, 'shop', 'PRODUCTION');
    expect(writer.calls[0]!.args[1]).toEqual({ url: 'u', filename: 'f.png' });
    const noUpload: ShopifyWriter = { has: () => true } as unknown as ShopifyWriter;
    await expect(operation.apply(step({ payload: { url: 'u' } }), noUpload, 'shop', 'PRODUCTION')).rejects.toThrow(/uploadImage/);
  });

  it('update_theme previews files and validates restore state', async () => {
    const operation = buildOperation('update_theme', 'store');
    const dry = await operation.apply(
      step({ payload: { themeId: 't1', files: [{ key: 'a' }] } }),
      new MemoryShopifyWriter(),
      'shop',
      'DRY_RUN',
    );
    expect(dry.after).toMatchObject({ files: [{ key: 'a' }] });
    const missingFiles = step({ payload: { themeId: 't1', files: [{ key: 'a' }] } });
    missingFiles.before = { title: 'x' };
    await expect(operation.restore(missingFiles, new MemoryShopifyWriter(), 'shop')).rejects.toThrow(/captured files/);
    const noTheme: ShopifyWriter = { has: () => true } as unknown as ShopifyWriter;
    await expect(operation.apply(step({ payload: { themeId: 't1', files: [{ key: 'a' }] } }), noTheme, 'shop', 'PRODUCTION')).rejects.toThrow(/updateTheme/);
    const themed = step({ payload: { themeId: 't1', files: [] } });
    themed.before = { files: [{ key: 'a' }] };
    await expect(operation.restore(themed, noTheme, 'shop')).rejects.toThrow(/updateTheme/);
  });

  it('update_product and update_blog write nested payloads and preview them', async () => {
    const product = buildOperation('update_product', 'product');
    const writer = new MemoryShopifyWriter();
    const result = await product.apply(
      step({ actionType: 'update_product', payload: { product: { title: 'New' } } }),
      writer,
      'shop',
      'PRODUCTION',
    );
    expect(result.after).toMatchObject({ title: 'New' });
    const preview = await product.apply(
      step({ actionType: 'update_product', payload: { product: { title: 'New' } } }),
      writer,
      'shop',
      'DRY_RUN',
    );
    expect(preview.after).toEqual({ product: { title: 'New' } });
    const blog = buildOperation('update_blog', 'blog');
    await blog.apply(step({ actionType: 'update_blog', resourceType: 'blog', payload: { blog: { title: 'Blog' } } }), writer, 'shop', 'PRODUCTION');
  });

  it('rejects malformed nested payloads for generic updates', async () => {
    const operation = buildOperation('update_product', 'product');
    await expect(
      operation.apply(step({ actionType: 'update_product', payload: { product: 'nope' } }), new MemoryShopifyWriter(), 'shop', 'PRODUCTION'),
    ).rejects.toThrow(/payload.product must be an object/);
  });

  it('unsupported operations preview their proposal in dry-run', async () => {
    const operation = buildOperation('update_title', 'store');
    expect(operation.supportsWrite).toBe(false);
    const dry = await operation.apply(step({ resourceType: 'store' }), new MemoryShopifyWriter(), 'shop', 'DRY_RUN');
    expect(dry.after).toMatchObject({ proposed: { title: 'New title' } });
  });

  it('falls back to a no-op preview when no expectedAfter is provided', async () => {
    const operation = createOperation({
      actionType: 'custom_op',
      resourceType: 'store',
      capability: null,
      apply: async () => ({ apiCalls: 0, after: {}, responses: [] }),
    });
    const dry = await operation.apply(step(), new MemoryShopifyWriter(), 'shop', 'DRY_RUN');
    expect(dry.after).toEqual({});
  });

  it('resolves unknown action types to an unsupported operation', () => {
    const operation = buildOperation('made_up_action', 'product');
    expect(operation.supportsWrite).toBe(false);
  });

  it('fails field updates when the writer lacks the target method', async () => {
    const operation = buildOperation('update_title', 'blog');
    const writer = { has: () => true } as unknown as ShopifyWriter;
    await expect(operation.apply(step({ resourceType: 'blog' }), writer, 'shop', 'PRODUCTION')).rejects.toThrow(/cannot updateBlog/);
    const theStep = step({ resourceType: 'blog' });
    theStep.before = { seo: { title: 'Old' } };
    await expect(operation.restore(theStep, writer, 'shop')).rejects.toThrow(/cannot updateBlog/);
  });

  it('normalizes scalar writer responses and tolerates broken before-state', async () => {
    const operation = buildOperation('update_title', 'product');
    const scalar = new MemoryShopifyWriter();
    scalar.updateProduct = async () => true;
    const result = await operation.apply(step(), scalar, 'shop', 'PRODUCTION');
    expect(result.after).toEqual({ value: true });
    const theStep = step();
    theStep.before = { seo: 'not-an-object' };
    const writer = new MemoryShopifyWriter();
    await operation.restore(theStep, writer, 'shop');
    expect(writer.calls[0]!.args[1]).toEqual({ id: 'p1', seo: { title: undefined } });
  });

  it('update_meta_description previews the seo.description field', async () => {
    const operation = buildOperation('update_meta_description', 'product');
    const result = await operation.apply(
      step({ actionType: 'update_meta_description', payload: { description: 'Fresh meta' } }),
      new MemoryShopifyWriter(),
      'shop',
      'DRY_RUN',
    );
    expect(result.after).toMatchObject({ seo: { description: 'Fresh meta' } });
  });

  it('update_url falls back to an empty handle when neither is provided', async () => {
    const operation = buildOperation('update_url', 'product');
    const writer = new MemoryShopifyWriter();
    await operation.apply(step({ actionType: 'update_url', payload: {} }), writer, 'shop', 'PRODUCTION');
    expect(writer.calls[0]!.args[1]).toEqual({ id: 'p1', handle: '' });
    const preview = await operation.apply(step({ actionType: 'update_url', payload: {} }), writer, 'shop', 'DRY_RUN');
    expect(preview.after).toMatchObject({ handle: '' });
  });

  it('update_url restore tolerates a missing captured handle', async () => {
    const operation = buildOperation('update_url', 'product');
    const theStep = step({ actionType: 'update_url', payload: { url: 'x' } });
    theStep.before = {};
    const writer = new MemoryShopifyWriter();
    await operation.restore(theStep, writer, 'shop');
    expect(writer.calls[0]!.args[1]).toEqual({ id: 'p1', handle: '' });
  });

  it('body operations fall back to empty strings', async () => {
    const operation = buildOperation('update_body', 'page');
    const writer = new MemoryShopifyWriter();
    await operation.apply(
      step({ actionType: 'update_body', resourceType: 'page', resourceId: 'pg1', payload: {} }),
      writer,
      'shop',
      'PRODUCTION',
    );
    expect(writer.calls[0]!.args[1]).toEqual({ id: 'pg1', bodyHtml: '' });
    const preview = await operation.apply(
      step({ actionType: 'update_body', resourceType: 'page', resourceId: 'pg1', payload: {} }),
      writer,
      'shop',
      'DRY_RUN',
    );
    expect(preview.after).toMatchObject({ bodyHtml: '' });
  });

  it('body restore tolerates a missing captured field', async () => {
    const operation = buildOperation('update_body', 'page');
    const theStep = step({ actionType: 'update_body', resourceType: 'page', resourceId: 'pg1', payload: { body: 'x' } });
    theStep.before = {};
    const writer = new MemoryShopifyWriter();
    await operation.restore(theStep, writer, 'shop');
    expect(writer.calls[0]!.args[1]).toEqual({ id: 'pg1', bodyHtml: '' });
  });

  it('add_image previews null url and alt when absent', async () => {
    const operation = buildOperation('add_image', 'product');
    const result = await operation.apply(step({ payload: {} }), new MemoryShopifyWriter(), 'shop', 'DRY_RUN');
    expect(result.after).toMatchObject({ image: { url: null, alt: null } });
  });

  it('update_theme previews an empty file list when files are absent', async () => {
    const operation = buildOperation('update_theme', 'store');
    const result = await operation.apply(
      step({ payload: { themeId: 't1' } }),
      new MemoryShopifyWriter(),
      'shop',
      'DRY_RUN',
    );
    expect(result.after).toMatchObject({ files: [] });
  });

  it('generic updates fail when the writer lacks the target method', async () => {
    const operation = buildOperation('update_product', 'product');
    const writer = { has: () => true } as unknown as ShopifyWriter;
    await expect(
      operation.apply(step({ actionType: 'update_product', payload: { product: { title: 'x' } } }), writer, 'shop', 'PRODUCTION'),
    ).rejects.toThrow(/cannot updateProduct/);
  });

  it('summarize falls back to the action type for unknown operations', () => {
    const operation = buildOperation('custom', 'store');
    expect(operation.summarize(step({ actionType: 'made_up_action' }))).toContain('made_up_action');
  });

  it('restore tolerates a null before-state', async () => {
    const operation = buildOperation('update_title', 'product');
    const theStep = step();
    theStep.before = null;
    const writer = new MemoryShopifyWriter();
    await operation.restore(theStep, writer, 'shop');
    expect(writer.calls[0]!.args[1]).toEqual({ id: 'p1', seo: { title: undefined } });
  });
});
