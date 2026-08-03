import type { Decision, DecisionStatus, DecisionSummary } from '../types/decision.js';
import type { DecisionEngineInput } from '../types/input.js';
import type { PrioritizedRecommendation } from '../types/prioritizer.js';
import { decisionContextFromInput } from '../prioritizer/prioritizer.js';
import { deterministicUuid } from '../utils/ids.js';

export interface DecisionCreateInput {
  input: DecisionEngineInput;
  prioritized: PrioritizedRecommendation[];
  summary: DecisionSummary;
  now: () => Date;
}

/**
 * Decision model: creation and deterministic status transitions. A decision
 * persists its full input context so planning is reproducible from the record.
 */
export class DecisionModel {
  static create(input: DecisionCreateInput): Decision {
    const { input: source, prioritized, summary, now } = input;
    const recommendationIds = source.recommendations
      .map((recommendation) => recommendation.id)
      .sort();
    const score = prioritized.length === 0
      ? 0
      : Math.round(
          prioritized.reduce((sum, entry) => sum + entry.score, 0) / prioritized.length,
        );
    return {
      id: deterministicUuid(
        'decision',
        `${source.storeId}\u0000${source.source ?? 'manual'}\u0000${recommendationIds.join('|')}`,
      ),
      storeId: source.storeId,
      source: source.source ?? 'manual',
      status: 'PENDING',
      score,
      recommendationIds,
      recommendations: source.recommendations.map((recommendation) => ({ ...recommendation })),
      context: decisionContextFromInput(source),
      summary,
      planId: null,
      createdAt: now(),
      updatedAt: now(),
    };
  }

  static fromRecord(record: Decision): Decision {
    return {
      ...record,
      recommendations: record.recommendations.map((recommendation) => ({ ...recommendation })),
    };
  }

  static setStatus(decision: Decision, status: DecisionStatus, now: () => Date): Decision {
    return { ...decision, status, updatedAt: now() };
  }

  static setPlanId(decision: Decision, planId: string, now: () => Date): Decision {
    return { ...decision, planId, updatedAt: now() };
  }

  static setSummary(decision: Decision, summary: DecisionSummary, now: () => Date): Decision {
    return { ...decision, summary, updatedAt: now() };
  }
}
