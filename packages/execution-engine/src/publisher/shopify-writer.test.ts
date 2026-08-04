import { describe, expect, it, vi } from 'vitest';
import type { ShopifyService } from '@seogod/shopify';
import { MemoryShopifyWriter, ShopifyServiceWriter } from './shopify-writer.js';

describe('shopify service writer', () => {
  function fakeService(): ShopifyService {
    return {
      updateProduct: vi.fn(async () => ({ id: 'p1' })),
      updatePage: vi.fn(async () => ({ id: 'pg1' })),
      updateBlog: vi.fn(async () => ({ id: 'b1' })),
      updateTheme: vi.fn(async () => ({})),
      uploadImage: vi.fn(async () => ({ id: 'img1' })),
    } as unknown as ShopifyService;
  }

  it('reports its capabilities', () => {
    const writer = new ShopifyServiceWriter(fakeService());
    expect(writer.has('product')).toBe(true);
    expect(writer.has('theme')).toBe(true);
    expect(writer.has('sitemap')).toBe(false);
  });

  it('forwards each write to the underlying service', async () => {
    const service = fakeService();
    const writer = new ShopifyServiceWriter(service);
    await writer.updateProduct('shop.myshopify.com', { id: 'p1', seo: { title: 'x' } });
    await writer.updatePage('shop.myshopify.com', { id: 'pg1' });
    await writer.updateBlog('shop.myshopify.com', { id: 'b1' });
    await writer.updateTheme('shop.myshopify.com', 't1', [{ key: 'a' }]);
    await writer.uploadImage('shop.myshopify.com', { url: 'u' });
    expect(service.updateProduct).toHaveBeenCalledOnce();
    expect(service.updatePage).toHaveBeenCalledOnce();
    expect(service.updateBlog).toHaveBeenCalledOnce();
    expect(service.updateTheme).toHaveBeenCalledWith('shop.myshopify.com', 't1', [{ key: 'a' }]);
    expect(service.uploadImage).toHaveBeenCalledOnce();
  });
});

describe('memory shopify writer', () => {
  it('keeps an existing id from the input', async () => {
    const writer = new MemoryShopifyWriter();
    const result = await writer.updateProduct('shop', { id: 'fixed-id', title: 'New' });
    expect((result as { id?: unknown }).id).toBe('fixed-id');
  });

  it('records calls and echoes input with a generated id', async () => {
    const writer = new MemoryShopifyWriter();
    const result = await writer.updateProduct('shop', { title: 'New' });
    expect(result).toMatchObject({ title: 'New' });
    expect(typeof (result as { id?: unknown }).id).toBe('string');
    expect(writer.calls).toHaveLength(1);
    expect(writer.calls[0]!.capability).toBe('product');
    expect(writer.calls[0]!.method).toBe('updateProduct');
    expect(writer.calls[0]!.args).toEqual(['shop', { title: 'New' }]);
  });

  it('respects configured failures and presets', async () => {
    const writer = new MemoryShopifyWriter(['product', 'page']);
    writer.failures.set('updateProduct', 'boom');
    await expect(writer.updateProduct('shop', {})).rejects.toThrow('boom');
    writer.presets.set('updatePage', { id: 'fixed' });
    await expect(writer.updatePage('shop', {})).resolves.toEqual({ id: 'fixed' });
  });

  it('honors custom capabilities and theme/image forwarding', async () => {
    const writer = new MemoryShopifyWriter(['theme', 'image']);
    expect(writer.has('product')).toBe(false);
    expect(writer.has('theme')).toBe(true);
    await writer.updateTheme('shop', 't1', [{ key: 'a' }]);
    await writer.uploadImage('shop', { url: 'u' });
    expect(writer.calls.map((call) => call.method)).toEqual(['updateTheme', 'uploadImage']);
    expect(writer.calls[0]!.args).toEqual(['shop', 't1', [{ key: 'a' }]]);
  });
});
