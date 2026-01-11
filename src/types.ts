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
 * A message in a completion request.
 */
export interface CompletionMessage {
  role: PromptRole;
  content: string;
}

/**
 * Request parameters for a completion.
 */
export interface CompletionRequest {
  /** Messages to send to the model */
  messages: CompletionMessage[];
  /** Optional system prompt (some providers handle this separately) */
  system?: string;
}

/**
 * Result from a completion request.
 */
export interface CompletionResult {
  /** The generated text response */
  text: string;
}

/**
 * A model provider that can generate completions.
 *
 * This abstraction allows Cria components to call AI models without
 * being coupled to a specific SDK.
 */
export interface ModelProvider {
  /** Provider identifier for debugging */
  name: string;
  /**
   * Tokenizer for this provider's model.
   *
   * Used for budget fitting when the caller doesn't pass a tokenizer directly.
   * Providers should supply an estimate that matches the chosen model; callers
   * can still override via render options.
   */
  tokenizer?: Tokenizer;

  /**
   * Generate a completion from the model.
   */
  completion(request: CompletionRequest): MaybePromise<CompletionResult>;
}

/**
 * Context that can be provided through the component tree.
 *
 * Provider components (like `<AISDKProvider>`) inject context that
 * child components can access during rendering and strategy execution.
 */
export interface CriaContext {
  /** Model provider for AI-powered operations */
  provider?: ModelProvider | undefined;
}

// Convenience type for functions that can return a promise or a value.
export type MaybePromise<T> = T | Promise<T>;

/**
 * A function that counts tokens in a string.
 * Cria doesn't bundle a tokenizer. You provide one.
 *
 * @example
 * ```typescript
 * import { encoding_for_model } from "tiktoken";
 *
 * const enc = encoding_for_model("gpt-4");
 * const tokenizer: Tokenizer = (text) => enc.encode(text).length;
 * ```
 */
export type Tokenizer = (text: string) => number;

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
 * A renderer that converts a fitted prompt tree into an output format.
 *
 * Renderers are used for two things:
 * - **Token accounting / fitting** via `tokenString` (a stable string projection)
 * - **Final output** via `render` (can be async, and can produce any type)
 *
 * @template TOutput - The produced output type (e.g. `string`, `ModelMessage[]`, etc.).
 */
export interface PromptRenderer<TOutput> {
  /** A short identifier for debugging/observability. */
  name: string;

  /**
   * A deterministic string projection of the prompt tree used for token counting.
   *
   * Important properties:
   * - **Pure / deterministic**: same tree => same string
   * - **Cheap**: called frequently during fitting
   * - **Representative**: should correlate with what `render()` produces (especially for string targets)
   *
   * For structured targets (e.g. AI SDK messages), this can be a markdown-ish projection
   * that approximates the effective prompt content for token budgeting.
   */
  tokenString: (element: PromptElement) => string;

  /**
   * Render the fitted prompt tree to the target output.
   *
   * May be async (e.g. when a renderer needs to fetch/resolve attachments, or when
   * strategies summarized content during fitting).
   */
  render: (element: PromptElement) => MaybePromise<TOutput>;

  /**
   * The “empty” value for this renderer.
   *
   * Used when the budget is <= 0, or when strategies remove the entire tree.
   */
  empty: () => TOutput;
}

/**
 * Canonical normalized child node type stored in the IR.
 *
 * This is the only type you’ll find inside `PromptElement.children` after child normalization.
 */
export type JsonValue =
  | null
  | string
  | number
  | boolean
  | JsonValue[]
  | { [key: string]: JsonValue };

export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.string(),
    z.number(),
    z.boolean(),
    z.array(JsonValueSchema),
    z.record(JsonValueSchema),
  ])
);

export type StrategyResult = PromptElement | null;

/**
 * Context passed to strategy functions during the fit loop.
 *
 * @property target - The specific region to reduce
 * @property budget - The total token budget we're trying to fit within
 * @property tokenizer - Function to count tokens in a string
 * @property tokenString - Renderer-provided projection used for token counting
 * @property totalTokens - Current total token count for the prompt
 * @property iteration - Which iteration of the fit loop (for debugging)
 * @property context - Inherited context from ancestor provider components
 */
export interface StrategyInput {
  target: PromptElement;
  budget: number;
  tokenizer: Tokenizer;
  tokenString: (element: PromptElement) => string;
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

  constructor(overBudgetBy: number, priority: number, iteration: number) {
    super(
      `Cannot fit prompt: ${overBudgetBy} tokens over budget at priority ${priority} (iteration ${iteration})`
    );
    this.name = "FitError";
    this.overBudgetBy = overBudgetBy;
    this.priority = priority;
    this.iteration = iteration;
  }
}
