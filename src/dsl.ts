/**
 * Fluent DSL for building prompts.
 *
 * @example
 * ```typescript
 * import { cria } from "@fastpaca/cria";
 *
 * const prompt = await cria
 *   .prompt()
 *   .system("You are a helpful assistant.")
 *   .user("What is the capital of France?")
 *   .render({ budget: 4000, provider });
 * ```
 *
 * @packageDocumentation
 */

import type { ResultFormatter, StoredSummary, Summarizer } from "./components";
import {
  Examples,
  Message,
  Omit,
  Scope,
  Summary,
  Truncate,
  VectorSearch,
} from "./components";
import type { KVMemory, VectorMemory } from "./memory";
import type { RenderOptions } from "./render";
import { assertValidMessageScope, render as renderPrompt } from "./render";
import type {
  CriaContext,
  ModelProvider,
  PromptNode,
  PromptPart,
  PromptRole,
  PromptScope,
  PromptTree,
  ToolResultElement,
} from "./types";

type TextValue = PromptPart | boolean | number | string | null | undefined;

export type TextInput = TextValue | readonly TextInput[];

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

const TEMPLATE_INDENT_RE = /^[ \t]*/;

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
    opts?: { id?: string }
  ): MessageBuilder {
    const element = Examples({
      title,
      children: items,
      ...(opts?.id ? { id: opts.id } : {}),
    });
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
    const element = createPromptNode(
      () => inner.buildChildren(),
      (children) =>
        Scope({
          priority: 0,
          children,
          ...(opts?.id ? { id: opts.id } : {}),
        })
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
    const node = createPromptNode(
      () => resolveScopeContent(content),
      (children) => {
        const props: Parameters<typeof Truncate>[0] = {
          children,
          budget: opts.budget,
          ...(opts.from ? { from: opts.from } : {}),
          ...(opts.priority !== undefined ? { priority: opts.priority } : {}),
          ...(opts.id ? { id: opts.id } : {}),
        };
        return Truncate({
          ...props,
        });
      }
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
    const node = createPromptNode(
      () => resolveScopeContent(content),
      (children) => {
        const props: Parameters<typeof Omit>[0] = {
          children,
          ...(opts?.priority !== undefined ? { priority: opts.priority } : {}),
          ...(opts?.id ? { id: opts.id } : {}),
        };
        return Omit(props);
      }
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

    const element = createPromptNode(
      () => inner.buildChildren(),
      (children) => ({
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
    const element = createPromptNode(
      () => resolveScopeContent(content),
      (children) => {
        const props: Parameters<typeof Summary>[0] = {
          id: opts.id,
          store: opts.store,
          children,
          ...(opts.summarize ? { summarize: opts.summarize } : {}),
          ...(opts.priority !== undefined ? { priority: opts.priority } : {}),
        };
        return Summary(props);
      }
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
    result: ToolResultElement | readonly ToolResultElement[],
    opts?: { id?: string }
  ): PromptBuilder {
    const children = Array.isArray(result) ? [...result] : [result];
    return this.addChild(
      Message({
        messageRole: "tool",
        children,
        ...(opts?.id ? { id: opts.id } : {}),
      })
    );
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
    const element = createPromptNode(
      () =>
        typeof content === "function"
          ? content(new MessageBuilder([], this.context)).buildChildren()
          : normalizeTextInput(content),
      (children) =>
        Message({
          messageRole: role,
          children,
          ...(opts?.id ? { id: opts.id } : {}),
        })
    );

    return this.addChild(element);
  }
}

export type Prompt = PromptBuilder;

/**
 * Namespace for building prompts as code.
 *
 * @example
 * ```typescript
 * import { cria } from "@fastpaca/cria";
 *
 * const prompt = cria
 *   .prompt()
 *   .system("You are helpful.")
 *   .user("Hello!")
 *   .build();
 * ```
 */
export const cria = {
  prompt: () => PromptBuilder.create(),
  c,
  merge: (...builders: PromptBuilder[]) => {
    const [first, ...rest] = builders;
    if (!first) {
      return PromptBuilder.create();
    }
    return first.merge(...rest);
  },
} as const;

/**
 * Standalone function to create a new prompt builder.
 */
export const prompt = () => PromptBuilder.create();

/**
 * Merge multiple builders into one (zod-like merge).
 */
export const merge = (...builders: PromptBuilder[]): PromptBuilder =>
  cria.merge(...builders);

/**
 * Tagged template literal function for building prompt children with automatic indentation normalization.
 *
 * Interpolates values into template strings and normalizes indentation by stripping
 * common leading whitespace. Useful for writing multi-line prompt content with clean formatting.
 *
 * @param strings - Template string segments
 * @param values - Interpolated values (strings, numbers, booleans, PromptParts, arrays, etc.)
 * @returns Array of message parts
 *
 * This function allows you to use prompt parts naturally inside template strings.
 */
export function c(
  strings: TemplateStringsArray,
  ...values: readonly TextInput[]
): readonly PromptPart[] {
  const normalizedStrings = normalizeTemplateStrings(strings);
  const children: PromptPart[] = [];

  for (let index = 0; index < normalizedStrings.length; index += 1) {
    const segment = normalizedStrings[index];
    if (segment !== undefined && segment.length > 0) {
      children.push({ type: "text", text: segment });
    }

    if (index < values.length) {
      const normalized = normalizeTextInput(values[index]);
      if (normalized.length > 0) {
        children.push(...normalized);
      }
    }
  }

  return children;
}

function createPromptNode<TChildren>(
  buildChildren: () => Promise<TChildren> | TChildren,
  buildElement: (children: TChildren) => PromptNode
): Promise<PromptNode> {
  const result = buildChildren();
  if (result instanceof Promise) {
    return result.then((children) => buildElement(children));
  }
  return Promise.resolve(buildElement(result));
}

function textPart(value: string): PromptPart {
  return { type: "text", text: value };
}

// Normalize text-like inputs into prompt parts.
function normalizeTextInput(content?: TextInput): PromptPart[] {
  if (content === null || content === undefined) {
    return [];
  }

  if (Array.isArray(content)) {
    const flattened: PromptPart[] = [];
    for (const item of content) {
      flattened.push(...normalizeTextInput(item));
    }
    return flattened;
  }

  if (typeof content === "string") {
    return [textPart(content)];
  }

  if (typeof content === "number" || typeof content === "boolean") {
    return [textPart(String(content))];
  }

  if (isPromptPart(content)) {
    return [content];
  }

  throw new Error("Message content must be text or message parts.");
}

function normalizeTemplateStrings(
  strings: readonly string[]
): readonly string[] {
  if (strings.length === 0) {
    return strings;
  }

  const normalized = [...strings];
  if (normalized[0]?.startsWith("\n")) {
    normalized[0] = normalized[0].slice(1);
  }
  const lastIndex = normalized.length - 1;
  if (normalized[lastIndex]?.endsWith("\n")) {
    normalized[lastIndex] = normalized[lastIndex].slice(0, -1);
  }

  const lines = normalized.flatMap((segment) => segment.split("\n"));
  const indents = lines
    .filter((line) => line.trim().length > 0)
    .map((line) => line.match(TEMPLATE_INDENT_RE)?.[0].length ?? 0);
  const minIndent = indents.length > 0 ? Math.min(...indents) : 0;

  if (minIndent === 0) {
    return normalized;
  }

  return normalized.map((segment) =>
    segment
      .split("\n")
      .map((line) => {
        if (line.trim().length === 0) {
          return "";
        }
        return line.slice(Math.min(minIndent, line.length));
      })
      .join("\n")
  );
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
    return [await content.build()];
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
