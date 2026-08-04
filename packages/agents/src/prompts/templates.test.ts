import { describe, expect, it } from 'vitest';
import { PROMPTS } from './templates.js';

describe('PROMPTS', () => {
  it('contains the shared contract and every agent prompt', () => {
    const ids = Object.keys(PROMPTS);
    expect(ids).toContain('output-contract');
    expect(ids).toContain('metadata');
    expect(ids).toContain('technical-seo');
    expect(ids).toContain('content');
    expect(ids).toContain('keyword');
    expect(ids).toContain('internal-linking');
    expect(ids).toContain('schema');
    expect(ids).toContain('image-seo');
    expect(ids).toContain('product');
    expect(ids).toContain('collections');
    expect(ids).toContain('blog');
    expect(ids).toContain('page');
    expect(ids).toContain('reporting');
    expect(ids).toContain('analytics');
  });

  it('every agent prompt declares the full parameter set', () => {
    for (const [id, template] of Object.entries(PROMPTS)) {
      if (id === 'output-contract') continue;
      expect(template.parameters).toEqual([
        'storeId',
        'workflowId',
        'taskId',
        'entityCount',
        'entities',
        'settings',
        'context',
        'allowedActions',
      ]);
      expect(template.version).toBe('1.0.0');
      expect(template.template).toContain('Allowed actions: {allowedActions}');
    }
  });

  it('the output contract forbids destructive and publishing operations', () => {
    expect(PROMPTS['output-contract']?.template).toContain(
      'Never propose destructive (delete/remove) or publishing (create) operations.',
    );
  });
});
