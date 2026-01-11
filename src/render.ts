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
  tokenizer?: Tokenizer;
  /** Token budget. Omit for unlimited. */
  budget?: number;
  renderer?: PromptRenderer<unknown>;
  hooks?: RenderHooks;
}

export interface FitStartEvent {
  element: PromptElement;
  budget: number;
  totalTokens: number;
}

export interface FitIterationEvent {
  iteration: number;
  priority: number;
  totalTokens: number;
}

export interface StrategyAppliedEvent {
  target: PromptElement;
  result: PromptElement | null;
  priority: number;
  iteration: number;
}

export interface FitCompleteEvent {
  result: PromptElement | null;
  iterations: number;
  totalTokens: number;
}

export interface FitErrorEvent {
  error: FitError;
  iteration: number;
  priority: number;
  totalTokens: number;
}

export interface RenderHooks {
  onFitStart?: (event: FitStartEvent) => MaybePromise<void>;
  onFitIteration?: (event: FitIterationEvent) => MaybePromise<void>;
  onStrategyApplied?: (event: StrategyAppliedEvent) => MaybePromise<void>;
  onFitComplete?: (event: FitCompleteEvent) => MaybePromise<void>;
  onFitError?: (event: FitErrorEvent) => MaybePromise<void>;
}

type RenderOutput<TOptions extends RenderOptions> = TOptions extends {
  renderer: PromptRenderer<infer TOutput>;
}
  ? TOutput
  : string;

export async function render<TOptions extends RenderOptions>(
  element: MaybePromise<PromptElement>,
  { tokenizer, budget, renderer, hooks }: TOptions
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

  const tokenizerResolution = resolveTokenizer(resolvedElement, tokenizer);
  if (!tokenizerResolution) {
    throw new Error(
      "Token budgeting requires a tokenizer. Provide one to render(), or wrap your prompt in a provider that supplies a tokenizer (e.g. <OpenAIProvider>, <AnthropicProvider>, or <AISDKProvider>). See docs/tokenization.md for details."
    );
  }

  const tokenizerFn = tokenizerResolution.tokenizer;

  const fitted = await fitToBudget(
    resolvedElement,
    budget,
    tokenizerFn,
    resolvedRenderer.tokenString,
    hooks
  );
  if (!fitted) {
    return resolvedRenderer.empty();
  }

  return (await resolvedRenderer.render(fitted)) as RenderOutput<TOptions>;
}

async function safeInvoke<T>(
  handler: ((event: T) => MaybePromise<void>) | undefined,
  event: T
): Promise<void> {
  if (!handler) {
    return;
  }

  await handler(event);
}

interface TokenizerResolution {
  tokenizer: Tokenizer;
  source: "options" | "provider";
  providerName?: string | undefined;
}

function resolveTokenizer(
  element: PromptElement,
  override?: Tokenizer
): TokenizerResolution | null {
  if (override) {
    return { tokenizer: override, source: "options" };
  }

  const providerResolution = findProviderTokenizer(element);
  if (providerResolution) {
    return { ...providerResolution, source: "provider" };
  }

  return null;
}

function findProviderTokenizer(
  element: PromptElement
): Omit<TokenizerResolution, "source"> | null {
  const providerTokenizer = element.context?.provider?.tokenizer;
  if (providerTokenizer) {
    return {
      tokenizer: providerTokenizer,
      providerName: element.context?.provider?.name,
    };
  }

  for (const child of element.children) {
    if (typeof child === "string") {
      continue;
    }
    const found = findProviderTokenizer(child);
    if (found) {
      return found;
    }
  }

  return null;
}

async function fitToBudget(
  element: PromptElement,
  budget: number,
  tokenizer: Tokenizer,
  tokenString: (element: PromptElement) => string,
  hooks: RenderHooks | undefined
): Promise<PromptElement | null> {
  let current: PromptElement | null = element;
  let iteration = 0;
  let totalTokens = tokenizer(tokenString(element));

  await safeInvoke(hooks?.onFitStart, {
    element,
    budget,
    totalTokens,
  });

  while (current && totalTokens > budget) {
    iteration++;

    const lowestImportancePriority = findLowestImportancePriority(current);
    if (lowestImportancePriority === null) {
      const error = new FitError(totalTokens - budget, -1, iteration);
      await safeInvoke(hooks?.onFitError, {
        error,
        iteration,
        priority: -1,
        totalTokens,
      });
      throw error;
    }

    await safeInvoke(hooks?.onFitIteration, {
      iteration,
      priority: lowestImportancePriority,
      totalTokens,
    });

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
      {}, // Start with empty context at the root
      hooks,
      iteration
    );
    current = applied.element;

    const nextTokens = current ? tokenizer(tokenString(current)) : 0;
    if (nextTokens >= totalTokens) {
      const error = new FitError(
        nextTokens - budget,
        lowestImportancePriority,
        iteration
      );
      await safeInvoke(hooks?.onFitError, {
        error,
        iteration,
        priority: lowestImportancePriority,
        totalTokens: nextTokens,
      });
      throw error;
    }

    totalTokens = nextTokens;
  }

  await safeInvoke(hooks?.onFitComplete, {
    result: current,
    iterations: iteration,
    totalTokens,
  });

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
  inheritedContext: CriaContext,
  hooks: RenderHooks | undefined,
  iteration: number
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
      mergedContext,
      hooks,
      iteration
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
    await safeInvoke(hooks?.onStrategyApplied, {
      target: nextElement,
      result: replacement,
      priority,
      iteration,
    });
    return { element: replacement, applied: true };
  }

  return { element: nextElement, applied: childrenChanged };
}
