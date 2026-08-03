import { describe, expect, it } from 'vitest';
import { fixedClock, STORE_ID } from '../test/fixtures.js';
import { ApprovalRequestModel } from './approval-request.js';

function makeRequest() {
  return ApprovalRequestModel.create({
    planId: 'plan-1',
    decisionId: 'decision-1',
    storeId: STORE_ID,
    policy: 'REQUIRE_APPROVAL',
    reason: 'medium risk',
    requestedBy: 'alice',
    now: fixedClock,
  });
}

describe('ApprovalRequestModel', () => {
  it('creates a pending request with a deterministic id', () => {
    const request = makeRequest();
    expect(request.status).toBe('PENDING');
    expect(request.decidedBy).toBeNull();
    expect(request.decidedAt).toBeNull();
    expect(request.createdAt).toEqual(fixedClock());
    const same = ApprovalRequestModel.create({
      planId: 'plan-1',
      decisionId: 'decision-1',
      storeId: STORE_ID,
      policy: 'REQUIRE_APPROVAL',
      reason: 'medium risk',
      requestedBy: 'alice',
      now: fixedClock,
    });
    expect(request.id).toBe(same.id);
  });

  it('decides a request immutably', () => {
    const request = makeRequest();
    const decided = ApprovalRequestModel.decide(request, 'APPROVED', 'bob', fixedClock);
    expect(decided.status).toBe('APPROVED');
    expect(decided.decidedBy).toBe('bob');
    expect(decided.decidedAt).toEqual(fixedClock());
    expect(request.status).toBe('PENDING');
  });

  it('copies records on fromRecord', () => {
    const request = makeRequest();
    const copy = ApprovalRequestModel.fromRecord(request);
    expect(copy).toEqual(request);
  });
});
