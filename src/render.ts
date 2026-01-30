import { buildMessageFromNode } from "./message";
import type { ModelProvider } from "./provider";
import {
  type CriaContext,
  FitError,
  type MaybePromise,
  type PromptLayout,
  type PromptMessage,
  type PromptNode,
  type PromptScope,
  type PromptTree,
  type ProviderToolIO,
  type StrategyInput,
} from "./types";

/**
 * Render pipeline:
 * - PromptTree carries provider-bound tool IO types.
 * - layoutPrompt flattens the tree into a PromptLayout and enforces invariants.
 * - The provider's codec translates that layout into the provider payload.
 * - Token counting is provider-owned and derived from layout messages + boundaries.
 */
export interface RenderOptions<
  TRendered = unknown,
  TToolIO extends ProviderToolIO = ProviderToolIO,
> {
  // Provider that supplies the codec.
  provider: ModelProvider<TRendered, TToolIO>;

  // Token budget. Omit for unlimited. If set, the fit loop will be
  // executed to reduce the prompt to the budget.
  budget?: number;

  // Hooks to invoke during the fit loop.
  hooks?: RenderHooks<TToolIO>;
}

export interface FitStartEvent<
  TToolIO extends ProviderToolIO = ProviderToolIO,
> {
  element: PromptTree<TToolIO>;
  budget: number;
  totalTokens: number;
}

export interface FitIterationEvent {
  iteration: number;
  priority: number;
  totalTokens: number;
}

export interface StrategyAppliedEvent<
  TToolIO extends ProviderToolIO = ProviderToolIO,
> {
  target: PromptScope<TToolIO>;
  result: PromptScope<TToolIO> | null;
  priority: number;
  iteration: number;
}

export interface FitCompleteEvent<
  TToolIO extends ProviderToolIO = ProviderToolIO,
> {
  result: PromptScope<TToolIO> | null;
  iterations: number;
  totalTokens: number;
}

export interface FitErrorEvent {
  error: FitError;
  iteration: number;
  priority: number;
  totalTokens: number;
}

export interface RenderHooks<TToolIO extends ProviderToolIO = ProviderToolIO> {
  onFitStart?: (event: FitStartEvent<TToolIO>) => MaybePromise<void>;
  onFitIteration?: (event: FitIterationEvent) => MaybePromise<void>;
  onStrategyApplied?: (
    event: StrategyAppliedEvent<TToolIO>
  ) => MaybePromise<void>;
  onFitComplete?: (event: FitCompleteEvent<TToolIO>) => MaybePromise<void>;
  onFitError?: (event: FitErrorEvent) => MaybePromise<void>;
}

export async function render<TRendered, TToolIO extends ProviderToolIO>(
  element: MaybePromise<PromptTree<TToolIO>>,
  options: RenderOptions<TRendered, TToolIO>
): Promise<TRendered> {
  // Data flow: PromptTree -> PromptLayout (flatten) -> provider.codec.
  // The fit loop uses message-level token summaries and renders only once.
  /*
   * Rendering is budget-agnostic; fitting owns the budget and simply calls
   * rendering to get total tokens. Keep that separation explicit here.
   */
  const resolvedElement = element instanceof Promise ? await element : element;
  const provider = resolveProvider(resolvedElement, options.provider);

  if (options.budget === undefined || options.budget === null) {
    return renderOutput(resolvedElement, provider);
  }

  const fitResult = await fitToBudget(
    resolvedElement,
    options.budget,
    provider,
    options.hooks,
    { provider }
  );

  return fitResult.output;
}

function renderOutput<TRendered, TToolIO extends ProviderToolIO>(
  root: PromptTree<TToolIO>,
  provider: ModelProvider<TRendered, TToolIO>
): TRendered {
  // Prompt tree composition is resolved before rendering; codecs only see layout.
  const layout = layoutPrompt(root);
  return provider.codec.render(layout);
}

export function assertValidMessageScope<
  TToolIO extends ProviderToolIO = ProviderToolIO,
>(root: PromptTree<TToolIO>): void {
  // Enforce layout invariants by reusing the layout pass.
  layoutPrompt(root);
}

