import { describe, expect, it } from 'vitest';
import { AGENT_SUMMARY_TEMPLATE, AGENT_TASK_TEMPLATE, SYSTEM_CONTEXT_TEMPLATE } from './templates.js';
import { PromptBuilder } from './prompt-builder.js';

describe('templates', () => {
  it('provides the three default versioned templates', () => {
    expect(AGENT_TASK_TEMPLATE.id).toBe('agent.task');
    expect(AGENT_SUMMARY_TEMPLATE.id).toBe('agent.summary');
    expect(SYSTEM_CONTEXT_TEMPLATE.id).toBe('system.context');
    expect(AGENT_TASK_TEMPLATE.version).toBe('1.0.0');
    expect(AGENT_TASK_TEMPLATE.content).toContain('{{taskDescription}}');
    expect(SYSTEM_CONTEXT_TEMPLATE.content).toContain('orchestrator');
  });
});

describe('PromptBuilder', () => {
  it('registers defaults and reports them', () => {
    const builder = new PromptBuilder();
    expect(builder.has('agent.task')).toBe(true);
    expect(builder.has('nope')).toBe(false);
    expect(builder.list().map((t) => t.id)).toEqual(
      expect.arrayContaining(['agent.task', 'agent.summary', 'system.context']),
    );
  });

  it('renders a template with parameters', () => {
    const builder = new PromptBuilder();
    const out = builder.render('agent.task', {
      agentName: 'a',
      agentVersion: '1',
      capabilities: 'x',
      taskName: 't',
      taskDescription: 'd',
      contextJson: '{}',
      schemaJson: '{}',
    });
    expect(out).toContain('You are a');
    expect(out).toContain('## Task: t');
  });

  it('rejects missing parameters', () => {
    const builder = new PromptBuilder();
    expect(() => builder.render('agent.task', {})).toThrowError(/missing parameter "agentName"/);
  });

  it('rejects templates that still contain placeholders', () => {
    const builder = new PromptBuilder([{ id: 'bad', version: '1.0.0', description: '', content: '{{x}} {{y}}' }]);
    expect(() => builder.render('bad', { x: '1', y: '{{z}}' })).toThrowError(/unresolved/);
  });

  it('fails on empty id or version during registration', () => {
    const builder = new PromptBuilder([]);
    expect(() => builder.register({ id: '', version: '1', description: '', content: '' })).toThrowError(/id/);
    expect(() => builder.register({ id: 'x', version: '', description: '', content: '' })).toThrowError(/version/);
  });

  it('fails on unknown template and unknown version', () => {
    const builder = new PromptBuilder();
    expect(() => builder.get('missing')).toThrowError(/not registered/);
    expect(() => builder.get('agent.task', { version: '9.9.9' })).toThrowError(/9.9.9/);
  });

  it('returns the latest registered version by default', () => {
    const builder = new PromptBuilder([]);
    builder.register({ id: 't', version: '1.0.0', description: '', content: 'one' });
    builder.register({ id: 't', version: '2.0.0', description: '', content: 'two' });
    expect(builder.get('t').version).toBe('2.0.0');
    expect(builder.get('t', { version: '1.0.0' }).content).toBe('one');
  });
});
