import { z } from "zod";

/**
 * Message role used by semantic `kind: "message"` regions.
 *
 * This is intentionally compatible with common LLM SDKs (system/user/assistant/tool),
 * while still allowing custom roles for bespoke targets.
 */
export const PromptRoleSchema = z
  .string()
  .describe(
    'Message role used by semantic `kind: "message"` regions (system/user/assistant/tool/custom).'
  );
export type PromptRole = z.infer<typeof PromptRoleSchema>;

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
 * Semantic variants for a region node.
 *
 * Cria’s IR is “Regions all the way down” (like a DOM tree). `PromptKindSchema`
 * defines how we recognize prompt parts so renderers can emit structured targets
 * without parsing strings.
 */
const PromptKindNoneSchema = z.object({ kind: z.undefined().optional() });
const PromptKindMessageSchema = z.object({
  kind: z.literal("message"),
  role: PromptRoleSchema,
});
const PromptKindToolCallSchema = z.object({
  kind: z.literal("tool-call"),
  toolCallId: z.string(),
  toolName: z.string(),
  input: z.unknown(),
});
const PromptKindToolResultSchema = z.object({
  kind: z.literal("tool-result"),
  toolCallId: z.string(),
  toolName: z.string(),
  output: z.unknown(),
});
const PromptKindReasoningSchema = z.object({
  kind: z.literal("reasoning"),
  text: z.string(),
});

export const PromptKindSchema = z.union([
  PromptKindNoneSchema,
  PromptKindMessageSchema,
  PromptKindToolCallSchema,
  PromptKindToolResultSchema,
  PromptKindReasoningSchema,
]);

export type PromptKind = z.infer<typeof PromptKindSchema>;
export type PromptNodeKind = PromptKind["kind"];

/**
 * The core IR node type. All Cria components return a `PromptElement`.
 *
 * **Everything is a Region** (think: a DOM `<div>`): `priority`, `strategy`, and
 * `children` make up the structural prompt tree.
 *
 * If you attach a semantic `kind` (via `PromptKind`), the node becomes a recognized
 * prompt part (message/tool-call/tool-result/reasoning) and renderers can emit
 * structured targets without parsing strings.
 *
 * `PromptElementSchema` is the single source of truth for validation and type inference.
 */
const strategyValidator = (value: unknown): value is Strategy =>
  typeof value === "function";

export interface PromptElementBase {
  priority: number;
  strategy?: Strategy | undefined;
  id?: string | undefined;
  context?: CriaContext | undefined;
  children: PromptChildren;
}

export type PromptElement =
  | (PromptElementBase & { kind?: undefined })
  | (PromptElementBase & { kind: "message"; role: PromptRole })
  | (PromptElementBase & {
      kind: "tool-call";
      toolCallId: string;
      toolName: string;
      input: unknown;
    })
  | (PromptElementBase & {
      kind: "tool-result";
      toolCallId: string;
      toolName: string;
      output: unknown;
    })
  | (PromptElementBase & { kind: "reasoning"; text: string });

export type PromptChild = string | PromptElement;
export type PromptChildren = PromptChild[];

const PromptBaseSchema = z
  .object({
    priority: z.number(),
    strategy: z.custom<Strategy>(strategyValidator).optional(),
    id: z.string().optional(),
    context: z.custom<CriaContext>().optional(),
  })
  .strict();

export const PromptElementSchema: z.ZodType<PromptElement> = z.lazy(() =>
  z.union([
    PromptBaseSchema.extend({
      kind: z.undefined().optional(),
      children: z.array(
        z.union([z.string(), z.lazy(() => PromptElementSchema)])
      ),
    }),
    PromptBaseSchema.extend({
      kind: z.literal("message"),
      role: PromptRoleSchema,
      children: z.array(
        z.union([z.string(), z.lazy(() => PromptElementSchema)])
      ),
    }),
    PromptBaseSchema.extend({
      kind: z.literal("tool-call"),
      toolCallId: z.string(),
      toolName: z.string(),
      input: z.unknown(),
      children: z.array(
        z.union([z.string(), z.lazy(() => PromptElementSchema)])
      ),
    }),
    PromptBaseSchema.extend({
      kind: z.literal("tool-result"),
      toolCallId: z.string(),
      toolName: z.string(),
      output: z.unknown(),
      children: z.array(
        z.union([z.string(), z.lazy(() => PromptElementSchema)])
      ),
    }),
    PromptBaseSchema.extend({
      kind: z.literal("reasoning"),
      text: z.string(),
      children: z.array(
        z.union([z.string(), z.lazy(() => PromptElementSchema)])
      ),
    }),
  ])
) as z.ZodType<PromptElement>;

export const PromptChildSchema: z.ZodType<PromptChild> = z.union([
  z.string(),
  z.lazy(() => PromptElementSchema),
]) as z.ZodType<PromptChild>;

export const PromptChildrenSchema: z.ZodType<PromptChildren> = z.array(
  PromptChildSchema
) as z.ZodType<PromptChildren>;

/**
 * Design: PromptTree (parts + children) -> PromptLayout (parts only, message-bounded)
 * -> RenderOut. Layout does not introduce new semantic IR; it reuses PromptPart
 * and only reshapes hierarchy so renderers stay pure and predictable.
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

export interface PromptMessage {
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
