import type { ModelProvider } from "./provider";
import {
  type AssistantMessage,
  type CriaContext,
  FitError,
  type MaybePromise,
  type PromptLayout,
  type PromptMessage,
  type PromptMessageNode,
  type PromptNode,
  type PromptPart,
  type PromptScope,
  type PromptTree,
  type ProviderToolIO,
  type StrategyInput,
  type ToolCallPart,
  type ToolResultPart,
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
      messages.push(buildMessage(node));
      return;
    }

    for (const child of node.children) {
      walk(child);
    }
  };

  walk(root);

  return messages;
}

function buildMessage<TToolIO extends ProviderToolIO>(
  node: Extract<PromptNode<TToolIO>, { kind: "message" }>
): PromptMessage<TToolIO> {
  if (node.role === "tool") {
    return buildToolMessage(node.children);
  }

  if (node.role === "assistant") {
    return buildAssistantMessage(node.children);
  }

  return buildTextMessage(node.role, node.children);
}

function buildToolMessage<TToolIO extends ProviderToolIO>(
  children: readonly PromptPart<TToolIO>[]
): PromptMessage<TToolIO> {
  // Tool messages are a single tool result by construction.
  if (children.length !== 1 || children[0]?.type !== "tool-result") {
    throw new Error("Tool messages must contain exactly one tool result.");
  }
  const result = children[0] as ToolResultPart<TToolIO>;
  return {
    role: "tool",
    toolCallId: result.toolCallId,
    toolName: result.toolName,
    output: result.output,
  };
}

function buildAssistantMessage<TToolIO extends ProviderToolIO>(
  children: readonly PromptPart<TToolIO>[]
): AssistantMessage<TToolIO> {
  const { text, reasoning, toolCalls } = collectAssistantParts(children);

  const message: AssistantMessage<TToolIO> = { role: "assistant", text };
  if (reasoning.length > 0) {
    message.reasoning = reasoning;
  }
  if (toolCalls.length > 0) {
    message.toolCalls = toolCalls;
  }
  return message;
}

function collectAssistantParts<TToolIO extends ProviderToolIO>(
  children: readonly PromptPart<TToolIO>[]
): {
  text: string;
  reasoning: string;
  toolCalls: ToolCallPart<TToolIO>[];
} {
  let text = "";
  let reasoning = "";
  const toolCalls: ToolCallPart<TToolIO>[] = [];

  for (const part of children) {
    if (part.type === "text") {
      text += part.text;
      continue;
    }
    if (part.type === "reasoning") {
      reasoning += part.text;
      continue;
    }
    if (part.type === "tool-call") {
      toolCalls.push(part);
      continue;
    }
    if (part.type === "tool-result") {
      // Tool results must live in tool messages, not assistant messages.
      throw new Error("Tool results must be inside a tool message.");
    }
  }

  return { text, reasoning, toolCalls };
}

function buildTextMessage<TToolIO extends ProviderToolIO>(
  role: PromptMessage<TToolIO>["role"],
  children: readonly PromptPart<TToolIO>[]
): PromptMessage<TToolIO> {
  // System/user messages are text-only; other parts are rejected here.
  const text = collectTextParts(children);

  if (role === "system") {
    return { role: "system", text };
  }

  if (role === "developer") {
    return { role: "developer", text };
  }

  if (role === "user") {
    return { role: "user", text };
  }

  throw new Error(`Unsupported message role: ${role}`);
}

function collectTextParts<TToolIO extends ProviderToolIO>(
  children: readonly PromptPart<TToolIO>[]
): string {
  let text = "";
  for (const part of children) {
    if (part.type !== "text") {
      throw new Error(
        "Only assistant messages may contain reasoning or tool calls."
      );
    }
    text += part.text;
  }
  return text;
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
  messageTokens: WeakMap<PromptMessageNode<TToolIO>, number>;
  summaries: WeakMap<PromptNode<TToolIO>, SubtreeSummary<TToolIO>>;
}

const providerMessageTokenCaches = new WeakMap<
  ModelProvider<unknown, ProviderToolIO>,
  WeakMap<PromptMessageNode<ProviderToolIO>, number>
>();

const providerSummaryCaches = new WeakMap<
  ModelProvider<unknown, ProviderToolIO>,
  WeakMap<PromptNode<ProviderToolIO>, SubtreeSummary<ProviderToolIO>>
>();

function getProviderMessageTokenCache<TToolIO extends ProviderToolIO>(
  provider: ModelProvider<unknown, TToolIO>
): WeakMap<PromptMessageNode<TToolIO>, number> {
  const providerKey = provider as ModelProvider<unknown, ProviderToolIO>;
  let cache = providerMessageTokenCaches.get(providerKey);
  if (!cache) {
    cache = new WeakMap<PromptMessageNode<ProviderToolIO>, number>();
    providerMessageTokenCaches.set(providerKey, cache);
  }
  return cache as WeakMap<PromptMessageNode<TToolIO>, number>;
}

function getProviderSummaryCache<TToolIO extends ProviderToolIO>(
  provider: ModelProvider<unknown, TToolIO>
): WeakMap<PromptNode<TToolIO>, SubtreeSummary<TToolIO>> {
  const providerKey = provider as ModelProvider<unknown, ProviderToolIO>;
  let cache = providerSummaryCaches.get(providerKey);
  if (!cache) {
    cache = new WeakMap<
      PromptNode<ProviderToolIO>,
      SubtreeSummary<ProviderToolIO>
    >();
    providerSummaryCaches.set(providerKey, cache);
  }
  return cache as WeakMap<PromptNode<TToolIO>, SubtreeSummary<TToolIO>>;
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
    const message = buildMessage(node);
    const cachedTokens = caches.messageTokens.get(node);
    const tokens =
      cachedTokens === undefined
        ? provider.countMessageTokens(message)
        : cachedTokens;
    if (cachedTokens === undefined) {
      caches.messageTokens.set(node, tokens);
    }
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
    messageTokens: getProviderMessageTokenCache(provider),
    summaries: getProviderSummaryCache(provider),
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

  // Bottom-up: rewrite children first so nested strategies get first crack.
  // Element context overrides inherited context.
  const mergedContext: CriaContext = element.context
    ? { ...inheritedContext, ...element.context }
    : inheritedContext;

  let childrenChanged = false;
  let applied = false;
  const nextChildren: PromptNode<TToolIO>[] = [];
  let totalTokens = 0;
  let messageCount = 0;
  let firstMessage: PromptMessage<TToolIO> | null = null;
  let lastMessage: PromptMessage<TToolIO> | null = null;
  let previousLast: PromptMessage<TToolIO> | null = null;
  let maxPriority: number | null = element.strategy ? element.priority : null;

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

    maxPriority = maxNullable(maxPriority, childResult.summary.maxPriority);
    if (childResult.summary.messageCount === 0) {
      continue;
    }

    totalTokens += childResult.summary.totalTokens;
    if (previousLast && childResult.summary.firstMessage) {
      totalTokens += provider.countBoundaryTokens(
        previousLast,
        childResult.summary.firstMessage
      );
    }

    previousLast = childResult.summary.lastMessage;
    if (!firstMessage) {
      firstMessage = childResult.summary.firstMessage;
    }
    lastMessage = childResult.summary.lastMessage;
    messageCount += childResult.summary.messageCount;
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
    totalTokens,
    messageCount,
    firstMessage,
    lastMessage,
    maxPriority,
  };
  caches.summaries.set(nextElement, summary);

  return { element: nextElement, applied: applied || childrenChanged, summary };
}
