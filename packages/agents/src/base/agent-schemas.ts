import type { JsonSchema, SchemaProperty } from '../types/schema.js';

/** Single entity shape shared by every agent's input schema. */
export const ENTITY_SCHEMA: SchemaProperty = {
  type: 'object',
  required: ['id', 'type', 'ref', 'data'],
  additionalProperties: false,
  properties: {
    id: { type: 'string', minLength: 1 },
    type: { type: 'string', minLength: 1 },
    ref: { type: 'string', minLength: 1 },
    data: { type: 'object' },
  },
};

/** The standard input every agent accepts. */
export const AGENT_INPUT_SCHEMA: JsonSchema = {
  type: 'object',
  description: 'Standard agent input: store, workflow, task and entities.',
  required: ['storeId', 'taskId', 'entities'],
  additionalProperties: false,
  properties: {
    storeId: { type: 'string', minLength: 1 },
    workflowId: { type: 'string', minLength: 1 },
    taskId: { type: 'string', minLength: 1 },
    entities: { type: 'array', items: ENTITY_SCHEMA },
    context: { type: 'object' },
    settings: { type: 'object' },
  },
};

const EVIDENCE_SCHEMA: SchemaProperty = {
  type: 'object',
  required: ['url', 'field', 'value'],
  properties: {
    url: { type: 'string', minLength: 1 },
    field: { type: 'string', minLength: 1 },
    value: { type: ['string', 'number', 'boolean', 'null'] },
    snippet: { type: 'string' },
  },
};

const RECOMMENDATION_SCHEMA: SchemaProperty = {
  type: 'object',
  required: [
    'rule',
    'title',
    'summary',
    'reason',
    'evidence',
    'severity',
    'confidence',
    'estimatedImpact',
    'risk',
    'implementationDifficulty',
    'expectedExecutionTime',
    'rollbackPossible',
    'approvalRequired',
    'affectedUrls',
  ],
  additionalProperties: false,
  properties: {
    rule: { type: 'string', minLength: 1 },
    title: { type: 'string', minLength: 1 },
    summary: { type: 'string', minLength: 1 },
    reason: { type: 'string', minLength: 1 },
    evidence: { type: 'array', items: EVIDENCE_SCHEMA },
    severity: { type: 'string', enum: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'] },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    estimatedImpact: { type: 'number', minimum: 0, maximum: 100 },
    risk: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH'] },
    implementationDifficulty: { type: 'string', enum: ['TRIVIAL', 'LOW', 'MEDIUM', 'HIGH'] },
    expectedExecutionTime: { type: 'string', minLength: 1 },
    rollbackPossible: { type: 'boolean' },
    approvalRequired: { type: 'boolean' },
    affectedUrls: { type: 'array', items: { type: 'string' } },
  },
};

const ACTION_SCHEMA: SchemaProperty = {
  type: 'object',
  required: [
    'actionType',
    'resourceType',
    'resourceId',
    'resourceRef',
    'payload',
    'priority',
    'estimatedSeconds',
    'rationale',
  ],
  additionalProperties: false,
  properties: {
    actionType: { type: 'string', minLength: 1 },
    resourceType: { type: 'string', enum: ['product', 'collection', 'page', 'blog', 'article', 'store'] },
    resourceId: { type: 'string', minLength: 1 },
    resourceRef: { type: 'string', minLength: 1 },
    payload: { type: 'object' },
    priority: { type: 'number', minimum: 0, maximum: 100 },
    estimatedSeconds: { type: 'number', minimum: 0 },
    rationale: { type: 'string' },
  },
};

/** The strict, versioned output contract every agent must satisfy. */
export const AGENT_OUTPUT_SCHEMA: JsonSchema = {
  type: 'object',
  description: 'Agent output contract.',
  required: [
    'agentId',
    'taskId',
    'status',
    'recommendations',
    'actions',
    'confidence',
    'risk',
    'evidence',
    'estimatedImpact',
    'dependencies',
    'warnings',
    'executionHints',
  ],
  additionalProperties: false,
  properties: {
    agentId: { type: 'string', minLength: 1 },
    taskId: { type: 'string', minLength: 1 },
    status: { type: 'string', enum: ['SUCCESS', 'PARTIAL', 'FAILED'] },
    recommendations: { type: 'array', items: RECOMMENDATION_SCHEMA },
    actions: { type: 'array', items: ACTION_SCHEMA },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    risk: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH'] },
    evidence: { type: 'array', items: EVIDENCE_SCHEMA },
    estimatedImpact: { type: 'number', minimum: 0, maximum: 100 },
    dependencies: { type: 'array', items: { type: 'string' } },
    warnings: { type: 'array', items: { type: 'string' } },
    executionHints: { type: 'array', items: { type: 'string' } },
  },
};
