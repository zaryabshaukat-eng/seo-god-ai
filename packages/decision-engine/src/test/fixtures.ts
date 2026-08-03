import type { Recommendation } from '@seogod/seo-engine';
import type {
  DecisionEngineInput,
  GraphContext,
  StoreSettings,
} from '../types/input.js';
import type { ExecutionTask } from '../types/plan.js';

export const STORE_ID = 'store-1';
export const CRAWL_JOB_ID = 'crawl-1';
export const ORIGIN = 'https://acme.example';

export const fixedClock = (): Date => new Date('2026-01-01T00:00:00.000Z');

export function recommendation(overrides: Partial<Recommendation> = {}): Recommendation {
  return {
    id: 'recommendation-1',
    rule: 'missing-title',
    category: 'content',
    priority: 'HIGH',
    score: 88,
    impact: 'HIGH',
    effort: 'LOW',
    confidence: 0.85,
    title: 'Add a unique page title',
    description: 'Add unique titles to every page',
    rationale: 'Unique titles drive clicks',
    recommendedAction: 'Write a unique title',
    evidence: [],
    affectedUrls: [`${ORIGIN}/p/1`],
    pageCount: 1,
    occurrenceCount: 1,
    crawlJobId: CRAWL_JOB_ID,
    storeId: STORE_ID,
    aiContext: {
      rule: 'missing-title',
      category: 'content',
      priority: 'HIGH',
      score: 88,
      impact: 'HIGH',
      effort: 'LOW',
      summary: 'Add a unique page title',
      recommendedAction: 'Write a unique title',
      affectedUrls: [`${ORIGIN}/p/1`],
      evidenceValues: [],
      constraints: [],
    },
    ...overrides,
  };
}

export function storeSettings(overrides: Partial<StoreSettings> = {}): StoreSettings {
  return {
    storeId: STORE_ID,
    approvalMode: 'auto',
    riskTolerance: 'balanced',
    maxBatchSize: 50,
    maxChangesPerResource: 3,
    planCapRecommendations: null,
    ...overrides,
  };
}

export function graphContext(overrides: Partial<GraphContext> = {}): GraphContext {
  return {
    snapshotId: 'snapshot-1',
    pageCount: 10,
    orphanPages: [{ id: 'node-orphan', url: `${ORIGIN}/orphan`, type: 'page', inLinks: 0 }],
    topicClusters: [],
    contentGaps: [],
    duplicateTargets: [],
    ...overrides,
  };
}

export function decisionInput(
  overrides: Partial<DecisionEngineInput> = {},
): DecisionEngineInput {
  return {
    storeId: STORE_ID,
    source: 'manual',
    recommendations: [recommendation()],
    storeSettings: storeSettings(),
    featureFlags: {},
    historicalOutcomes: [],
    graph: null,
    requestedBy: 'test-user',
    ...overrides,
  };
}

let taskCounter = 0;

/** Builds a minimal execution task for unit tests. */
export function task(overrides: Partial<ExecutionTask> = {}): ExecutionTask {
  taskCounter += 1;
  const id = overrides.id ?? `task-${taskCounter}`;
  return {
    id,
    storeId: STORE_ID,
    decisionId: 'decision-1',
    planId: 'plan-1',
    recommendationId: 'recommendation-1',
    rule: 'missing-title',
    actionType: 'update_title',
    resourceType: 'page',
    resourceId: `${ORIGIN}/p/1`,
    resourceRef: `${ORIGIN}/p/1`,
    payload: {},
    priority: 80,
    status: 'PENDING',
    dependsOn: [],
    isMutating: true,
    risk: 'LOW',
    estimatedSeconds: 15,
    rollback: null,
    result: null,
    createdAt: fixedClock(),
    updatedAt: fixedClock(),
    ...overrides,
  };
}
