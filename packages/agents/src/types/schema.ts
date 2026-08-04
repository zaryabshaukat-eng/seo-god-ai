/**
 * Minimal JSON-schema subset used for agent input/output contracts. Kept
 * intentionally small and deterministic: objects, arrays and primitives with
 * length/range/enum constraints. No `$ref`, no `anyOf`.
 */
export type SchemaType = 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null';

export interface SchemaProperty {
  type?: SchemaType | readonly SchemaType[];
  description?: string;
  enum?: readonly (string | number | boolean)[];
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  minimum?: number;
  maximum?: number;
  items?: SchemaProperty;
  properties?: Record<string, SchemaProperty>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface JsonSchema {
  type: 'object';
  description?: string;
  required?: string[];
  properties?: Record<string, SchemaProperty>;
  additionalProperties?: boolean;
}
