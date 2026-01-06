import { markdownRenderer } from "./renderers/markdown";
import {
  type CriaContext,
  FitError,
  type MaybePromise,
  type PromptElement,
  type PromptRenderer,
  type StrategyInput,
  type Tokenizer,
} from "./types";

export interface RenderOptions {
  tokenizer: Tokenizer;
  /** Token budget. Omit for unlimited. */
  budget?: number;
  renderer?: PromptRenderer<unknown>;
}

type RenderOutput<TOptions extends RenderOptions> = TOptions extends {
  renderer: PromptRenderer<infer TOutput>;
}
  ? TOutput
  : string;

export async function render<TOptions extends RenderOptions>(
  element: MaybePromise<PromptElement>,
  { tokenizer, budget, renderer }: TOptions
): Promise<RenderOutput<TOptions>> {
  /*
   * The JSX runtime normalizes children and returns either a PromptElement or a
   * native Promise. Render only awaits that root value and does not walk the tree.
   * Non-Promise thenables are intentionally unsupported.
   */
  const resolvedElement = element instanceof Promise ? await element : element;

  const resolvedRenderer = (renderer ?? markdownRenderer) as PromptRenderer<
    RenderOutput<TOptions>
  >;

  // Skip fitting if no budget specified (unlimited)
  if (budget === undefined || budget === null) {
    return (await resolvedRenderer.render(
      resolvedElement
    )) as RenderOutput<TOptions>;
  }

  if (budget <= 0) {
    return resolvedRenderer.empty();
  }

  const fitted = await fitToBudget(
    resolvedElement,
    budget,
    tokenizer,
    resolvedRenderer.tokenString
  );
  if (!fitted) {
    return resolvedRenderer.empty();
  }

  return (await resolvedRenderer.render(fitted)) as RenderOutput<TOptions>;
}

async function fitToBudget(
  element: PromptElement,
  budget: number,
  tokenizer: Tokenizer,
  tokenString: (element: PromptElement) => string
): Promise<PromptElement | null> {
  let current: PromptElement | null = element;
  let iteration = 0;
  let totalTokens = tokenizer(tokenString(element));

  while (current && totalTokens > budget) {
    iteration++;

    const lowestImportancePriority = findLowestImportancePriority(current);
    if (lowestImportancePriority === null) {
      throw new FitError(totalTokens - budget, -1, iteration);
    }

    const baseCtx = {
      budget,
      tokenizer,
      tokenString,
      totalTokens,
      iteration,
    };

    const applied = await applyStrategiesAtPriority(
      current,
      lowestImportancePriority,
      baseCtx,
      {} // Start with empty context at the root
    );
    current = applied.element;

    const nextTokens = current ? tokenizer(tokenString(current)) : 0;
    if (nextTokens >= totalTokens) {
      throw new FitError(
        nextTokens - budget,
        lowestImportancePriority,
        iteration
      );
    }

    totalTokens = nextTokens;
  }

  return current;
}

function findLowestImportancePriority(element: PromptElement): number | null {
  let maxPriority: number | null = element.strategy ? element.priority : null;

  for (const child of element.children) {
    if (typeof child === "string") {
      continue;
    }
    const childMax = findLowestImportancePriority(child);
    maxPriority = maxNullable(maxPriority, childMax);
  }

  return maxPriority;
}

function maxNullable(a: number | null, b: number | null): number | null {
  if (a === null) {
    return b;
  }
  if (b === null) {
    return a;
  }
  return Math.max(a, b);
}

type BaseContext = Omit<StrategyInput, "target" | "context">;

async function applyStrategiesAtPriority(
  element: PromptElement,
  priority: number,
  baseCtx: BaseContext,
  inheritedContext: CriaContext
): Promise<{ element: PromptElement | null; applied: boolean }> {
  // Merge this element's context with inherited context
  // Element context overrides inherited context
  const mergedContext: CriaContext = element.context
    ? { ...inheritedContext, ...element.context }
    : inheritedContext;

  let childrenChanged = false;
  const nextChildren: typeof element.children = [];

  for (const child of element.children) {
    if (typeof child === "string") {
      nextChildren.push(child);
      continue;
    }

    // Pass merged context to children
    const applied = await applyStrategiesAtPriority(
      child,
      priority,
      baseCtx,
      mergedContext
    );
    if (applied.applied) {
      childrenChanged = true;
    }
    if (applied.element) {
      nextChildren.push(applied.element);
    } else {
      childrenChanged = true;
    }
  }

  const nextElement = childrenChanged
    ? ({ ...element, children: nextChildren } as PromptElement)
    : element;

  if (nextElement.strategy && nextElement.priority === priority) {
    const replacement = await nextElement.strategy({
      ...baseCtx,
      target: nextElement,
      context: mergedContext,
    });
    return { element: replacement, applied: true };
  }

  return { element: nextElement, applied: childrenChanged };
}
