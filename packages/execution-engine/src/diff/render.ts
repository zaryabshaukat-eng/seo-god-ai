import type { ExecutionDiff } from '../types/diff.js';
import { formatValue } from './diff-engine.js';

/** Renders a human-readable summary of an execution diff. */
export function renderDiff(diff: ExecutionDiff): string {
  if (!diff.hasChanges) {
    return `No changes for ${diff.resourceType} ${diff.entityId}.`;
  }
  const lines = [
    `${diff.resourceType} ${diff.entityId} (${diff.actionType}): ${diff.summary}`,
  ];
  for (const change of diff.changes) {
    if (change.kind === 'added') {
      lines.push(`  + ${change.field}: ${formatValue(change.next)}`);
    } else if (change.kind === 'removed') {
      lines.push(`  - ${change.field}: ${formatValue(change.previous)}`);
    } else {
      lines.push(
        `  ~ ${change.field}: ${formatValue(change.previous)} -> ${formatValue(change.next)}`,
      );
    }
  }
  return lines.join('\n');
}

/** One-line summary used in logs and reports. */
export function oneLineSummary(diff: ExecutionDiff): string {
  if (!diff.hasChanges) {
    return `${diff.resourceType}:${diff.entityId} unchanged`;
  }
  return `${diff.resourceType}:${diff.entityId} ${diff.changes.length} field(s) changed`;
}
