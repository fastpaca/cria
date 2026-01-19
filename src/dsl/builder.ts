/**
 * Fluent builders for constructing prompts.
 */

import type { KVMemory, VectorMemory } from "../memory";
import type { RenderOptions } from "../render";
import { assertValidMessageScope, render as renderPrompt } from "../render";
import { normalizeTextInput, type TextInput } from "../templating";
import type {
  CriaContext,
  ModelProvider,
  PromptNode,
  PromptPart,
  PromptRole,
  PromptScope,
  PromptTree,
  ToolResultPart,
} from "../types";
import {
  createMessage,
  createOmitStrategy,
  createScope,
  createTruncateStrategy,
  formatExamples,
} from "./strategies";
import type { StoredSummary, Summarizer } from "./summary";
import { Summary } from "./summary";
import type { ResultFormatter } from "./vector-search";
import { VectorSearch } from "./vector-search";

/**
 * Content that can be passed to scope-level operations like truncate/omit.
 */
export type ScopeContent =
  | PromptNode
  | PromptBuilder
  | Promise<PromptNode>
  | readonly ScopeContent[];

/**
 * Children can include promises (async components like VectorSearch).
 * These are resolved when `.build()` resolves the tree.
 */
export type BuilderChild =
  | PromptNode
  | PromptPart
  | PromptBuilder
  | string
  | number
  | boolean
  | Promise<PromptNode | PromptPart | string | number | boolean>;

type RenderResult<TOptions extends RenderOptions> = TOptions extends {
  provider: ModelProvider<infer TOutput>;
}
  ? TOutput
  : unknown;

/**
 * Shared fluent API for prompt-level and message-level builders.
 */
export abstract class BuilderBase<TBuilder extends BuilderBase<TBuilder>> {
  protected readonly children: BuilderChild[];
  protected readonly context: CriaContext | undefined;

  protected constructor(
    children: BuilderChild[] = [],
    context: CriaContext | undefined = undefined
  ) {
    this.children = children;
    this.context = context;
  }

  protected abstract create(
    children: BuilderChild[],
    context: CriaContext | undefined
  ): TBuilder;

  /**
   * Merge another builder's contents into this one (zod-like merge).
   * Contexts must be compatible (either identical or undefined).
   */
  merge(...builders: TBuilder[]): TBuilder {
    const sources: BuilderBase<TBuilder>[] = [this, ...builders];
    let nextContext = this.context;
    const totalChildren = sources.reduce(
      (sum, builder) => sum + builder.children.length,
      0
    );
    const mergedChildren = new Array<BuilderChild>(totalChildren);
    let writeIndex = 0;

    for (const builder of sources) {
      if (builder.context && nextContext && builder.context !== nextContext) {
        throw new Error(
          "Cannot merge builders with different contexts/providers"
        );
      }
      if (!nextContext) {
        nextContext = builder.context;
      }
      for (const child of builder.children) {
        mergedChildren[writeIndex] = child;
        writeIndex += 1;
      }
    }

    mergedChildren.length = writeIndex;

    return this.create(mergedChildren, nextContext);
  }

  protected addChild(child: BuilderChild): TBuilder {
    return this.create([...this.children, child], this.context);
  }

  protected addChildren(children: readonly BuilderChild[]): TBuilder {
    return this.create([...this.children, ...children], this.context);
  }
}

export class MessageBuilder extends BuilderBase<MessageBuilder> {
  constructor(
    children: BuilderChild[] = [],
    context: CriaContext | undefined = undefined
  ) {
    super(children, context);
  }

  protected create(
    children: BuilderChild[],
    context: CriaContext | undefined
  ): MessageBuilder {
    return new MessageBuilder(children, context);
  }

  append(content: TextInput): MessageBuilder {
    const normalized = normalizeTextInput(content);
    return this.addChildren(normalized);
  }

  /**
   * Add vector search results as message content (async, resolved at render time).
   */
  vectorSearch<T = unknown>(opts: {
    store: VectorMemory<T>;
    query: string;
    limit?: number;
    threshold?: number;
    formatter?: ResultFormatter<T>;
  }): MessageBuilder {
    const props: Parameters<typeof VectorSearch<T>>[0] = {
      store: opts.store,
      query: opts.query,
      ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
      ...(opts.threshold !== undefined ? { threshold: opts.threshold } : {}),
      ...(opts.formatter ? { formatResults: opts.formatter } : {}),
    };
    const asyncPart = VectorSearch<T>(props).then((scope) => {
      const message = scope.children[0];
      if (!message || message.kind !== "message") {
        throw new Error("VectorSearch did not return a message node.");
      }
      const part = message.children[0];
      if (!part || part.type !== "text") {
        throw new Error("VectorSearch did not return a text part.");
      }
      return part;
    });
    return this.addChild(asyncPart);
  }

