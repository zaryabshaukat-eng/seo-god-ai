/**
 * Adapts the observability service to the execution engine's
 * {@link ExecutionSink}: every execution event the engine emits is forwarded
 * into the observability engine for recording, metrics and alerts.
 */

import type { ExecutionEvent, ExecutionSink } from '@seogod/execution-engine';
import type { ObservabilityService } from '../service/observability-service.js';

export class ExecutionSinkAdapter implements ExecutionSink {
  constructor(private readonly service: ObservabilityService) {}

  async emit(event: ExecutionEvent): Promise<void> {
    await this.service.handle(event);
  }
}
