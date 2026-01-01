/**
 * Message role used by semantic `kind: "message"` regions.
 *
 * This is intentionally compatible with common LLM SDKs (system/user/assistant/tool),
 * while still allowing custom roles for bespoke targets.
 */
export type PromptRole =
  | "system"
  | "user"
  | "assistant"
  | "tool"
  | (string & {});

/**
 * Semantic variants for a region node.
 *
 * Cria’s IR is “Regions all the way down” (like a DOM tree). `PromptKind` is how we
 * recognize certain regions as prompt parts so renderers can emit structured
 * targets without parsing strings.
 */
export type PromptKind =
  | { kind?: undefined }
  | { kind: "message"; role: PromptRole }
  | {
      kind: "tool-call";
      toolCallId: string;
      toolName: string;
      input: unknown;
    }
  | {
      kind: "tool-result";
      toolCallId: string;
      toolName: string;
      output: unknown;
    }
  | { kind: "reasoning"; text: string };

export type PromptNodeKind = PromptKind["kind"];

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
 * The core IR node type. All Cria components return a `PromptElement`.
 *
 * **Everything is a Region** (think: a DOM `<div>`): `priority`, `strategy`, and
 * `children` make up the structural prompt tree.
 *
 * If you attach a semantic `kind` (via `PromptKind`), the node becomes a recognized
 * prompt part (message/tool-call/tool-result/reasoning) and renderers can emit
 * structured targets without parsing strings.
 */
export type PromptElement = {
  /**
   * Lower number = higher importance.
   *
   * Fitting starts reducing from the highest priority number (least important).
   */
  priority: number;

  /**
   * Strategy used during fitting to shrink this region.
   *
   * Strategies are tree-aware and may rewrite the subtree rooted at this element.
   *
   * If not provided, the region will never be reduced.
   */
  strategy?: Strategy;

  /** Optional stable identifier for caching/debugging. */
  id?: string;

  /** Canonical normalized children stored in the IR. */
  children: PromptChildren;
} & PromptKind;

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
 * This is the only type you’ll find inside `PromptElement.children` after JSX normalization.
 */
export type PromptChild = PromptElement | string;

/**
 * Canonical normalized children list stored on `PromptElement.children`.
 */
export type PromptChildren = PromptChild[];

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
 */
export interface StrategyInput {
  target: PromptElement;
  budget: number;
  tokenizer: Tokenizer;
  tokenString: (element: PromptElement) => string;
  totalTokens: number;
  iteration: number;
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