  /**
   * Add a formatted list of examples.
   */
  examples(
    title: string,
    items: string[],
    _opts?: { id?: string }
  ): MessageBuilder {
    const element = formatExamples(title, items);
    return this.addChild(element);
  }

  async buildChildren(): Promise<PromptPart[]> {
    return await resolveMessageChildren(this.children);
  }
}

/**
 * Fluent builder for constructing prompt trees.
 *
 * Every method returns a new immutable builder instance; large chains will copy
 * child arrays, so keep prompts reasonably sized.
 * Call `.build()` to get the final `PromptTree`.
 */
export class PromptBuilder extends BuilderBase<PromptBuilder> {
  private constructor(
    children: BuilderChild[] = [],
    context: CriaContext | undefined = undefined
  ) {
    super(children, context);
  }

  /**
   * Create a new empty prompt builder.
   */
  static create(): PromptBuilder {
    return new PromptBuilder();
  }

  protected create(
    children: BuilderChild[],
    context: CriaContext | undefined
  ): PromptBuilder {
    return new PromptBuilder(children, context);
  }

  scope(
    fn: (builder: PromptBuilder) => PromptBuilder,
    opts?: { id?: string }
  ): PromptBuilder {
    if (typeof fn !== "function") {
      throw new Error(
        `scope() requires a callback function. Received: ${typeof fn}`
      );
    }

    const inner = fn(this.create([], this.context));
    const element = inner
      .buildChildren()
      .then((children) =>
        createScope(children, opts?.id ? { id: opts.id } : undefined)
      );

    return this.addChild(element);
  }

  /**
   * Add content that will be truncated when over budget.
   */
  truncate(
    content: ScopeContent,
    opts: {
      budget: number;
      from?: "start" | "end";
      priority?: number;
      id?: string;
    }
  ): PromptBuilder {
    const node = resolveScopeContent(content).then((children) =>
      createScope(children, {
        ...(opts.priority !== undefined && { priority: opts.priority }),
        strategy: createTruncateStrategy(opts.budget, opts.from ?? "start"),
        ...(opts.id && { id: opts.id }),
      })
    );

    return this.addChild(node);
  }

  /**
   * Add content that will be entirely removed when over budget.
   */
  omit(
    content: ScopeContent,
    opts?: { priority?: number; id?: string }
  ): PromptBuilder {
    const node = resolveScopeContent(content).then((children) =>
      createScope(children, {
        ...(opts?.priority !== undefined && { priority: opts.priority }),
        strategy: createOmitStrategy(),
        ...(opts?.id && { id: opts.id }),
      })
    );

    return this.addChild(node);
  }

  /**
   * Create a provider scope for AI-powered operations like Summary.
   *
   * @example
   * ```typescript
   * import { createProvider } from "@fastpaca/cria/ai-sdk";
   * import { openai } from "@ai-sdk/openai";
   *
   * const provider = createProvider(openai("gpt-4o"));
   * cria.prompt()
   *   .provider(provider, (p) =>
   *     p.summary(content, { id: "conv", store })
   *   )
   * ```
   */
  provider(
    modelProvider: ModelProvider<unknown>,
    fn: (builder: PromptBuilder) => PromptBuilder
  ): PromptBuilder {
    const context: CriaContext = { provider: modelProvider };
    const inner = fn(this.create([], context));

    const element = inner.buildChildren().then(
      (children): PromptScope => ({
        kind: "scope",
        priority: 0,
        children,
        context,
      })
    );

    return this.addChild(element);
  }

  /**
   * Add vector search results (async, resolved at render time).
   */
  vectorSearch<T = unknown>(opts: {
    store: VectorMemory<T>;
    query: string;
    limit?: number;
    threshold?: number;
    formatter?: ResultFormatter<T>;
    priority?: number;
    id?: string;
  }): PromptBuilder {
    const props: Parameters<typeof VectorSearch<T>>[0] = {
      store: opts.store,
      query: opts.query,
      ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
      ...(opts.threshold !== undefined ? { threshold: opts.threshold } : {}),
      ...(opts.formatter ? { formatResults: opts.formatter } : {}),
      ...(opts.priority !== undefined ? { priority: opts.priority } : {}),
      ...(opts.id !== undefined ? { id: opts.id } : {}),
    };
    const asyncElement = VectorSearch<T>(props);
    return this.addChild(asyncElement);
  }

