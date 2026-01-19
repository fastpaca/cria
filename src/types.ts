import type { z } from "zod";

/**
 * Message role used by semantic `kind: "message"` regions.
 *
 * This is intentionally compatible with common LLM SDKs (system/user/assistant/tool),
 * while still allowing custom roles for bespoke targets.
 */
export type PromptRole = string;

/**
 * A model provider that can generate completions.
 *
 * This abstraction allows Cria components to call AI models without
 * being coupled to a specific SDK. Each provider specifies its own
 * rendered message type (e.g., AI SDK's ModelMessage[], OpenAI's
 * ChatCompletionMessageParam[]).
 */
export abstract class ModelProvider<TRendered> {
  /** Renderer that produces provider-specific prompt input. */
  abstract readonly renderer: PromptRenderer<TRendered>;

  /** Count tokens for rendered output (tiktoken-backed). */
  abstract countTokens(rendered: TRendered): number;

  /** Generate a text completion from rendered prompt input. */
  abstract completion(rendered: TRendered): MaybePromise<string>;

  /**
   * Generate a structured object validated against the schema.
   *
   * Implementations should use native structured output when available
   * (e.g., AI SDK's generateObject, OpenAI's json_schema response_format),
   * falling back to completion + JSON.parse + schema.parse internally.
   */
  abstract object<T>(
    rendered: TRendered,
    schema: z.ZodType<T>
  ): MaybePromise<T>;
}

/**
 * Context that can be provided through the component tree.
 *
 * Provider scopes inject context that child components can access during
 * rendering and strategy execution.
 */
export interface CriaContext {
  /** Model provider for AI-powered operations */
  provider?: ModelProvider<unknown> | undefined;
}

// Convenience type for functions that can return a promise or a value.
export type MaybePromise<T> = T | Promise<T>;

/**
 * Content parts that appear as leaf nodes in the prompt tree.
 * These are the actual semantic content (text, tool calls, etc.).
 */
export type PromptPart =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "tool-call"; toolCallId: string; toolName: string; input: unknown }
  | {
      type: "tool-result";
      toolCallId: string;
      toolName: string;
      output: unknown;
    };

export type ToolCallPart = Extract<PromptPart, { type: "tool-call" }>;
export type ToolResultPart = Extract<PromptPart, { type: "tool-result" }>;

/**
 * Structural node in the prompt tree. Contains metadata (priority, strategy)
 * and children, which can be parts, other nodes, or strings (which become text parts).
 */
export type PromptNode =
  | {
      priority: number;
      strategy?: Strategy | undefined;
      id?: string | undefined;
      context?: CriaContext | undefined;
      children: PromptChild[];
    }
  | {
      priority: number;
      strategy?: Strategy | undefined;
      id?: string | undefined;
      context?: CriaContext | undefined;
      kind: "message";
      role: PromptRole;
      children: PromptChild[];
    };

/**
 * A child in the prompt tree can be:
 * - A string (converted to text part during layout)
 * - A PromptPart (content leaf)
 * - A PromptNode (structural container)
 */
export type PromptChild = string | PromptPart | PromptNode;
export type PromptChildren = PromptChild[];

/**
 * The root of a prompt tree. Alias for backward compatibility.
 * Design: PromptTree (PromptNode with PromptPart leaves) -> PromptLayout (PromptPart[], message-bounded)
 * -> RenderOut. Layout flattens the tree into a linear sequence of parts grouped by messages.
 */
export type PromptElement = PromptNode;

export type MessageElement = Extract<PromptNode, { kind: "message" }>;
export type ToolCallElement = Extract<PromptPart, { type: "tool-call" }>;
export type ToolResultElement = Extract<PromptPart, { type: "tool-result" }>;
export type ReasoningElement = Extract<PromptPart, { type: "reasoning" }>;

export interface PromptMessage {
  // Tool messages are strict: exactly one tool-result part, no text.
  role: PromptRole;
  parts: PromptPart[];
}

export interface PromptLayout {
  messages: PromptMessage[];
}

/**
 * A renderer that converts a flat prompt layout into provider-specific output.
 */
export abstract class PromptRenderer<TOutput> {
  /** Render a layout into provider-specific output. */
  abstract render(layout: PromptLayout): TOutput;
}

export type StrategyResult = PromptElement | null;

/**
 * Context passed to strategy functions during the fit loop.
 *
 * @property target - The specific region to reduce
 * @property totalTokens - Current total token count for the prompt
 * @property iteration - Which iteration of the fit loop (for debugging)
 * @property context - Inherited context from ancestor provider components
 */
export interface StrategyInput {
  target: PromptElement;
  totalTokens: number;
  iteration: number;
  /** Context inherited from ancestor provider components */
  context: CriaContext;
}

/**
 * A Strategy function that rewrites a region subtree when the prompt is over budget.
 *
 * Strategies are applied during fitting, starting from the least important
 * priority (highest number). Strategies run **bottom-up** (post-order) so nested
 * regions get a chance to shrink before their parents.
 *
 * Strategies must be:
 * - **Pure**: don't mutate the input element
 * - **Deterministic**
 * - **Idempotent**
 *
 * Strategies have full ownership of their subtree: they can replace the element
 * and/or rewrite any children.
 */
export type Strategy = (input: StrategyInput) => MaybePromise<StrategyResult>;

/**
 * Error thrown when the prompt cannot be fit within the budget.
 *
 * This is a standard error that should be caught and handled by the caller.
 *
 * This happens when:
 * - No strategies remain but still over budget
 * - Strategies made no progress (possible infinite loop)
 *
 * @property overBudgetBy - How many tokens over budget
 * @property priority - The priority level where fitting failed (-1 if no strategies)
 * @property iteration - Which iteration of the fit loop failed
 */
export class FitError extends Error {
  overBudgetBy: number;
  priority: number;
  iteration: number;
  budget: number;
  totalTokens: number;

  constructor(params: {
    overBudgetBy: number;
    priority: number;
    iteration: number;
    budget: number;
    totalTokens: number;
  }) {
    const { overBudgetBy, priority, iteration, budget, totalTokens } = params;
    super(
      `Cannot fit prompt: ${totalTokens} tokens exceeds budget ${budget} by ${overBudgetBy} at priority ${priority} (iteration ${iteration})`
    );
    this.name = "FitError";
    this.overBudgetBy = overBudgetBy;
    this.priority = priority;
    this.iteration = iteration;
    this.budget = budget;
    this.totalTokens = totalTokens;
  }
}
