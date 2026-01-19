import {
  type AssistantMessage,
  type CriaContext,
  FitError,
  type MaybePromise,
  type ModelProvider,
  type PromptLayout,
  type PromptMessage,
  type PromptNode,
  type PromptPart,
  type PromptScope,
  type PromptTree,
  type StrategyInput,
  type ToolCallPart,
  type ToolResultPart,
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
  element: PromptTree;
  budget: number;
  totalTokens: number;
}

export interface FitIterationEvent {
  iteration: number;
  priority: number;
  totalTokens: number;
}

export interface StrategyAppliedEvent {
  target: PromptScope;
  result: PromptScope | null;
  priority: number;
  iteration: number;
}

export interface FitCompleteEvent {
  result: PromptScope | null;
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
  element: MaybePromise<PromptTree>,
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
    return renderOutput({ kind: "scope", priority: 0, children: [] }, provider);
  }

  return renderOutput(fitted, provider);
}

function renderOutput<TRendered>(
  root: PromptTree,
  provider: ModelProvider<TRendered>
): TRendered {
  // Prompt tree composition is resolved before rendering; renderers only see layout.
  const layout = layoutPrompt(root);
  return provider.renderer.render(layout);
}

function renderAndCount<TRendered>(
  root: PromptTree,
  provider: ModelProvider<TRendered>
): { output: TRendered; tokens: number } {
  // Tree -> layout -> renderer output, then provider-owned token counting.
  const layout = layoutPrompt(root);
  const output = provider.renderer.render(layout);
  const tokens = provider.countTokens(output);
  return { output, tokens };
}

export function assertValidMessageScope(root: PromptTree): void {
  // Enforce layout invariants by reusing the layout pass.
  layoutPrompt(root);
}

function layoutPrompt(root: PromptTree): PromptLayout {
  // Flatten tree to a list of opinionated messages.
  // Traversal order is depth-first, left-to-right so layout is deterministic.
  const messages: PromptMessage[] = [];

  const walk = (node: PromptNode): void => {
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

function buildMessage(
  node: Extract<PromptNode, { kind: "message" }>
): PromptMessage {
  if (node.role === "tool") {
    return buildToolMessage(node.children);
  }

  if (node.role === "assistant") {
    return buildAssistantMessage(node.children);
  }

  return buildTextMessage(node.role, node.children);
}

function buildToolMessage(children: readonly PromptPart[]): PromptMessage {
  if (children.length !== 1 || children[0]?.type !== "tool-result") {
    throw new Error("Tool messages must contain exactly one tool result.");
  }
  const result = children[0] as ToolResultPart;
  return {
    role: "tool",
    toolCallId: result.toolCallId,
    toolName: result.toolName,
    output: result.output,
  };
}

function buildAssistantMessage(
  children: readonly PromptPart[]
): AssistantMessage {
  const { text, reasoning, toolCalls } = collectAssistantParts(children);

  const message: AssistantMessage = { role: "assistant", text };
  if (reasoning.length > 0) {
    message.reasoning = reasoning;
  }
  if (toolCalls.length > 0) {
    message.toolCalls = toolCalls;
  }
  return message;
}

function collectAssistantParts(children: readonly PromptPart[]): {
  text: string;
  reasoning: string;
  toolCalls: ToolCallPart[];
} {
  let text = "";
  let reasoning = "";
  const toolCalls: ToolCallPart[] = [];

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
      throw new Error("Tool results must be inside a tool message.");
    }
  }

  return { text, reasoning, toolCalls };
}

function buildTextMessage(
  role: PromptMessage["role"],
  children: readonly PromptPart[]
): PromptMessage {
  const text = collectTextParts(children);

  if (role === "system") {
    return { role: "system", text };
  }

  if (role === "user") {
    return { role: "user", text };
  }

  throw new Error(`Unsupported message role: ${role}`);
}

function collectTextParts(children: readonly PromptPart[]): string {
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

function resolveProvider<TRendered>(
  element: PromptTree,
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

function collectProviders(element: PromptNode): ModelProvider<unknown>[] {
  const found: ModelProvider<unknown>[] = [];

  const visit = (node: PromptNode): void => {
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

async function fitToBudget<TRendered>(
  element: PromptTree,
  budget: number,
  provider: ModelProvider<TRendered>,
  hooks: RenderHooks | undefined,
  baseContext: CriaContext
): Promise<PromptScope | null> {
  // Fit loop is render-driven: render+count, then apply the lowest-importance
  // strategy, re-render, and repeat until we fit or cannot reduce further.
  let current: PromptScope | null = element;
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

    if (applied.element && applied.element.kind !== "scope") {
      throw new Error("Root scope was replaced by a message node.");
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

function findLowestImportancePriority(node: PromptNode): number | null {
  if (node.kind === "message") {
    return null;
  }

  let maxPriority: number | null = node.strategy ? node.priority : null;

  for (const child of node.children) {
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
  element: PromptNode,
  priority: number,
  baseCtx: BaseContext,
  inheritedContext: CriaContext,
  hooks: RenderHooks | undefined,
  iteration: number
): Promise<{ element: PromptNode | null; applied: boolean }> {
  if (element.kind === "message") {
    return { element, applied: false };
  }

  // Bottom-up: rewrite children first so nested strategies get first crack.
  // Element context overrides inherited context.
  const mergedContext: CriaContext = element.context
    ? { ...inheritedContext, ...element.context }
    : inheritedContext;

  let childrenChanged = false;
  const nextChildren: PromptNode[] = [];

  for (const child of element.children) {
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
    ? ({ ...element, children: nextChildren } as PromptScope)
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
