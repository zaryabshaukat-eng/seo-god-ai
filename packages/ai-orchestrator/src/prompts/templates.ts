import type { PromptTemplate } from '../types/prompt.js';

/** The one agent task template every provider call renders. */
export const AGENT_TASK_TEMPLATE: PromptTemplate = {
  id: 'agent.task',
  version: '1.0.0',
  description: 'Instructs a specialist agent to complete one task within a workflow.',
  content: [
    'You are {{agentName}}, an expert SEO agent (version {{agentVersion}}).',
    'Your capabilities: {{capabilities}}',
    '',
    '## Task: {{taskName}}',
    '{{taskDescription}}',
    '',
    '## Context',
    '{{contextJson}}',
    '',
    '## Output requirements',
    'Respond with a single JSON object matching this schema: {{schemaJson}}',
    'Your response must be valid JSON and nothing else.',
  ].join('\n'),
};

export const AGENT_SUMMARY_TEMPLATE: PromptTemplate = {
  id: 'agent.summary',
  version: '1.0.0',
  description: 'Produces a short, structured summary of prior agent outcomes.',
  content: [
    'You are summarizing past {{agentName}} outcomes.',
    '',
    '## History',
    '{{historyJson}}',
    '',
    'Return a JSON object: {"summary": string, "insights": string[]}',
  ].join('\n'),
};

export const SYSTEM_CONTEXT_TEMPLATE: PromptTemplate = {
  id: 'system.context',
  version: '1.0.0',
  description: 'Attaches global guardrails to any agent invocation.',
  content: [
    'You only perform actions the orchestrator approves.',
    'Never invent store data, URLs, or measurements.',
    'If the task cannot be completed from the provided context, return',
    '{"error": "<reason>"} instead of guessing.',
  ].join('\n'),
};

export const DEFAULT_TEMPLATES: readonly PromptTemplate[] = [
  AGENT_TASK_TEMPLATE,
  AGENT_SUMMARY_TEMPLATE,
  SYSTEM_CONTEXT_TEMPLATE,
];
