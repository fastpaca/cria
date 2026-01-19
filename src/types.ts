/*
Prompt pipeline mental model (authoritative + opinionated):

Fluent DSL
   |
   v
PromptTree  (scopes + message leaves)
   |
   v
PromptLayout (flat, role-shaped messages)
   |
   v
RenderOut (provider payloads)

Why this shape?
- Scopes exist for compaction/strategy. They are structural only.
- Messages are semantic boundaries. They are leaf nodes and only hold parts.
- Parts are the smallest typed units (text/reasoning/tool-call/tool-result).

PromptLayout intentionally normalizes message shapes so renderers do NOT
re-interpret parts or re-check invariants. Some providers (AI SDK, Anthropic)
require a parts array, so renderers re-expand assistant/tool data back into
parts. That is a translation step for provider compatibility, not a loop in
the core model.
*/

import type { z } from "zod";

/**
 * Message role used by semantic `kind: "message"` nodes.
 *
 * This is intentionally compatible with common LLM SDKs (system/user/assistant/tool).
 */
export type PromptRole = "system" | "user" | "assistant" | "tool";

/**
 * A model provider that can generate completions.
 *
 * This abstraction allows Cria components to call AI models without
 * being coupled to a specific SDK. Each provider specifies its own
 * rendered message type (e.g., AI SDK's ModelMessage[], OpenAI's
 * ChatCompletionMessageParam[]).
 */
export interface ProviderToolIO {
  callInput: unknown;
  resultOutput: unknown;
}

interface UnboundToolIO {
  callInput: never;
  resultOutput: never;
}

export type ToolIOForProvider<P> =
  P extends ModelProvider<unknown, infer TToolIO> ? TToolIO : UnboundToolIO;

type ToolCallInput<TToolIO extends ProviderToolIO> = TToolIO["callInput"];
type ToolResultOutput<TToolIO extends ProviderToolIO> = TToolIO["resultOutput"];

export abstract class ModelProvider<
  TRendered,
  TToolIO extends ProviderToolIO = ProviderToolIO,
> {
  /** Renderer that produces provider-specific prompt input. */
  abstract readonly renderer: PromptRenderer<TRendered, TToolIO>;

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
  provider?: ModelProvider<unknown, ProviderToolIO> | undefined;
}

// Convenience type for functions that can return a promise or a value.
export type MaybePromise<T> = T | Promise<T>;

/**
 * Content parts that appear as leaf nodes in message nodes.
 */
export interface ToolCallPart<TToolIO extends ProviderToolIO = ProviderToolIO> {
  type: "tool-call";
  toolCallId: string;
  toolName: string;
  input: ToolCallInput<TToolIO>;
}

export interface ToolResultPart<
  TToolIO extends ProviderToolIO = ProviderToolIO,
> {
  type: "tool-result";
  toolCallId: string;
  toolName: string;
  output: ToolResultOutput<TToolIO>;
}

export type PromptPart<TToolIO extends ProviderToolIO = ProviderToolIO> =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | ToolCallPart<TToolIO>
  | ToolResultPart<TToolIO>;

export type ReasoningPart<TToolIO extends ProviderToolIO = ProviderToolIO> =
  Extract<PromptPart<TToolIO>, { type: "reasoning" }>;
export type TextPart<TToolIO extends ProviderToolIO = ProviderToolIO> = Extract<
  PromptPart<TToolIO>,
  { type: "text" }
>;

/**
 * Structural scope node in the prompt tree.
 * Scopes group messages for compaction and composition.
 */
export interface PromptScope<TToolIO extends ProviderToolIO = ProviderToolIO> {
  kind: "scope";
  priority: number;
  strategy?: Strategy | undefined;
  id?: string | undefined;
  context?: CriaContext | undefined;
  children: readonly PromptNode<TToolIO>[];
}

/**
 * Message boundary node in the prompt tree.
 */
export interface PromptMessageNode<
  TToolIO extends ProviderToolIO = ProviderToolIO,
