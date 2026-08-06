/**
 * Typed error hierarchy for reporting failures. Every error extends the
 * platform-wide {@link AppError} so loggers, monitoring and the API layer
 * handle reporting failures uniformly with stable codes and context.
 */

import { AppError, ConflictError, NotFoundError, ValidationError } from '@seogod/core';

export type ReportErrorCode =
  | 'report.validation'
  | 'report.not_found'
  | 'report.conflict'
  | 'report.render'
  | 'report.schedule';

export interface ReportErrorContext extends Record<string, unknown> {
  storeId?: string;
  templateId?: string;
  scheduleId?: string;
  reportId?: string;
}

export class ReportError extends AppError {
  declare readonly code: ReportErrorCode;
  declare readonly context: ReportErrorContext;

  constructor(
    message: string,
    options: {
      code: ReportErrorCode;
      context?: ReportErrorContext;
      cause?: unknown;
      requestId?: string;
    },
  ) {
    super(message, {
      code: options.code,
      context: options.context,
      cause: options.cause,
      requestId: options.requestId,
    });
  }
}

/** Report input (template, period, schedule) was invalid. */
export class ReportValidationError extends ValidationError {
  constructor(message: string, context?: ReportErrorContext) {
    super(message, { module: 'reports', operation: 'reports.validate', context });
  }
}

/** A requested template or schedule does not exist. */
export class ReportNotFoundError extends NotFoundError {
  constructor(message: string, context?: ReportErrorContext) {
    super(message, { module: 'reports', operation: 'reports.lookup', context });
  }
}

/** A write collided with existing state (duplicate schedule id, etc.). */
export class ReportConflictError extends ConflictError {
  constructor(message: string, context?: ReportErrorContext) {
    super(message, { module: 'reports', operation: 'reports.write', context });
  }
}

/** Rendering a report to PDF/CSV/JSON failed. */
export class ReportRenderError extends ReportError {
  constructor(message: string, context?: ReportErrorContext, cause?: unknown) {
    super(message, { code: 'report.render', context, cause });
  }
}

/** Scheduling a report run failed. */
export class ReportScheduleError extends ReportError {
  constructor(message: string, context?: ReportErrorContext, cause?: unknown) {
    super(message, { code: 'report.schedule', context, cause });
  }
}
