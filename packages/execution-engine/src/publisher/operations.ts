import type { ExecutionStep } from '../types/execution.js';
import type {
  ExecutionOperation,
  OperationResult,
  ShopifyWriter,
  WriteCapability,
} from '../types/publisher.js';
import type { ExecutionMode } from '../types/shared.js';
import { InvalidExecutionError, UnsupportedExecutionError } from '../utils/errors.js';

const ALL_MODES: readonly ExecutionMode[] = ['DRY_RUN', 'SIMULATION', 'STAGING', 'PRODUCTION'];

export const ACTION_LABELS: Record<string, string> = {
  update_title: 'Update title',
  update_meta_description: 'Update meta description',
  update_description: 'Update description',
  update_body: 'Update body',
  update_url: 'Update URL',
  update_meta: 'Update metafields',
  add_structured_data: 'Add structured data',
  remove_structured_data: 'Remove structured data',
  fix_internal_links: 'Fix internal links',
  add_internal_links: 'Add internal links',
  remove_internal_links: 'Remove internal links',
  update_alt_text: 'Update image alt text',
  add_image: 'Add image',
  remove_image: 'Remove image',
  update_robots: 'Update robots',
  update_canonical: 'Update canonical',
  remove_redirect: 'Remove redirect',
  update_redirect: 'Update redirect',
  create_page: 'Create page',
  delete_page: 'Delete page',
  update_collection: 'Update collection',
  update_product: 'Update product',
  update_blog: 'Update blog',
  update_article: 'Update article',
  update_theme: 'Update theme assets',
  sitemap: 'Update sitemap',
  custom: 'Custom operation',
};

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\u00e0-\u00ff]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 255);
}

function normalizeResource(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return { value };
}

function fieldValue(before: Record<string, unknown> | null, ...parts: string[]): unknown {
  let cursor: unknown = before ?? {};
  for (const part of parts) {
    if (cursor === null || typeof cursor !== 'object') return undefined;
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return cursor;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}

export interface OperationSpec {
  actionType: string;
  resourceType: string;
  mutating?: boolean;
  requiresApproval?: boolean;
  capability: WriteCapability | null;
  supportsWrite?: boolean;
  supportsRestore?: boolean;
  supportedModes?: ExecutionMode[];
  summarize?: (step: ExecutionStep) => string;
  expectedAfter?: (step: ExecutionStep) => Record<string, unknown>;
  apply: (step: ExecutionStep, writer: ShopifyWriter, shopDomain: string) => Promise<OperationResult>;
  restore?: (step: ExecutionStep, writer: ShopifyWriter, shopDomain: string) => Promise<OperationResult>;
}

function defaultSummarize(_id: string): (step: ExecutionStep) => string {
  return (step) =>
    `${ACTION_LABELS[step.actionType] ?? step.actionType} on ${step.resourceType} ${step.resourceRef ?? step.resourceId}`;
}

/**
 * Builds an {@link ExecutionOperation} with uniform mode/writer enforcement:
 * dry-run and simulation never touch the writer; real modes require the
 * operation to be write-capable and the writer to own the capability.
 */
export function createOperation(spec: OperationSpec): ExecutionOperation {
  const id = `${spec.resourceType}.${spec.actionType}`;
  const mutating = spec.mutating ?? true;
  const requiresApproval = spec.requiresApproval ?? mutating;
  const supportsWrite = spec.supportsWrite ?? false;
  const supportsRestore = spec.supportsRestore ?? false;
  const supportedModes = spec.supportedModes ?? [...ALL_MODES];
  const expectedAfter = spec.expectedAfter ?? (() => ({}));
  const summarize = spec.summarize ?? defaultSummarize(id);
  const apply = spec.apply;
  const restore = spec.restore;

  return {
    id,
    actionType: spec.actionType,
    resourceType: spec.resourceType,
    mutating,
    requiresApproval,
    capability: spec.capability,
    supportsWrite,
    supportsRestore,
    supportedModes,
    summarize,
    expectedAfter,
    async apply(step, writer, shopDomain, mode) {
      if (mode === 'DRY_RUN' || mode === 'SIMULATION') {
        return { apiCalls: 0, after: expectedAfter(step), responses: [] };
      }
      if (!supportedModes.includes(mode)) {
        throw new UnsupportedExecutionError(`operation ${id} is not supported in ${mode}`, {
          module: 'execution-engine',
          operation: 'execution.operation',
        });
      }
      if (!supportsWrite) {
        throw new UnsupportedExecutionError(`operation ${id} cannot write to Shopify yet`, {
          module: 'execution-engine',
          operation: 'execution.operation',
        });
      }
      if (spec.capability !== null && !writer.has(spec.capability)) {
        throw new UnsupportedExecutionError(
          `writer cannot handle capability ${spec.capability} for ${id}`,
          { module: 'execution-engine', operation: 'execution.operation' },
        );
      }
      return apply(step, writer, shopDomain);
    },
    async restore(step, writer, shopDomain) {
      if (!supportsRestore || restore === undefined) {
        throw new UnsupportedExecutionError(`operation ${id} cannot restore previous state`, {
          module: 'execution-engine',
          operation: 'execution.rollback',
        });
      }
      return restore(step, writer, shopDomain);
    },
  };
}

function ensurePayload(step: ExecutionStep, key: string): Record<string, unknown> {
  const value = step.payload[key];
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new InvalidExecutionError(`payload.${key} must be an object`, {
      module: 'execution-engine',
      operation: 'execution.operation',
      context: { stepId: step.id, actionType: step.actionType },
    });
  }
  return value as Record<string, unknown>;
}

