/**
 * What can be passed as children to a Cria component.
 *
 * Includes all JSX-compatible values: elements, strings, numbers, booleans,
 * null/undefined (ignored), and arrays (flattened). The jsx-runtime normalizes
 * these into `(PromptElement | string)[]` before storing in the element.
 *
 * @example
 * ```tsx
 * <Region>
 *   {"Hello"}
 *   {123}
 *   {items.map(item => <Region>{item}</Region>)}
 * </Region>
 * ```
 */
export type PromptChildren =
  | PromptElement
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly PromptChildren[];

/**
 * The core IR node type. All Cria components return a PromptElement.
 *
 * This is the normalized representation after JSX transformation.
 * The render pipeline traverses this tree to produce fragments for fitting.
 *
 * @property priority - Lower number = higher importance (kept longer during fitting)
 * @property strategy - Optional function to reduce this region when over budget
 * @property id - Optional stable identifier for caching/debugging
 * @property children - Normalized array of child elements and text
 *
 * @example
 * ```tsx
 * // Created via JSX:
 * <Region priority={0}>System prompt</Region>
 *
 * // Produces:
 * { priority: 0, children: ["System prompt"] }
 * ```
 */
export interface PromptElement {
  priority: number;
  strategy?: Strategy;
  id?: string;
  children: (PromptElement | string)[];
}

/**
 * A flattened text fragment produced by the render pipeline.
 *
 * The render step walks the PromptElement tree and emits an ordered list of
 * fragments. The fit loop then applies strategies to reduce token count.
 *
 * @property content - The text content of this fragment
 * @property tokens - Token count (computed via the provided tokenizer)
 * @property priority - Inherited from the emitting element
 * @property regionId - Stable identifier (from element.id or auto-generated)
 * @property strategy - If present, this fragment can be reduced during fitting
 * @property index - Position in the fragment list (for stable ordering)
 */
export interface PromptFragment {
  content: string;
  tokens: number;
  priority: number;
  regionId: string;
  strategy?: Strategy;
  index: number;
}

/**
 * A strategy function that reduces a fragment when the prompt is over budget.
 *
 * Strategies are called during the fit loop, starting with the least important
 * priority (highest number). They receive context about the current state and
 * must return replacement fragments (or empty array to remove entirely).
 *
 * Strategies must be:
 * - **Pure**: Don't mutate the input fragments
 * - **Deterministic**: Same input = same output
 * - **Idempotent**: Applying twice has no additional effect
 *
 * @example
 * ```typescript
 * // A strategy that removes the fragment entirely
 * const omitStrategy: Strategy = () => [];
 *
 * // A strategy that truncates from the end
 * const truncateStrategy: Strategy = ({ target, tokenizer }) => {
 *   let content = target.content.slice(0, 100);
 *   return [{ ...target, content, tokens: tokenizer(content) }];
 * };
 * ```
 */
export type Strategy = (input: StrategyInput) => PromptFragment[];

/**
 * Context passed to strategy functions during the fit loop.
 *
 * @property fragments - All current fragments (readonly, don't mutate)
 * @property target - The specific fragment this strategy should reduce
 * @property budget - The total token budget we're trying to fit within
 * @property tokenizer - Function to count tokens in a string
 * @property totalTokens - Current total token count across all fragments
 * @property iteration - Which iteration of the fit loop (for debugging)
 */
export interface StrategyInput {
  fragments: readonly PromptFragment[];
  target: PromptFragment;
  budget: number;
  tokenizer: Tokenizer;
  totalTokens: number;
  iteration: number;
}

/**
 * A function that counts tokens in a string.
 *
 * Cria doesn't bundle a tokenizer—you provide one. Common choices:
 * - `tiktoken` for OpenAI models (cl100k_base for GPT-4)
 * - Simple approximation: `text => Math.ceil(text.length / 4)`
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
