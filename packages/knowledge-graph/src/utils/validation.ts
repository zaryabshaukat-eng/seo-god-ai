import { ValidationError } from '@seogod/core';
import { isEdgeType, isNodeType } from '../types/graph.js';
import type { EdgeInput, NodeInput } from '../types/graph.js';

function fail(path: string, expected: string, received: unknown): ValidationError {
  return new ValidationError(`Invalid ${path}: expected ${expected}`, {
    module: 'knowledge-graph',
    operation: 'validateInput',
    context: { path, received: String(received) },
  });
}

/** Validates a node input before it enters the graph. */
export function validateNodeInput(input: NodeInput): void {
  if (!isNodeType(input.type)) throw fail('type', 'a valid NodeType', input.type);
  if (typeof input.externalId !== 'string' || input.externalId.trim() === '') {
    throw fail('externalId', 'a non-empty string', input.externalId);
  }
  if (typeof input.source !== 'string' || input.source.trim() === '') {
    throw fail('source', 'a non-empty string', input.source);
  }
  if (input.name !== undefined && input.name !== null && typeof input.name !== 'string') {
    throw fail('name', 'a string or null', input.name);
  }
}

/** Validates an edge input before it enters the graph. */
export function validateEdgeInput(input: EdgeInput): void {
  if (!isEdgeType(input.type)) throw fail('type', 'a valid EdgeType', input.type);
  if (typeof input.from !== 'string' || input.from === '') {
    throw fail('from', 'a node id', input.from);
  }
  if (typeof input.to !== 'string' || input.to === '') {
    throw fail('to', 'a node id', input.to);
  }
  if (input.from === input.to) {
    throw new ValidationError('Self-referencing edges are not allowed', {
      module: 'knowledge-graph',
      operation: 'validateInput',
      context: { nodeId: input.from },
    });
  }
  if (typeof input.source !== 'string' || input.source.trim() === '') {
    throw fail('source', 'a non-empty provenance string', input.source);
  }
  const weight = input.weight ?? 1;
  if (typeof weight !== 'number' || !Number.isFinite(weight) || weight < 0) {
    throw fail('weight', 'a finite number >= 0', weight);
  }
  const confidence = input.confidence ?? 1;
  if (typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw fail('confidence', 'a number in 0..1', confidence);
  }
}