// --- SEO field updates (title / meta description / body / url) --------------

function fieldKeyFor(actionType: string): 'title' | 'description' {
  return actionType === 'update_title' ? 'title' : 'description';
}

export interface FieldOperationOptions {
  actionType: string;
  resourceType: string;
  capability: WriteCapability;
  writerMethod: 'updateProduct' | 'updatePage' | 'updateBlog';
  buildInput: (step: ExecutionStep) => Record<string, unknown>;
  buildRestoreInput: (step: ExecutionStep) => Record<string, unknown>;
  expectedAfter?: (step: ExecutionStep) => Record<string, unknown>;
}

/** Field-level update with restore support (previous value captured). */
export function buildFieldOperation(options: FieldOperationOptions): ExecutionOperation {
  const { actionType, resourceType, capability, writerMethod, buildInput, buildRestoreInput } = options;
  const doApply = async (
    step: ExecutionStep,
    writer: ShopifyWriter,
    shopDomain: string,
  ): Promise<OperationResult> => {
    const writerFn = writer[writerMethod];
    if (writerFn === undefined) {
      throw new UnsupportedExecutionError(`writer cannot ${writerMethod}`, {
        module: 'execution-engine',
        operation: 'execution.operation',
      });
    }
    const response = await writerFn.call(writer, shopDomain, buildInput(step));
    return { apiCalls: 1, after: normalizeResource(response), responses: [asRecord(response)] };
  };
  return createOperation({
    actionType,
    resourceType,
    capability,
    supportsWrite: true,
    supportsRestore: true,
    expectedAfter: options.expectedAfter,
    apply: doApply,
    restore: async (step, writer, shopDomain) => {
      const writerFn = writer[writerMethod];
      if (writerFn === undefined) {
        throw new UnsupportedExecutionError(`writer cannot ${writerMethod}`, {
          module: 'execution-engine',
          operation: 'execution.rollback',
        });
      }
      const response = await writerFn.call(writer, shopDomain, buildRestoreInput(step));
      return { apiCalls: 1, after: normalizeResource(response), responses: [asRecord(response)] };
    },
  });
}

export function seoFieldOperation(options: {
  actionType: string;
  resourceType: string;
  capability: WriteCapability;
  writerMethod: 'updateProduct' | 'updatePage' | 'updateBlog';
  restorePath: string[];
}): ExecutionOperation {
  const key = fieldKeyFor(options.actionType);
  return buildFieldOperation({
    actionType: options.actionType,
    resourceType: options.resourceType,
    capability: options.capability,
    writerMethod: options.writerMethod,
    buildInput: (step) => ({
      id: step.resourceId,
      seo: { [key]: step.payload[key === 'title' ? 'title' : 'description'] },
    }),
    buildRestoreInput: (step) => ({
      id: step.resourceId,
      seo: { [key]: fieldValue(step.before, ...options.restorePath) },
    }),
    expectedAfter: (step) => ({
      seo: { [key]: step.payload[key === 'title' ? 'title' : 'description'] },
    }),
  });
}

