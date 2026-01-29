import { createHash } from "node:crypto";
import type { ModelProvider, ProviderRenderContext } from "./provider";
import { attachRenderContext } from "./provider";
import {
  type AssistantMessage,
  type CacheDescriptor,
  type CacheHint,
  type CriaContext,
  FitError,
  type MaybePromise,
  type PromptLayout,
  type PromptMessage,
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
 * - Token counting is provider-owned and happens on rendered output.
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
  // Data flow: PromptTree -> PromptLayout (flatten) -> provider.codec -> provider.countTokens.
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

function renderOutput<TRendered, TToolIO extends ProviderToolIO>(
  root: PromptTree<TToolIO>,
  provider: ModelProvider<TRendered, TToolIO>
): TRendered {
  // Prompt tree composition is resolved before rendering; codecs only see layout.
  const { layout, cacheDescriptor } = layoutPromptWithCache(root);
  const context: ProviderRenderContext = { cache: cacheDescriptor };
  const rendered = provider.codec.render(layout, context);
  return attachRenderContext(rendered, context);
}

function renderAndCount<TRendered, TToolIO extends ProviderToolIO>(
  root: PromptTree<TToolIO>,
  provider: ModelProvider<TRendered, TToolIO>
): { output: TRendered; tokens: number } {
  // Tree -> layout -> codec output, then provider-owned token counting.
  const layout = layoutPrompt(root);
  const output = provider.codec.render(layout);
  const tokens = provider.countTokens(output);
  return { output, tokens };
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

interface LayoutWithPins<TToolIO extends ProviderToolIO> {
  layout: PromptLayout<TToolIO>;
  pinIdsByMessage: readonly (readonly string[])[];
  scopeKeysByMessage: readonly (readonly string[])[];
  ttlSecondsByMessage: readonly (readonly number[])[];
}

function layoutPromptWithPins<TToolIO extends ProviderToolIO>(
  root: PromptTree<TToolIO>
): LayoutWithPins<TToolIO> {
  const messages: PromptMessage<TToolIO>[] = [];
  const pinIdsByMessage: (readonly string[])[] = [];
  const scopeKeysByMessage: (readonly string[])[] = [];
  const ttlSecondsByMessage: (readonly number[])[] = [];
  const activePins: CacheHint[] = [];

  const walk = (node: PromptNode<TToolIO>): void => {
    if (node.kind === "message") {
      messages.push(buildMessage(node));
      const pinIds = dedupeStrings(activePins.map((pin) => pin.id));
      const scopeKeys = dedupeStrings(
        activePins.flatMap((pin) => (pin.scopeKey ? [pin.scopeKey] : []))
      );
      const ttlSeconds = dedupeNumbers(
        activePins.flatMap((pin) =>
          pin.ttlSeconds !== undefined ? [pin.ttlSeconds] : []
        )
      );
      pinIdsByMessage.push(pinIds);
      scopeKeysByMessage.push(scopeKeys);
      ttlSecondsByMessage.push(ttlSeconds);
      return;
    }

    const cacheHint = node.cache;
    const hasPin = cacheHint?.mode === "pin";
    if (hasPin && cacheHint) {
      activePins.push(cacheHint);
    }

    for (const child of node.children) {
      walk(child);
    }

    if (hasPin) {
      activePins.pop();
    }
  };

  walk(root);

  return {
    layout: messages,
    pinIdsByMessage,
    scopeKeysByMessage,
    ttlSecondsByMessage,
  };
}

function dedupeStrings(values: readonly string[]): readonly string[] {
  if (values.length <= 1) {
    return values;
  }
  return [...new Set(values)];
}

function dedupeNumbers(values: readonly number[]): readonly number[] {
  if (values.length <= 1) {
    return values;
  }
  return [...new Set(values)];
}

function canonicalizeMessage<TToolIO extends ProviderToolIO>(
  message: PromptMessage<TToolIO>
): unknown {
  switch (message.role) {
    case "assistant":
      return {
        role: message.role,
        text: message.text,
        reasoning: message.reasoning ?? "",
        toolCalls: message.toolCalls ?? [],
      };
    case "tool":
      return {
        role: message.role,
        toolCallId: message.toolCallId,
        toolName: message.toolName,
        output: message.output,
      };
    default:
      return {
        role: message.role,
        text: message.text,
      };
  }
}

function hashPinnedPrefix<TToolIO extends ProviderToolIO>(
  layout: PromptLayout<TToolIO>,
  pinnedPrefixMessageCount: number
): string | null {
  if (pinnedPrefixMessageCount === 0) {
    return null;
  }

  const pinnedPrefix = layout
    .slice(0, pinnedPrefixMessageCount)
    .map((message) => canonicalizeMessage(message));
  const canonical = JSON.stringify(pinnedPrefix);
  return createHash("sha256").update(canonical).digest("hex");
}

function computePinnedPrefixCount(
  pinIdsByMessage: readonly (readonly string[])[]
): number {
  let pinnedPrefixMessageCount = 0;
  for (const pinIds of pinIdsByMessage) {
    if (pinIds.length === 0) {
      break;
    }
    pinnedPrefixMessageCount += 1;
  }
  return pinnedPrefixMessageCount;
}

function buildPinnedMessageIndexes(
  pinnedPrefixMessageCount: number
): readonly number[] {
  if (pinnedPrefixMessageCount === 0) {
    return [];
  }
  return Array.from(
    { length: pinnedPrefixMessageCount },
    (_unused, index) => index
  );
}

function collectPinIdsInPrefix(
  pinIdsByMessage: readonly (readonly string[])[],
  pinnedPrefixMessageCount: number
): readonly string[] {
  const pinIdsInPrefix: string[] = [];
  const pinIdsSeen = new Set<string>();
  for (let index = 0; index < pinnedPrefixMessageCount; index += 1) {
    const pinIds = pinIdsByMessage[index];
    if (!pinIds) {
      continue;
    }
    for (const pinId of pinIds) {
      if (pinIdsSeen.has(pinId)) {
        continue;
      }
      pinIdsSeen.add(pinId);
      pinIdsInPrefix.push(pinId);
    }
  }
  return pinIdsInPrefix;
}

function sharedSingleValue<T>(values: readonly T[]): T | undefined {
  if (values.length === 0) {
    return undefined;
  }
  const uniqueValues = [...new Set(values)];
  return uniqueValues.length === 1 ? uniqueValues[0] : undefined;
}

function computeCacheDescriptor<TToolIO extends ProviderToolIO>(
  layout: PromptLayout<TToolIO>,
  pinIdsByMessage: readonly (readonly string[])[],
  scopeKeysByMessage: readonly (readonly string[])[],
  ttlSecondsByMessage: readonly (readonly number[])[]
): CacheDescriptor {
  const pinnedPrefixMessageCount = computePinnedPrefixCount(pinIdsByMessage);
  const pinnedMessageIndexes = buildPinnedMessageIndexes(
    pinnedPrefixMessageCount
  );
  const pinIdsInPrefix = collectPinIdsInPrefix(
    pinIdsByMessage,
    pinnedPrefixMessageCount
  );

  const scopeKey = sharedSingleValue(
    scopeKeysByMessage.slice(0, pinnedPrefixMessageCount).flat()
  );
  const ttlSeconds = sharedSingleValue(
    ttlSecondsByMessage.slice(0, pinnedPrefixMessageCount).flat()
  );

  return {
    pinIdsInPrefix,
    pinnedMessageIndexes,
    pinnedPrefixMessageCount,
    pinnedPrefixHash: hashPinnedPrefix(layout, pinnedPrefixMessageCount),
    ...(scopeKey ? { scopeKey } : {}),
    ...(ttlSeconds !== undefined ? { ttlSeconds } : {}),
  };
}

function layoutPromptWithCache<TToolIO extends ProviderToolIO>(
  root: PromptTree<TToolIO>
): { layout: PromptLayout<TToolIO>; cacheDescriptor: CacheDescriptor } {
  const { layout, pinIdsByMessage, scopeKeysByMessage, ttlSecondsByMessage } =
    layoutPromptWithPins(root);
  const cacheDescriptor = computeCacheDescriptor(
    layout,
    pinIdsByMessage,
    scopeKeysByMessage,
    ttlSecondsByMessage
  );
  return { layout, cacheDescriptor };
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

async function fitToBudget<TRendered, TToolIO extends ProviderToolIO>(
  element: PromptTree<TToolIO>,
  budget: number,
  provider: ModelProvider<TRendered, TToolIO>,
  hooks: RenderHooks<TToolIO> | undefined,
  baseContext: CriaContext
): Promise<PromptScope<TToolIO> | null> {
  // Fit loop is render-driven: render+count, then apply the lowest-importance
  // strategy, re-render, and repeat until we fit or cannot reduce further.
  let current: PromptScope<TToolIO> | null = element;
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

    const baseCtx: BaseContext<TToolIO> = {
      totalTokens,
      iteration,
    };

    const applied: { element: PromptNode<TToolIO> | null; applied: boolean } =
      await applyStrategiesAtPriority(
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

function findLowestImportancePriority<TToolIO extends ProviderToolIO>(
  node: PromptNode<TToolIO>
): number | null {
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
  iteration: number
): Promise<{ element: PromptNode<TToolIO> | null; applied: boolean }> {
  if (element.kind === "message") {
    return { element, applied: false };
  }

  // Bottom-up: rewrite children first so nested strategies get first crack.
  // Element context overrides inherited context.
  const mergedContext: CriaContext = element.context
    ? { ...inheritedContext, ...element.context }
    : inheritedContext;

  let childrenChanged = false;
  const nextChildren: PromptNode<TToolIO>[] = [];

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
    return { element: replacement, applied: true };
  }

  return { element: nextElement, applied: childrenChanged };
}
