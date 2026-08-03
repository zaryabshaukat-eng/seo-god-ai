/**
 * Prompt-template types. All prompts are versioned, parameterized templates
 * registered with the prompt builder; there are no inline prompts.
 */

export interface PromptTemplate {
  /** Stable id, e.g. `agent.task`. */
  id: string;
  /** Semantic version, e.g. `1.0.0`. */
  version: string;
  description: string;
  /** Template body with `{{placeholder}}` parameters. */
  content: string;
}

export interface RenderPromptOptions {
  /** Template version to render (`latest` when omitted). */
  version?: string;
}
