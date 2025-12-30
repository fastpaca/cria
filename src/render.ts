import {
  FitError,
  type PromptElement,
  type PromptFragment,
  type Strategy,
  type StrategyInput,
  type Tokenizer,
} from "./types";

/** Options for the render function. */
interface RenderOptions {
  /** Function to count tokens in a string (e.g., tiktoken) */
  tokenizer: Tokenizer;
  /** Maximum token count for the final output */
  budget: number;
}

/**
 * Renders a PromptElement tree to a fitted string.
 *
 * This is the main entry point for Cria. Takes a JSX tree and returns a string
 * that fits within the specified token budget.
 *
 * **Pipeline:**
 * 1. `flatten`: Walks the tree, collects text into ordered PromptFragment[]
 * 2. `fitToBudget`: Applies strategies starting from lowest priority until under budget
 * 3. `join`: Concatenates fragment content into final string
 *
 * @param element - The root PromptElement (from JSX)
 * @param options - Tokenizer and budget configuration
 * @returns The fitted prompt string
 * @throws {FitError} When the prompt cannot fit within budget
 *
 * @example
 * ```tsx
 * import { render, Region, Omit } from "cria";
 *
 * const prompt = (
 *   <Region priority={0}>
 *     System prompt
 *     <Omit priority={2}>Optional context</Omit>
 *   </Region>
 * );
 *
 * const result = render(prompt, {
 *   tokenizer: (text) => Math.ceil(text.length / 4),
 *   budget: 1000,
 * });
 * ```
 */
export function render(
  element: PromptElement,
  { tokenizer, budget }: RenderOptions
): string {
  if (budget <= 0) {
    return "";
  }

  const fragments = flatten(element, tokenizer, { counter: 0 });
  const fitted = fitToBudget(fragments, budget, tokenizer);
  return fitted.map((f) => f.content).join("");
}

/**
 * Turns a PromptElement tree into an ordered list of PromptFragment.
 *
 * - Preserves text order (flush text buffer before descending into child elements).
 * - Inherits priority/strategy from the emitting element.
 * - Assigns regionId: explicit id if provided, else auto-incrementing counter.
 * - Computes token counts with the provided tokenizer.
 */
function flatten(
  element: PromptElement,
  tokenizer: Tokenizer,
  ctx: { counter: number },
  fragments: PromptFragment[] = []
): PromptFragment[] {
  let buffer = "";

  const flushBuffer = () => {
    if (buffer.length === 0) {
      return;
    }
    const tokens = tokenizer(buffer);
    if (tokens > 0) {
      const fragment: PromptFragment = {
        content: buffer,
        tokens,
        priority: element.priority,
        regionId: element.id ?? `r${ctx.counter++}`,
        index: fragments.length,
      };
      if (element.strategy) {
        fragment.strategy = element.strategy;
      }
      fragments.push(fragment);
    }
    buffer = "";
  };

  for (const child of element.children) {
    if (!child) {
      continue;
    }

    if (typeof child === "string") {
      buffer += child;
    } else {
      // Flush current text before descending to maintain order
      flushBuffer();
      flatten(child, tokenizer, ctx, fragments);
    }
  }

  // Flush any trailing text
  flushBuffer();

  return fragments;
}

/**
 * Finds the highest priority number (least important) among fragments with strategies.
 */
function findLowestImportancePriority(
  fragments: PromptFragment[]
): number | null {
  const priorities = fragments
    .filter((f) => f.strategy !== undefined)
    .map((f) => f.priority);

  if (priorities.length === 0) {
    return null;
  }

  return Math.max(...priorities);
}

/**
 * Applies a single strategy to its target fragment.
 * Splices replacements in-place and recomputes token counts.
 */
function applyStrategy(
  result: PromptFragment[],
  target: PromptFragment,
  budget: number,
  tokenizer: Tokenizer,
  iteration: number
): void {
  const strategy = target.strategy as Strategy;
  const targetIndex = result.findIndex((f) => f.regionId === target.regionId);

  if (targetIndex === -1) {
    return;
  }

  const currentTarget = result[targetIndex];
  if (!currentTarget) {
    return;
  }

  const input: StrategyInput = {
    fragments: result,
    target: currentTarget,
    budget,
    tokenizer,
    totalTokens: result.reduce((sum, f) => sum + f.tokens, 0),
    iteration,
  };

  const replacement = strategy(input);

  // Splice replacement at target position
  result.splice(targetIndex, 1, ...replacement);

  // Recompute tokens for modified fragments
  for (const frag of replacement) {
    frag.tokens = tokenizer(frag.content);
  }
}

/**
 * Repeatedly applies strategies starting from the least-important priority
 * until the total token count is within budget.
 *
 * Throws FitError if:
 * - No progress is made in an iteration (strategies didn't reduce tokens)
 * - No strategies remain but still over budget
 */
function fitToBudget(
  fragments: PromptFragment[],
  budget: number,
  tokenizer: Tokenizer
): PromptFragment[] {
  const result = [...fragments];
  let iteration = 0;
  const maxIterations = 1000;

  while (true) {
    const totalTokens = result.reduce((sum, f) => sum + f.tokens, 0);

    if (totalTokens <= budget) {
      return result;
    }

    iteration++;
    if (iteration > maxIterations) {
      throw new FitError(totalTokens - budget, -1, iteration);
    }

    const lowestImportancePriority = findLowestImportancePriority(result);
    if (lowestImportancePriority === null) {
      throw new FitError(totalTokens - budget, -1, iteration);
    }

    // Collect all targets at this priority
    const targets = result.filter(
      (f) => f.strategy !== undefined && f.priority === lowestImportancePriority
    );

    const tokensBefore = totalTokens;

    // Apply strategies in stable order
    for (const target of targets) {
      applyStrategy(result, target, budget, tokenizer, iteration);
    }

    // Check progress
    const tokensAfter = result.reduce((sum, f) => sum + f.tokens, 0);
    if (tokensAfter >= tokensBefore) {
      throw new FitError(
        tokensAfter - budget,
        lowestImportancePriority,
        iteration
      );
    }
  }
}
