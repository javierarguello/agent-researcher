/**
 * Provider-agnostic LLM interface.
 *
 * The research engine only ever talks to this interface, so swapping Gemini for
 * Claude later means implementing one more `LlmProvider` — no change to the
 * agent loop, tools, or templates.
 *
 * Tool parameter schemas are plain JSON Schema (the universal format); each
 * provider adapts them to its own function-calling dialect.
 */

export interface ToolSchema {
  name: string;
  description: string;
  /** Standard JSON Schema object describing the tool's arguments. */
  parameters: JsonSchema;
}

export interface JsonSchema {
  type: 'object' | 'string' | 'number' | 'integer' | 'boolean' | 'array';
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: string[];
}

export interface ToolCall {
  /** Stable id for pairing a call with its result (provider may synthesize it). */
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export type LlmRole = 'user' | 'model' | 'tool';

export interface LlmMessage {
  role: LlmRole;
  /** Text content for 'user' / 'model' turns. */
  text?: string;
  /** Tool calls the model requested (on a 'model' turn). */
  toolCalls?: ToolCall[];
  /** Result of a tool call (on a 'tool' turn), paired to a call by `name`. */
  toolResult?: { name: string; response: unknown };
}

export interface GenerateOptions {
  system: string;
  messages: LlmMessage[];
  tools?: ToolSchema[];
  model: string;
  temperature?: number;
  /** Ask the model for raw text only (no tool calls) — used for synthesis. */
  disableTools?: boolean;
  /** Force the model to call a tool this turn (function-calling mode ANY). */
  forceTools?: boolean;
  /**
   * When set, the model must return a single JSON value conforming to this
   * standard JSON Schema (structured output). `text` will hold the raw JSON.
   * Each provider adapts it to its own controlled-generation dialect. Implies
   * no tool calls this turn.
   */
  responseSchema?: Record<string, unknown>;
  /** Cap on generated tokens (important for long structured JSON). */
  maxOutputTokens?: number;
  /**
   * Thinking-token budget for reasoning models (Gemini 2.5). 0 disables "thinking"
   * so the whole output budget goes to the answer — important for short structured
   * JSON calls, where thinking would otherwise eat maxOutputTokens and truncate the
   * JSON. Omit to use the model default.
   */
  thinkingBudget?: number;
}

export interface TokenUsage {
  inputTokens: number;
  /** Output tokens billed (candidates + any thinking/thoughts tokens). */
  outputTokens: number;
}

export interface GenerateResult {
  text: string;
  toolCalls: ToolCall[];
  /** Token usage for this call, when the provider reports it. */
  usage?: TokenUsage;
}

export interface LlmProvider {
  readonly name: string;
  generate(opts: GenerateOptions): Promise<GenerateResult>;
}