function layoutPrompt<TToolIO extends ProviderToolIO>(
  root: PromptTree<TToolIO>
): PromptLayout<TToolIO> {
  // Flatten tree to a list of opinionated messages.
  // Traversal order is depth-first, left-to-right so layout is deterministic.
  // This is the only place we validate message/part structure.
  const messages: PromptMessage<TToolIO>[] = [];

  const walk = (node: PromptNode<TToolIO>): void => {
    if (node.kind === "message") {
      messages.push(buildMessageFromNode(node));
      return;
    }

    for (const child of node.children) {
      walk(child);
    }
  };

  walk(root);

  return messages;
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

function resolveProvider<TRendered, TToolIO extends ProviderToolIO>(
  element: PromptTree<TToolIO>,
  override?: ModelProvider<TRendered, TToolIO>
): ModelProvider<TRendered, TToolIO> {
  // Provider may come from the tree (provider scopes) or from render options.
  // Either way, it must be a single consistent provider for the entire tree.
  const providers = collectProviders(element);

  if (override) {
    if (providers.length > 0 && !providers.includes(override)) {
      throw new Error("Render provider does not match provider in the tree.");
    }
    return override;
  }

  if (providers.length === 0) {
    throw new Error("Rendering requires a provider with a codec.");
  }

  if (providers.length > 1) {
    throw new Error("Multiple providers found in one prompt tree.");
  }

  const provider = providers[0];
  if (!provider) {
    throw new Error("Rendering requires a provider with a codec.");
  }

  return provider as ModelProvider<TRendered, TToolIO>;
}

function collectProviders<TToolIO extends ProviderToolIO>(
  element: PromptNode<TToolIO>
): ModelProvider<unknown, ProviderToolIO>[] {
  // Walk scopes and collect unique providers from context.
  const found: ModelProvider<unknown, ProviderToolIO>[] = [];

  const visit = (node: PromptNode<TToolIO>): void => {
    if (node.kind === "message") {
      return;
    }

    const provider = node.context?.provider;
    if (provider && !found.includes(provider)) {
      found.push(provider);
    }

    for (const child of node.children) {
      visit(child);
    }
  };

  visit(element);
  return found;
}

interface FitResult<TRendered, TToolIO extends ProviderToolIO> {
  scope: PromptScope<TToolIO> | null;
  output: TRendered;
  totalTokens: number;
  iterations: number;
}

interface SubtreeSummary<TToolIO extends ProviderToolIO> {
  totalTokens: number;
  messageCount: number;
  firstMessage: PromptMessage<TToolIO> | null;
  lastMessage: PromptMessage<TToolIO> | null;
  maxPriority: number | null;
}

interface FitTokenCaches<TToolIO extends ProviderToolIO> {
  summaries: WeakMap<PromptNode<TToolIO>, SubtreeSummary<TToolIO>>;
}

function summarizeNode<TToolIO extends ProviderToolIO>(
  node: PromptNode<TToolIO>,
  provider: ModelProvider<unknown, TToolIO>,
  caches: FitTokenCaches<TToolIO>
): SubtreeSummary<TToolIO> {
  const cached = caches.summaries.get(node);
  if (cached) {
    return cached;
  }

  if (node.kind === "message") {
    const message = buildMessageFromNode(node);
    const tokens = node.tokenCount ?? provider.countMessageTokens(message);
    const summary: SubtreeSummary<TToolIO> = {
      totalTokens: tokens,
      messageCount: 1,
      firstMessage: message,
      lastMessage: message,
      maxPriority: null,
    };
    caches.summaries.set(node, summary);
    return summary;
  }

  let totalTokens = 0;
  let messageCount = 0;
  let firstMessage: PromptMessage<TToolIO> | null = null;
  let lastMessage: PromptMessage<TToolIO> | null = null;
  let previousLast: PromptMessage<TToolIO> | null = null;
  let maxPriority: number | null = node.strategy ? node.priority : null;

  for (const child of node.children) {
    const childSummary = summarizeNode(child, provider, caches);
    maxPriority = maxNullable(maxPriority, childSummary.maxPriority);
    if (childSummary.messageCount === 0) {
      continue;
    }

    totalTokens += childSummary.totalTokens;
    if (previousLast && childSummary.firstMessage) {
      totalTokens += provider.countBoundaryTokens(
        previousLast,
        childSummary.firstMessage
      );
    }

    previousLast = childSummary.lastMessage;
    if (!firstMessage) {
      firstMessage = childSummary.firstMessage;
    }
    lastMessage = childSummary.lastMessage;
    messageCount += childSummary.messageCount;
  }

  const summary: SubtreeSummary<TToolIO> = {
    totalTokens,
    messageCount,
    firstMessage,
    lastMessage,
    maxPriority,
  };
  caches.summaries.set(node, summary);
  return summary;
}

async function fitToBudget<TRendered, TToolIO extends ProviderToolIO>(
  element: PromptTree<TToolIO>,
  budget: number,
  provider: ModelProvider<TRendered, TToolIO>,
  hooks: RenderHooks<TToolIO> | undefined,
  baseContext: CriaContext
): Promise<FitResult<TRendered, TToolIO>> {
  // Fit loop is summary-driven: apply the lowest-importance strategy, update
  // summary tokens, and repeat until we fit or cannot reduce further.
  let current: PromptScope<TToolIO> | null = element;
  let iteration = 0;
  const caches: FitTokenCaches<TToolIO> = {
    summaries: new WeakMap<PromptNode<TToolIO>, SubtreeSummary<TToolIO>>(),
  };
  let currentSummary = summarizeNode(current, provider, caches);
  let totalTokens = currentSummary.totalTokens;

  await safeInvoke(hooks?.onFitStart, {
    element,
    budget,
    totalTokens,
  });

  while (current && totalTokens > budget) {
    iteration += 1;

    const lowestImportancePriority = currentSummary.maxPriority;
    if (lowestImportancePriority === null) {
      const error = new FitError({
        overBudgetBy: totalTokens - budget,
        priority: -1,
        iteration,
        budget,
        totalTokens,
      });
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

    const baseCtx: BaseContext<TToolIO> = {
      totalTokens,
      iteration,
    };

    const applied = await applyStrategiesAtPriority(
      current,
      lowestImportancePriority,
      baseCtx,
      baseContext,
      hooks,
      iteration,
      provider,
      caches
    );

    if (!applied.applied) {
      const error = new FitError({
        overBudgetBy: totalTokens - budget,
        priority: lowestImportancePriority,
        iteration,
        budget,
        totalTokens,
      });
      await safeInvoke(hooks?.onFitError, {
        error,
        iteration,
        priority: lowestImportancePriority,
        totalTokens,
      });
      throw error;
    }

    if (applied.element && applied.element.kind !== "scope") {
      throw new Error("Root scope was replaced by a message node.");
    }
    current = applied.element;

    const nextSummary = applied.summary;
    const nextTokens = nextSummary.totalTokens;
    if (nextTokens >= totalTokens) {
      const error = new FitError({
        overBudgetBy: nextTokens - budget,
        priority: lowestImportancePriority,
        iteration,
        budget,
        totalTokens: nextTokens,
      });
      await safeInvoke(hooks?.onFitError, {
        error,
        iteration,
        priority: lowestImportancePriority,
        totalTokens: nextTokens,
      });
      throw error;
    }

    totalTokens = nextTokens;
    currentSummary = nextSummary;
  }

  const finalScope: PromptScope<TToolIO> = current ?? {
    kind: "scope",
    priority: 0,
    children: [],
  };
  const output = renderOutput(finalScope, provider);

  await safeInvoke(hooks?.onFitComplete, {
    result: current,
    iterations: iteration,
    totalTokens: currentSummary.totalTokens,
  });

  return {
    scope: current,
    output,
    totalTokens: currentSummary.totalTokens,
    iterations: iteration,
  };
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

type BaseContext<TToolIO extends ProviderToolIO> = Omit<
  StrategyInput<TToolIO>,
  "target" | "context"
>;

interface SummaryAccumulator<TToolIO extends ProviderToolIO> {
  totalTokens: number;
  messageCount: number;
  firstMessage: PromptMessage<TToolIO> | null;
  lastMessage: PromptMessage<TToolIO> | null;
  previousLast: PromptMessage<TToolIO> | null;
  maxPriority: number | null;
}

function mergeChildSummary<TToolIO extends ProviderToolIO>(
  acc: SummaryAccumulator<TToolIO>,
  child: SubtreeSummary<TToolIO>,
  provider: ModelProvider<unknown, TToolIO>
): void {
  acc.maxPriority = maxNullable(acc.maxPriority, child.maxPriority);
  if (child.messageCount === 0) {
    return;
  }

  acc.totalTokens += child.totalTokens;
  if (acc.previousLast && child.firstMessage) {
    acc.totalTokens += provider.countBoundaryTokens(
      acc.previousLast,
      child.firstMessage
    );
  }

  acc.previousLast = child.lastMessage;
  if (!acc.firstMessage) {
    acc.firstMessage = child.firstMessage;
  }
  acc.lastMessage = child.lastMessage;
  acc.messageCount += child.messageCount;
}

async function applyStrategiesAtPriority<TToolIO extends ProviderToolIO>(
  element: PromptNode<TToolIO>,
  priority: number,
  baseCtx: BaseContext<TToolIO>,
  inheritedContext: CriaContext,
  hooks: RenderHooks<TToolIO> | undefined,
  iteration: number,
  provider: ModelProvider<unknown, TToolIO>,
  caches: FitTokenCaches<TToolIO>
): Promise<{
  element: PromptNode<TToolIO> | null;
  applied: boolean;
  summary: SubtreeSummary<TToolIO>;
}> {
  if (element.kind === "message") {
    return {
      element,
      applied: false,
      summary: summarizeNode(element, provider, caches),
    };
  }

  const existingSummary = summarizeNode(element, provider, caches);
  if (
    existingSummary.maxPriority === null ||
    existingSummary.maxPriority < priority
  ) {
    return {
      element,
      applied: false,
      summary: existingSummary,
    };
  }

  // Bottom-up: rewrite children first so nested strategies get first crack.
  // Element context overrides inherited context.
  const mergedContext: CriaContext = element.context
    ? { ...inheritedContext, ...element.context }
    : inheritedContext;

  let childrenChanged = false;
  let applied = false;
  const nextChildren: PromptNode<TToolIO>[] = [];
  const summaryState: SummaryAccumulator<TToolIO> = {
    totalTokens: 0,
    messageCount: 0,
    firstMessage: null,
    lastMessage: null,
    previousLast: null,
    maxPriority: element.strategy ? element.priority : null,
  };

  for (const child of element.children) {
    const childResult = await applyStrategiesAtPriority(
      child,
      priority,
      baseCtx,
      mergedContext,
      hooks,
      iteration,
      provider,
      caches
    );
    if (childResult.applied) {
      childrenChanged = true;
      applied = true;
    }
    if (childResult.element) {
      nextChildren.push(childResult.element);
    } else {
      childrenChanged = true;
    }

    mergeChildSummary(summaryState, childResult.summary, provider);
  }

  const nextElement = childrenChanged
    ? ({ ...element, children: nextChildren } as PromptScope<TToolIO>)
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
    if (!replacement) {
      return {
        element: null,
        applied: true,
        summary: {
          totalTokens: 0,
          messageCount: 0,
          firstMessage: null,
          lastMessage: null,
          maxPriority: null,
        },
      };
    }

    return {
      element: replacement,
      applied: true,
      summary: summarizeNode(replacement, provider, caches),
    };
  }

  const summary: SubtreeSummary<TToolIO> = {
    totalTokens: summaryState.totalTokens,
    messageCount: summaryState.messageCount,
    firstMessage: summaryState.firstMessage,
    lastMessage: summaryState.lastMessage,
    maxPriority: summaryState.maxPriority,
  };
  caches.summaries.set(nextElement, summary);

  return { element: nextElement, applied: applied || childrenChanged, summary };
}