  /**
   * Add content that will be summarized when over budget.
   */
  summary(
    content: ScopeContent,
    opts: {
      id: string;
      store: KVMemory<StoredSummary>;
      summarize?: Summarizer;
      priority?: number;
    }
  ): PromptBuilder {
    const element = resolveScopeContent(content).then((children) =>
      Summary({
        id: opts.id,
        store: opts.store,
        children,
        ...(opts.summarize ? { summarize: opts.summarize } : {}),
        ...(opts.priority !== undefined ? { priority: opts.priority } : {}),
      })
    );

    return this.addChild(element);
  }

  /**
   * Add a raw PromptNode (escape hatch for advanced usage).
   */
  raw(element: PromptNode | Promise<PromptNode>): PromptBuilder {
    return this.addChild(element);
  }

  /**
   * Merge builders or raw nodes into this one.
   * Accepts PromptBuilders, individual PromptNodes, or arrays of PromptNodes.
   *
   * @example
   * ```typescript
   * // Merge builders
   * cria.prompt().system("A").merge(otherBuilder)
   *
   * // Merge raw nodes
   * cria.prompt().system("A").merge(...scope.children)
   * ```
   */
  override merge(
    ...items: (PromptBuilder | PromptNode | readonly PromptNode[])[]
  ): PromptBuilder {
    const newChildren: BuilderChild[] = [...this.children];
    let nextContext = this.context;

    for (const item of items) {
      nextContext = this.mergeItem(item, newChildren, nextContext);
    }

    return this.create(newChildren, nextContext);
  }

  private mergeItem(
    item: PromptBuilder | PromptNode | readonly PromptNode[],
    target: BuilderChild[],
    currentContext: CriaContext | undefined
  ): CriaContext | undefined {
    if (item instanceof PromptBuilder) {
      if (item.context && currentContext && item.context !== currentContext) {
        throw new Error(
          "Cannot merge builders with different contexts/providers"
        );
      }
      target.push(...item.children);
      return item.context ?? currentContext;
    }

    if (Array.isArray(item)) {
      for (const node of item) {
        target.push(node);
      }
      return currentContext;
    }

    if (isPromptNode(item)) {
      target.push(item);
    }

    return currentContext;
  }

  /**
   * Conditionally apply a transformation to the builder.
   *
   * @example
   * ```typescript
   * cria.prompt()
   *   .system("Hello")
   *   .when(hasContext, (p) => p.user("Context: ..."))
   *   .user("Question")
   * ```
   */
  when(
    condition: boolean,
    fn: (builder: PromptBuilder) => PromptBuilder
  ): PromptBuilder {
    return condition ? fn(this) : this;
  }

  /**
   * Add a system message.
   */
  system(
    content: TextInput | ((builder: MessageBuilder) => MessageBuilder),
    opts?: { id?: string }
  ): PromptBuilder {
    return this.addMessage("system", content, opts);
  }

  /**
   * Add a user message.
   */
  user(
    content: TextInput | ((builder: MessageBuilder) => MessageBuilder),
    opts?: { id?: string }
  ): PromptBuilder {
    return this.addMessage("user", content, opts);
  }

  /**
   * Add an assistant message.
   */
  assistant(
    content: TextInput | ((builder: MessageBuilder) => MessageBuilder),
    opts?: { id?: string }
  ): PromptBuilder {
    return this.addMessage("assistant", content, opts);
  }

  /**
   * Add a tool result message.
   */
  tool(
    result: ToolResultPart | readonly ToolResultPart[],
    opts?: { id?: string }
  ): PromptBuilder {
    const children = Array.isArray(result) ? [...result] : [result];
    const element = createMessage("tool", children, opts?.id);
    return this.addChild(element);
  }

  /**
   * Add a message with a custom role.
   */
  message(
    role: PromptRole,
    content: TextInput | ((builder: MessageBuilder) => MessageBuilder),
    opts?: { id?: string }
  ): PromptBuilder {
    return this.addMessage(role, content, opts);
  }

  async buildChildren(): Promise<PromptNode[]> {
    return await resolveScopeChildren(this.children);
  }

  /**
   * Build the final PromptTree.
   */
  async build(): Promise<PromptTree> {
    const element: PromptScope = {
      kind: "scope",
      priority: 0,
      children: await this.buildChildren(),
      ...(this.context && { context: this.context }),
    };
    // Enforce message boundaries at build time so invalid trees fail early.
    assertValidMessageScope(element);
    return element;
  }