> {
  kind: "message";
  role: PromptRole;
  id?: string | undefined;
  children: readonly PromptPart<TToolIO>[];
}

export type PromptNode<TToolIO extends ProviderToolIO = ProviderToolIO> =
  | PromptScope<TToolIO>
  | PromptMessageNode<TToolIO>;
export type PromptTree<TToolIO extends ProviderToolIO = ProviderToolIO> =
  PromptScope<TToolIO>;

export type ScopeChildren<TToolIO extends ProviderToolIO = ProviderToolIO> =
  readonly PromptNode<TToolIO>[];
export type MessageChildren<TToolIO extends ProviderToolIO = ProviderToolIO> =
  readonly PromptPart<TToolIO>[];

export interface SystemMessage {
  role: "system";
  text: string;
}

export interface UserMessage {
  role: "user";
  text: string;
}

export interface AssistantMessage<
  TToolIO extends ProviderToolIO = ProviderToolIO,
> {
  role: "assistant";
  text: string;
  reasoning?: string | undefined;
  toolCalls?: readonly ToolCallPart<TToolIO>[] | undefined;
}

export interface ToolMessage<TToolIO extends ProviderToolIO = ProviderToolIO> {
  role: "tool";
  toolCallId: string;
  toolName: string;
  output: ToolResultOutput<TToolIO>;
}

/*
PromptLayout is a list of fully-shaped messages. The union is deliberate:
- Assistant messages can include reasoning/toolCalls.
- Tool messages are singular tool results with call metadata.
- System/User messages are text-only.
This keeps invalid combinations out of the layout by construction.
*/
export type PromptMessage<TToolIO extends ProviderToolIO = ProviderToolIO> =
  | SystemMessage
  | UserMessage
  | AssistantMessage<TToolIO>
  | ToolMessage<TToolIO>;

export type PromptLayout<TToolIO extends ProviderToolIO = ProviderToolIO> =
  readonly PromptMessage<TToolIO>[];

/**
 * A renderer that converts a flat prompt layout into provider-specific output.
 */
export abstract class PromptRenderer<
  TOutput,
  TToolIO extends ProviderToolIO = ProviderToolIO,
> {
  /** Render a layout into provider-specific output. */
  abstract render(layout: PromptLayout<TToolIO>): TOutput;

  /**
   * Convert provider-specific history back into a prompt layout.
   * Providers can override this to enable `prompt.history(...)`.
   */
  historyToLayout(_rendered: TOutput): PromptLayout<TToolIO> {
    throw new Error("This provider does not support history parsing.");
  }
}

export type StrategyResult<TToolIO extends ProviderToolIO = ProviderToolIO> =
  PromptScope<TToolIO> | null;

/**
 * Context passed to strategy functions during the fit loop.
 *
 * @property target - The specific scope to reduce
 * @property totalTokens - Current total token count for the prompt
 * @property iteration - Which iteration of the fit loop (for debugging)
 * @property context - Inherited context from ancestor provider components
 */
export interface StrategyInput<
  TToolIO extends ProviderToolIO = ProviderToolIO,
> {
  target: PromptScope<TToolIO>;
  totalTokens: number;
  iteration: number;
  /** Context inherited from ancestor provider components */
  context: CriaContext;
}

/**
 * A Strategy function that rewrites a scope subtree when the prompt is over budget.
 *
 * Strategies are applied during fitting, starting from the least important
 * priority (highest number). Strategies run **bottom-up** (post-order) so nested
 * scopes get a chance to shrink before their parents.
 *
 * Strategies must be:
 * - **Pure**: don't mutate the input element
 * - **Deterministic**
 * - **Idempotent**
 *
 * Strategies have full ownership of their subtree: they can replace the element
 * and/or rewrite any children.
 */
export type Strategy = <TToolIO extends ProviderToolIO>(
  input: StrategyInput<TToolIO>
) => MaybePromise<StrategyResult<TToolIO>>;

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
