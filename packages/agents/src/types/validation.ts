export type ValidationCode =
  | 'structure'
  | 'schema'
  | 'hallucinated-action'
  | 'unsupported-operation'
  | 'bound'
  | 'safety';

export interface ValidationFailure {
  code: ValidationCode;
  path: string;
  message: string;
}