  /**
   * Render the prompt directly using the provided options.
   * Equivalent to `render(await builder.build(), options)`.
   */
  async render<TOptions extends RenderOptions>(
    options: TOptions
  ): Promise<RenderResult<TOptions>> {
    const element = await this.build();
    return (await renderPrompt(element, options)) as RenderResult<TOptions>;
  }

  private addMessage(
    role: PromptRole,
    content: TextInput | ((builder: MessageBuilder) => MessageBuilder),
    opts?: { id?: string }
  ): PromptBuilder {
    const childrenPromise =
      typeof content === "function"
        ? content(new MessageBuilder([], this.context)).buildChildren()
        : Promise.resolve(normalizeTextInput(content));

    const element = childrenPromise.then((children) =>
      createMessage(role, children, opts?.id)
    );

    return this.addChild(element);
  }
}

/**
 * Prompt type alias for external use.
 */
export type Prompt = PromptBuilder;

// Resolution functions (colocated with builders)

function textPart(value: string): PromptPart {
  return { type: "text", text: value };
}

function isPromptNode(value: unknown): value is PromptNode {
  return typeof value === "object" && value !== null && "kind" in value;
}

function isPromptPart(value: unknown): value is PromptPart {
  return typeof value === "object" && value !== null && "type" in value;
}

async function resolveMessageChildren(
  children: BuilderChild | readonly BuilderChild[]
): Promise<PromptPart[]> {
  const list = Array.isArray(children) ? children : [children];
  const resolved = await Promise.all(
    list.map((child) => resolveBuilderChild(child, "message"))
  );

  return resolved.flat();
}

async function resolveScopeChildren(
  children: BuilderChild | readonly BuilderChild[]
): Promise<PromptNode[]> {
  const list = Array.isArray(children) ? children : [children];
  const resolved = await Promise.all(
    list.map((child) => resolveBuilderChild(child, "scope"))
  );

  return resolved.flat();
}

async function resolveScopeContent(
  content: ScopeContent
): Promise<PromptNode[]> {
  if (content instanceof PromptBuilder) {
    const built = await content.build();
    // Extract children so strategies operate on individual items, not a wrapper scope
    return [...built.children];
  }

  if (content instanceof Promise) {
    const value = await content;
    return await resolveScopeContent(value as ScopeContent);
  }

  if (Array.isArray(content)) {
    const resolved = await Promise.all(content.map(resolveScopeContent));
    return resolved.flat();
  }

  if (isPromptNode(content)) {
    return [content];
  }

  throw new Error("Scope content must be prompt nodes or prompt builders.");
}

async function resolveBuilderChild(
  child: BuilderChild,
  target: "message"
): Promise<PromptPart[]>;
async function resolveBuilderChild(
  child: BuilderChild,
  target: "scope"
): Promise<PromptNode[]>;
async function resolveBuilderChild(
  child: BuilderChild,
  target: "message" | "scope"
): Promise<PromptPart[] | PromptNode[]> {
  const resolved = await resolveBuilderChildPromise(child);

  if (target === "message") {
    return resolveMessageChild(resolved);
  }

  return await resolveScopeChild(resolved);
}

async function resolveBuilderChildPromise(
  child: BuilderChild
): Promise<BuilderChild> {
  if (child instanceof Promise) {
    return await child;
  }
  return child;
}

function resolveMessageChild(child: BuilderChild): PromptPart[] {
  if (child instanceof PromptBuilder) {
    throw new Error("Prompt builders cannot be nested inside messages.");
  }

  if (typeof child === "string") {
    return [textPart(child)];
  }

  if (typeof child === "number" || typeof child === "boolean") {
    return [textPart(String(child))];
  }

  if (isPromptPart(child)) {
    return [child];
  }

  if (isPromptNode(child)) {
    throw new Error("Prompt nodes are not allowed inside messages.");
  }

  throw new Error("Unsupported child type.");
}

async function resolveScopeChild(child: BuilderChild): Promise<PromptNode[]> {
  if (child instanceof PromptBuilder) {
    return [await child.build()];
  }

  if (typeof child === "string" || typeof child === "number") {
    throw new Error("Text nodes are only allowed inside messages.");
  }

  if (typeof child === "boolean") {
    throw new Error("Text nodes are only allowed inside messages.");
  }

  if (isPromptPart(child)) {
    throw new Error("Message parts are only allowed inside messages.");
  }

  if (isPromptNode(child)) {
    return [child];
  }

  throw new Error("Unsupported child type.");
}