function urlOperation(options: {
  resourceType: string;
  capability: WriteCapability;
  writerMethod: 'updateProduct' | 'updatePage' | 'updateBlog';
}): ExecutionOperation {
  return buildFieldOperation({
    actionType: 'update_url',
    resourceType: options.resourceType,
    capability: options.capability,
    writerMethod: options.writerMethod,
    buildInput: (step) => ({
      id: step.resourceId,
      handle: slugify(String(step.payload.url ?? step.payload.handle ?? '')),
    }),
    buildRestoreInput: (step) => ({
      id: step.resourceId,
      handle: String(fieldValue(step.before, 'handle') ?? ''),
    }),
    expectedAfter: (step) => ({ handle: slugify(String(step.payload.url ?? step.payload.handle ?? '')) }),
  });
}

function bodyOperation(options: {
  actionType: string;
  resourceType: string;
  capability: WriteCapability;
  writerMethod: 'updateProduct' | 'updatePage';
  field: 'bodyHtml' | 'descriptionHtml';
}): ExecutionOperation {
  return buildFieldOperation({
    actionType: options.actionType,
    resourceType: options.resourceType,
    capability: options.capability,
    writerMethod: options.writerMethod,
    buildInput: (step) => ({
      id: step.resourceId,
      [options.field]: String(step.payload.body ?? step.payload.description ?? ''),
    }),
    buildRestoreInput: (step) => ({
      id: step.resourceId,
      [options.field]: String(fieldValue(step.before, options.field) ?? ''),
    }),
    expectedAfter: (step) => ({
      [options.field]: String(step.payload.body ?? step.payload.description ?? ''),
    }),
  });
}

// --- Other write-capable operations -----------------------------------------

function buildImageOperation(): ExecutionOperation {
  return createOperation({
    actionType: 'add_image',
    resourceType: 'product',
    capability: 'image',
    supportsWrite: true,
    supportsRestore: false,
    expectedAfter: (step) => ({
      image: { url: step.payload.url ?? null, alt: step.payload.alt ?? null },
    }),
    apply: async (step, writer, shopDomain) => {
      const url = step.payload.url;
      if (typeof url !== 'string' || url.length === 0) {
        throw new InvalidExecutionError('payload.url is required for add_image', {
          module: 'execution-engine',
          operation: 'execution.operation',
        });
      }
      const input: Record<string, unknown> = { url };
      if (typeof step.payload.alt === 'string') input.alt = step.payload.alt;
      if (typeof step.payload.filename === 'string') input.filename = step.payload.filename;
      const writerFn = writer.uploadImage;
      if (writerFn === undefined) {
        throw new UnsupportedExecutionError('writer cannot uploadImage', {
          module: 'execution-engine',
          operation: 'execution.operation',
        });
      }
      const response = await writerFn.call(writer, shopDomain, input);
      return { apiCalls: 1, after: { image: normalizeResource(response) }, responses: [asRecord(response)] };
    },
  });
}

function buildThemeOperation(): ExecutionOperation {
  return createOperation({
    actionType: 'update_theme',
    resourceType: 'store',
    capability: 'theme',
    supportsWrite: true,
    supportsRestore: true,
    expectedAfter: (step) => ({ files: step.payload.files ?? [] }),
    apply: async (step, writer, shopDomain) => {
      const themeId = step.payload.themeId;
      if (typeof themeId !== 'string' || themeId.length === 0) {
        throw new InvalidExecutionError('payload.themeId is required for update_theme', {
          module: 'execution-engine',
          operation: 'execution.operation',
        });
      }
      const files = step.payload.files;
      if (!Array.isArray(files)) {
        throw new InvalidExecutionError('payload.files must be an array for update_theme', {
          module: 'execution-engine',
          operation: 'execution.operation',
        });
      }
      const writerFn = writer.updateTheme;
      if (writerFn === undefined) {
        throw new UnsupportedExecutionError('writer cannot updateTheme', {
          module: 'execution-engine',
          operation: 'execution.operation',
        });
      }
      const response = await writerFn.call(writer, shopDomain, themeId, files);
      return { apiCalls: 1, after: { files }, responses: [asRecord(response)] };
    },
    restore: async (step, writer, shopDomain) => {
      const beforeFiles = step.before?.files;
      if (!Array.isArray(beforeFiles)) {
        throw new InvalidExecutionError('cannot restore theme without captured files', {
          module: 'execution-engine',
          operation: 'execution.rollback',
        });
      }
      const themeId = step.payload.themeId as string;
      const writerFn = writer.updateTheme;
      if (writerFn === undefined) {
        throw new UnsupportedExecutionError('writer cannot updateTheme', {
          module: 'execution-engine',
          operation: 'execution.rollback',
        });
      }
      const response = await writerFn.call(writer, shopDomain, themeId, beforeFiles);
      return { apiCalls: 1, after: { files: beforeFiles }, responses: [asRecord(response)] };
    },
  });
}

