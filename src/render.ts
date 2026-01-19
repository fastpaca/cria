import {
  type CriaContext,
  FitError,
  type MaybePromise,
  type ModelProvider,
  type PromptChild,
  type PromptElement,
  type PromptLayout,
  type PromptPart,
  type StrategyInput,
} from "./types";

export interface RenderOptions<TRendered = unknown> {
  // Provider that supplies the renderer.
  provider: ModelProvider<TRendered>;

  // Token budget. Omit for unlimited. If set, the fit loop will be
  // executed to reduce the prompt to the budget.
  budget?: number;

  // Hooks to invoke during the fit loop.
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

export async function render<TRendered>(
  element: MaybePromise<PromptElement>,
  options: RenderOptions<TRendered>
): Promise<TRendered> {
  // Data flow: PromptTree -> PromptLayout (flatten) -> provider.renderer -> provider.countTokens.
  // The fit loop just re-renders and re-counts until we land under budget.
  /*
   * Rendering is budget-agnostic; fitting owns the budget and simply calls
   * rendering to get total tokens. Keep that separation explicit here.
   */
  const resolvedElement = element instanceof Promise ? await element : element;
  const provider = resolveProvider(resolvedElement, options.provider);

  if (options.budget === undefined || options.budget === null) {
    return renderOutput(resolvedElement, provider);
  }

  const fitted = await fitToBudget(
    resolvedElement,
    options.budget,
    provider,
    options.hooks,
    { provider }
  );

  if (!fitted) {
    return renderOutput({ priority: 0, children: [] }, provider);
  }

  return renderOutput(fitted, provider);
}

function renderOutput<TRendered>(
  root: PromptElement,
  provider: ModelProvider<TRendered>
): TRendered {
  // Prompt tree composition is resolved before rendering; renderers only see layout.
  const layout = layoutPrompt(root);
  return provider.renderer.render(layout);
}

function renderAndCount<TRendered>(
  root: PromptElement,
  provider: ModelProvider<TRendered>
): { output: TRendered; tokens: number } {
  // Tree -> layout -> renderer output, then provider-owned token counting.
  const layout = layoutPrompt(root);
  const output = provider.renderer.render(layout);
  const tokens = provider.countTokens(output);
  return { output, tokens };
}

export function assertValidMessageScope(root: PromptElement): void {
  // Enforce layout invariants by reusing the layout pass.
  layoutPrompt(root);
}

function layoutPrompt(root: PromptElement): PromptLayout {
  // Flatten tree to message-bounded layout; hierarchy becomes message -> parts.
  // Traversal order is depth-first, left-to-right so layout is deterministic.
  const messages: PromptLayout["messages"] = [];

  type NonMessageKind = Exclude<PromptElement["kind"], "message" | undefined>;

  const assertPartAllowedInRole = (
    role: PromptLayout["messages"][number]["role"],
    part: PromptPart
  ): void => {
    if (role === "tool") {
      if (part.type !== "tool-result") {
        throw new Error("Tool messages can only contain tool results.");
      }
      return;
    }

    if (part.type === "tool-result") {
      throw new Error("Tool results must be inside a tool message.");
    }

    if (part.type === "tool-call" && role !== "assistant") {
      throw new Error("Tool calls must be inside an assistant message.");
    }

    if (part.type === "reasoning" && role !== "assistant") {
      throw new Error("Reasoning must be inside an assistant message.");
    }
  };

  const assertToolMessageParts = (
    message: PromptLayout["messages"][number]
  ) => {
    if (message.role !== "tool") {
      return;
    }

    if (
      message.parts.length !== 1 ||
      message.parts[0]?.type !== "tool-result"
    ) {
      throw new Error("Tool messages must contain exactly one tool result.");
    }
  };

  const walkChildren = (
    children: PromptChild[],
    current: PromptLayout["messages"][number] | null
  ): void => {
    for (const child of children) {
      walk(child, current);
    }
  };

  const pushPart = (
    current: PromptLayout["messages"][number] | null,
    part: PromptPart
  ): void => {
    if (!current) {
      throw new Error(
        part.type === "text"
          ? "Text nodes must be inside a message."
          : "Semantic nodes must be inside a message."
      );
    }
    assertPartAllowedInRole(current.role, part);
    current.parts.push(part);
  };

  const pushTextPart = (
    current: PromptLayout["messages"][number] | null,
    text: string
  ): void => {
    pushPart(current, { type: "text", text });
  };

  const handleMessageNode = (
    node: PromptElement & { kind: "message" },
    current: PromptLayout["messages"][number] | null
  ): void => {
    if (current) {
      throw new Error("Nested message boundaries are not allowed.");
    }
    const message = { role: node.role, parts: [] as PromptPart[] };
    messages.push(message);
    walkChildren(node.children, message);
    assertToolMessageParts(message);
  };

  const toSemanticPart = (
    node: PromptElement & { kind: NonMessageKind }
  ): PromptPart | null => {
    if (node.children.length > 0) {
      throw new Error("Semantic nodes cannot have children.");
    }

    switch (node.kind) {
      case "tool-call":
        return {
          type: "tool-call",
          toolCallId: node.toolCallId,
          toolName: node.toolName,
          input: node.input,
        };
      case "tool-result":
        return {
          type: "tool-result",
          toolCallId: node.toolCallId,
          toolName: node.toolName,
          output: node.output,
        };
      case "reasoning":
        return node.text.length > 0
          ? { type: "reasoning", text: node.text }
          : null;
      default:
        throw new Error("Unsupported semantic node.");
    }
  };

  const handleSemanticNode = (
    node: PromptElement & { kind: NonMessageKind },
    current: PromptLayout["messages"][number] | null
  ): void => {
    const part = toSemanticPart(node);
    if (part) {
      pushPart(current, part);
    }
  };

  const walk = (
    node: PromptChild,
    current: PromptLayout["messages"][number] | null
  ): void => {
    if (typeof node === "string") {
      pushTextPart(current, node);
      return;
    }

    if (!node.kind) {
      walkChildren(node.children, current);
      return;
    }

    if (node.kind === "message") {
      handleMessageNode(node, current);
      return;
    }

    handleSemanticNode(node, current);
  };

  walk(root, null);

  return { messages };
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

function resolveProvider<TRendered>(
  element: PromptElement,
  override?: ModelProvider<TRendered>
): ModelProvider<TRendered> {
  const providers = collectProviders(element);

  if (override) {
    if (providers.length > 0 && !providers.includes(override)) {
      throw new Error("Render provider does not match provider in the tree.");
    }
    return override;
  }

  if (providers.length === 0) {
    throw new Error("Rendering requires a provider with a renderer.");
  }

  if (providers.length > 1) {
    throw new Error("Multiple providers found in one prompt tree.");
  }

  const provider = providers[0];
  if (!provider) {
    throw new Error("Rendering requires a provider with a renderer.");
  }

  return provider as ModelProvider<TRendered>;
}

function collectProviders(element: PromptElement): ModelProvider<unknown>[] {
  const found: ModelProvider<unknown>[] = [];

  const visit = (node: PromptElement): void => {
    const provider = node.context?.provider;
    if (provider && !found.includes(provider)) {
      found.push(provider);
    }

    for (const child of node.children) {
      if (typeof child !== "string") {
        visit(child);
      }
    }
  };

  visit(element);
  return found;
}

async function fitToBudget<TRendered>(
  element: PromptElement,
  budget: number,
  provider: ModelProvider<TRendered>,
  hooks: RenderHooks | undefined,
  baseContext: CriaContext
): Promise<PromptElement | null> {
  // Fit loop is render-driven: render+count, then apply the lowest-importance
  // strategy, re-render, and repeat until we fit or cannot reduce further.
  let current: PromptElement | null = element;
  let iteration = 0;
  let totalTokens = renderAndCount(element, provider).tokens;

  await safeInvoke(hooks?.onFitStart, {
    element,
    budget,
    totalTokens,
  });

  while (current && totalTokens > budget) {
    iteration += 1;

    const lowestImportancePriority = findLowestImportancePriority(current);
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

    const baseCtx = {
      totalTokens,
      iteration,
    };

    const applied = await applyStrategiesAtPriority(
      current,
      lowestImportancePriority,
      baseCtx,
      baseContext,
      hooks,
      iteration
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

    current = applied.element;

    const nextTokens = current ? renderAndCount(current, provider).tokens : 0;
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
  // Bottom-up: rewrite children first so nested strategies get first crack.
  // Element context overrides inherited context.
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
