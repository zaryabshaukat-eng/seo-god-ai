import { describe, expect, it } from 'vitest';
import { isSupportedAction, isUnsafeAction } from './action-policy.js';
import { SafetyGuard } from './safety-guard.js';

describe('action policy', () => {
  it('allows supported actions and rejects unknown ones', () => {
    expect(isSupportedAction('update_title')).toBe(true);
    expect(isSupportedAction('create_page')).toBe(true);
    expect(isSupportedAction('hack_the_planet')).toBe(false);
  });

  it('flags destructive actions as unsafe', () => {
    expect(isUnsafeAction('delete_page')).toBe(true);
    expect(isUnsafeAction('remove_redirect')).toBe(true);
    expect(isUnsafeAction('update_title')).toBe(false);
  });
});

describe('SafetyGuard', () => {
  const allowed = ['update_title'];

  it('passes a well-formed, allowed output', () => {
    const decision = new SafetyGuard().evaluate(
      { text: '{"action":"update_title","resourceId":"/p/1"}', data: { action: 'update_title' } },
      { allowedActions: allowed },
    );
    expect(decision.ok).toBe(true);
    expect(decision.checks.every((check) => check.passed)).toBe(true);
  });

  it('rejects empty output', () => {
    const decision = new SafetyGuard().evaluate({ text: '   ', data: {} });
    expect(decision.ok).toBe(false);
    expect(decision.reason).toContain('non-empty');
  });

  it('rejects outputs without parseable JSON data', () => {
    const decision = new SafetyGuard().evaluate({ text: 'hi', data: null });
    expect(decision.ok).toBe(false);
    expect(decision.checks.find((c) => c.id === 'valid-json')?.passed).toBe(false);
  });

  it('rejects schema violations when a schema is given', () => {
    const decision = new SafetyGuard().evaluate(
      { text: 'x', data: { action: 'update_title' }, schema: { type: 'object', required: ['resourceId'] } },
      { allowedActions: allowed },
    );
    expect(decision.ok).toBe(false);
    expect(decision.checks.find((c) => c.id === 'schema')?.passed).toBe(false);
  });

  it('rejects unsupported actions', () => {
    const decision = new SafetyGuard().evaluate(
      { text: 'x', data: { action: 'hack_the_planet' } },
      { allowedActions: allowed },
    );
    expect(decision.ok).toBe(false);
    expect(decision.checks.find((c) => c.id === 'supported-action')?.passed).toBe(false);
  });

  it('rejects unsafe actions even when the plan allows them when allowedActions is absent', () => {
    const decision = new SafetyGuard().evaluate({ text: 'x', data: { action: 'delete_page' } });
    expect(decision.ok).toBe(false);
    expect(decision.checks.find((c) => c.id === 'safe-action')?.passed).toBe(false);
  });

  it('passes an output with no action at all', () => {
    const decision = new SafetyGuard().evaluate({ text: 'x', data: { foo: 1 } });
    expect(decision.ok).toBe(true);
    expect(decision.checks.filter((c) => c.id.startsWith('safe')).every((c) => c.passed)).toBe(true);
  });

  it('does not treat arrays or primitives as actions', () => {
    const decision = new SafetyGuard().evaluate({ text: 'x', data: ['delete_page'] });
    expect(decision.ok).toBe(true);
  });

  it('ignores non-string action values', () => {
    const decision = new SafetyGuard().evaluate(
      { text: 'x', data: { action: 42, actionType: '' } },
      { allowedActions: allowed },
    );
    expect(decision.ok).toBe(true);
  });
});
