import type { ExecutionOperation, OperationRegistry } from '../types/publisher.js';
import { InvalidExecutionError, UnsupportedExecutionError } from '../utils/errors.js';
import { defaultOperations } from './operations.js';

export function operationKey(actionType: string, resourceType: string): string {
  return `${resourceType}.${actionType}`;
}

export class OperationRegistryImpl implements OperationRegistry {
  private readonly operations = new Map<string, ExecutionOperation>();

  constructor(operations: ExecutionOperation[] = defaultOperations()) {
    for (const operation of operations) {
      this.register(operation);
    }
  }

  register(operation: ExecutionOperation): void {
    const key = operationKey(operation.actionType, operation.resourceType);
    if (this.operations.has(key)) {
      throw new InvalidExecutionError(`operation ${key} is already registered`, {
        module: 'execution-engine',
        operation: 'execution.operation.register',
      });
    }
    this.operations.set(key, operation);
  }

  get(actionType: string, resourceType: string): ExecutionOperation {
    const operation = this.operations.get(operationKey(actionType, resourceType));
    if (operation === undefined) {
      throw new UnsupportedExecutionError(`no operation registered for ${resourceType}.${actionType}`, {
        module: 'execution-engine',
        operation: 'execution.operation.get',
      });
    }
    return operation;
  }

  has(actionType: string, resourceType: string): boolean {
    return this.operations.has(operationKey(actionType, resourceType));
  }

  list(): ExecutionOperation[] {
    return [...this.operations.values()];
  }
}