export function buildGenericUpdateOperation(options: {
  actionType: string;
  resourceType: string;
  capability: WriteCapability;
  writerMethod: 'updateProduct' | 'updatePage' | 'updateBlog';
  payloadKey: string;
}): ExecutionOperation {
  return createOperation({
    actionType: options.actionType,
    resourceType: options.resourceType,
    capability: options.capability,
    supportsWrite: true,
    supportsRestore: false,
    expectedAfter: (step) => ({ [options.payloadKey]: ensurePayload(step, options.payloadKey) }),
    apply: async (step, writer, shopDomain) => {
      const body = ensurePayload(step, options.payloadKey);
      const writerFn = writer[options.writerMethod];
      if (writerFn === undefined) {
        throw new UnsupportedExecutionError(`writer cannot ${options.writerMethod}`, {
          module: 'execution-engine',
          operation: 'execution.operation',
        });
      }
      const response = await writerFn.call(writer, shopDomain, { id: step.resourceId, ...body });
      return { apiCalls: 1, after: normalizeResource(response), responses: [asRecord(response)] };
    },
  });
}

function buildUnsupportedOperation(options: {
  actionType: string;
  resourceType: string;
  capability: WriteCapability | null;
  requiresApproval?: boolean;
}): ExecutionOperation {
  return createOperation({
    actionType: options.actionType,
    resourceType: options.resourceType,
    capability: options.capability,
    supportsWrite: false,
    supportsRestore: false,
    requiresApproval: options.requiresApproval,
    expectedAfter: (step) => ({ proposed: step.payload }),
    apply: async () => {
      throw new UnsupportedExecutionError(
        `operation ${options.resourceType}.${options.actionType} is not supported by the configured writer`,
        { module: 'execution-engine', operation: 'execution.operation' },
      );
    },
  });
}

function resourceTypeToCapability(resourceType: string): WriteCapability | null {
  switch (resourceType) {
    case 'product':
      return 'product';
    case 'collection':
      return 'collection';
    case 'page':
      return 'page';
    case 'blog':
      return 'blog';
    case 'article':
      return 'article';
    default:
      return null;
  }
}

function buildFieldSpec(actionType: string, resourceType: string): ExecutionOperation {
  const capability = resourceTypeToCapability(resourceType);
  if (capability === 'product') {
    return seoFieldOperation({
      actionType,
      resourceType,
      capability,
      writerMethod: 'updateProduct',
      restorePath: ['seo', fieldKeyFor(actionType)],
    });
  }
  if (capability === 'page') {
    return seoFieldOperation({
      actionType,
      resourceType,
      capability,
      writerMethod: 'updatePage',
      restorePath: ['seo', fieldKeyFor(actionType)],
    });
  }
  if (capability === 'blog') {
    return seoFieldOperation({
      actionType,
      resourceType,
      capability,
      writerMethod: 'updateBlog',
      restorePath: ['seo', fieldKeyFor(actionType)],
    });
  }
  return buildUnsupportedOperation({ actionType, resourceType, capability });
}

/** Resolves the operation for an (actionType, resourceType) pair. */
export function buildOperation(actionType: string, resourceType: string): ExecutionOperation {
  switch (actionType) {
    case 'update_title':
    case 'update_meta_description':
      return buildFieldSpec(actionType, resourceType);
    case 'update_description': {
      const capability = resourceTypeToCapability(resourceType);
      if (capability === 'product') {
        return bodyOperation({
          actionType,
          resourceType,
          capability,
          writerMethod: 'updateProduct',
          field: 'descriptionHtml',
        });
      }
      return buildFieldSpec(actionType, resourceType);
    }
    case 'update_body': {
      const capability = resourceTypeToCapability(resourceType);
      if (capability === 'page') {
        return bodyOperation({ actionType, resourceType, capability, writerMethod: 'updatePage', field: 'bodyHtml' });
      }
      if (capability === 'article') {
        return buildUnsupportedOperation({ actionType, resourceType, capability });
      }
      return buildUnsupportedOperation({ actionType, resourceType, capability });
    }
    case 'update_url': {
      const capability = resourceTypeToCapability(resourceType);
      if (capability === 'product') {
        return urlOperation({ resourceType, capability, writerMethod: 'updateProduct' });
      }
      if (capability === 'page') {
        return urlOperation({ resourceType, capability, writerMethod: 'updatePage' });
      }
      if (capability === 'blog') {
        return urlOperation({ resourceType, capability, writerMethod: 'updateBlog' });
      }
      return buildUnsupportedOperation({ actionType, resourceType, capability });
    }
    case 'update_meta':
      return buildUnsupportedOperation({ actionType, resourceType, capability: 'metafield' });
    case 'add_structured_data':
    case 'remove_structured_data':
      return buildUnsupportedOperation({ actionType, resourceType, capability: 'metafield' });
    case 'fix_internal_links':
    case 'add_internal_links':
    case 'remove_internal_links':
      return buildUnsupportedOperation({ actionType, resourceType, capability: 'internal_links' });
    case 'update_alt_text':
      return buildUnsupportedOperation({ actionType, resourceType, capability: 'image' });
    case 'add_image':
      return buildImageOperation();
    case 'remove_image':
      return buildUnsupportedOperation({ actionType, resourceType, capability: 'image' });
    case 'update_robots':
    case 'update_canonical':
      return buildUnsupportedOperation({ actionType, resourceType, capability: 'metafield' });
    case 'remove_redirect':
    case 'update_redirect':
      return buildUnsupportedOperation({ actionType, resourceType, capability: 'redirect' });
    case 'create_page':
    case 'delete_page':
      return buildUnsupportedOperation({ actionType, resourceType, capability: 'page' });
    case 'update_collection':
    case 'update_article':
      return buildUnsupportedOperation({
        actionType,
        resourceType,
        capability: actionType === 'update_collection' ? 'collection' : 'article',
      });
    case 'update_product':
      return buildGenericUpdateOperation({
        actionType,
        resourceType: 'product',
        capability: 'product',
        writerMethod: 'updateProduct',
        payloadKey: 'product',
      });
    case 'update_blog':
      return buildGenericUpdateOperation({
        actionType,
        resourceType: 'blog',
        capability: 'blog',
        writerMethod: 'updateBlog',
        payloadKey: 'blog',
      });
    case 'update_theme':
      return buildThemeOperation();
    case 'sitemap':
      return buildUnsupportedOperation({ actionType, resourceType: 'store', capability: 'sitemap' });
    case 'custom':
      return buildUnsupportedOperation({ actionType, resourceType: 'store', capability: null, requiresApproval: true });
    default:
      return buildUnsupportedOperation({ actionType, resourceType, capability: null, requiresApproval: true });
  }
}

/** The default operation catalog for the engine. */
export function defaultOperations(): ExecutionOperation[] {
  const pairs: Array<[string, string]> = [];
  const resourceTypes = ['product', 'collection', 'page', 'blog', 'article'] as const;
  for (const resourceType of resourceTypes) {
    pairs.push([`update_title`, resourceType]);
    pairs.push([`update_meta_description`, resourceType]);
    pairs.push([`update_description`, resourceType]);
    pairs.push([`update_body`, resourceType]);
    pairs.push([`update_url`, resourceType]);
  }
  const storeLevel: Array<[string, string]> = [
    ['add_image', 'product'],
    ['remove_image', 'product'],
    ['update_alt_text', 'product'],
    ['add_structured_data', 'product'],
    ['remove_structured_data', 'product'],
    ['fix_internal_links', 'page'],
    ['add_internal_links', 'page'],
    ['remove_internal_links', 'page'],
    ['update_meta', 'product'],
    ['update_robots', 'page'],
    ['update_canonical', 'page'],
    ['remove_redirect', 'store'],
    ['update_redirect', 'store'],
    ['create_page', 'page'],
    ['delete_page', 'page'],
    ['update_collection', 'collection'],
    ['update_product', 'product'],
    ['update_blog', 'blog'],
    ['update_article', 'article'],
    ['update_theme', 'store'],
    ['sitemap', 'store'],
    ['custom', 'store'],
  ];
  return [...pairs, ...storeLevel].map(([actionType, resourceType]) =>
    buildOperation(actionType, resourceType),
  );
}
