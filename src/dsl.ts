/**
 * Fluent DSL for building prompts without JSX.
 *
 * @example
 * ```typescript
 * import { cria } from "@fastpaca/cria";
 *
 * const prompt = await cria
 *   .prompt()
 *   .system("You are a helpful assistant.")
 *   .user("What is the capital of France?")
 *   .render({tokenizer, budget: 4000, renderer});
 * ```
 *
 * @packageDocumentation
 */

import type { ResultFormatter, StoredSummary, Summarizer } from "./components";
import {
  Examples,
  Message,
  Omit,
  Region,
  Summary,
  Truncate,
  VectorSearch,
} from "./components";
import type { KVMemory, VectorMemory } from "./memory";
import type { RenderOptions } from "./render";
import { render as renderPrompt } from "./render";
import type {
  CriaContext,
  ModelProvider,
  PromptChild,
  PromptChildren,
  PromptElement,
  PromptRenderer,
  PromptRole,
} from "./types";

type TextValue = PromptChild | boolean | number | null | undefined;

export type TextInput = TextValue | readonly TextInput[];

export type ScopeContent =
  | TextInput
  | PromptBuilder
  | Promise<PromptElement>
  | Promise<string>;

/**
 * Children can include promises (async components like VectorSearch).
 * These are resolved when `.build()` resolves the tree.
 */
export type BuilderChild =
  | PromptElement
  | PromptBuilder
  | string
  | Promise<PromptElement>
  | Promise<string>;

type RenderResult<TOptions extends RenderOptions> = TOptions extends {
  renderer: PromptRenderer<infer TOutput>;
}
  ? TOutput
  : string;

const TEMPLATE_INDENT_RE = /^[ \t]*/;

/**
 * Shared fluent API for prompt-level and message-level builders.
 * Keeps component helpers available inside nested scopes.
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

  scope(fn: (builder: TBuilder) => TBuilder, opts?: { id?: string }): TBuilder {
    if (typeof fn !== "function") {
      throw new Error(
        `scope() requires a callback function. Received: ${typeof fn}`
      );
    }

    const inner = fn(this.create([], this.context));
    const element = createPromptElement(
      () => inner.buildChildren(),
      (children) =>
        Region({
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
    content: string | PromptElement | PromptBuilder,
    opts: {
      budget: number;
      from?: "start" | "end";
      priority?: number;
      id?: string;
    }
  ): TBuilder {
    const node = createPromptElement(
      () => resolveBuilderChildren(content),
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
    content: string | PromptElement | PromptBuilder,
    opts?: { priority?: number; id?: string }
  ): TBuilder {
    const node = createPromptElement(
      () => resolveBuilderChildren(content),
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
   * Merge another builder's contents into this one (zod-like merge).
   * Contexts must be compatible (either identical or undefined).
   */
  merge(...builders: TBuilder[]): TBuilder {
    const sources = [this, ...builders];
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

  /**
   * Create a provider scope for AI-powered operations like Summary.
   *
   * @example
   * ```typescript
   * import { Provider } from "@fastpaca/cria/ai-sdk";
   *
   * const provider = new Provider(openai("gpt-4o"));
   * .provider(provider, (p) =>
   *   p.summary(content, { id: "conv", store })
   * )
   * ```
   */
  provider(
    modelProvider: ModelProvider,
    fn: (builder: TBuilder) => TBuilder
  ): TBuilder {
    const context: CriaContext = { provider: modelProvider };
    const inner = fn(this.create([], context));

    const element = createPromptElement(
      () => inner.buildChildren(),
      (children) => ({
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
  }): TBuilder {
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
    content: string | PromptElement | PromptBuilder,
    opts: {
      id: string;
      store: KVMemory<StoredSummary>;
      summarize?: Summarizer;
      priority?: number;
    }
  ): TBuilder {
    const element = createPromptElement(
      () => resolveBuilderChildren(content),
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
   * Add a formatted list of examples.
   */
  examples(
    title: string,
    items: (string | PromptElement)[],
    opts?: { priority?: number; id?: string }
  ): TBuilder {
    return this.addChild(
      Examples({
        title,
        children: items,
        ...(opts?.priority !== undefined ? { priority: opts.priority } : {}),
        ...(opts?.id ? { id: opts.id } : {}),
      })
    );
  }

  /**
   * Add a raw PromptElement (escape hatch for advanced usage).
   */
  raw(element: PromptElement | Promise<PromptElement>): TBuilder {
    return this.addChild(element);
  }

  async buildChildren(): Promise<PromptChildren> {
    return await resolveBuilderChildren(this.children);
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

  append(content: ScopeContent): MessageBuilder {
    if (content instanceof PromptBuilder || content instanceof Promise) {
      return this.addChild(content);
    }
    const normalized = normalizeTextInput(content);
    return this.addChildren(normalized);
  }
}

/**
 * Fluent builder for constructing prompt trees without JSX.
 *
 * Every method returns a new immutable builder instance; large chains will copy
 * child arrays, so keep prompts reasonably sized.
 * Call `.build()` to get the final `PromptElement`.
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

  /**
   * Add a system message.
   */
  system(
    content: TextInput | ((builder: MessageBuilder) => MessageBuilder),
    opts?: { priority?: number; id?: string }
  ): PromptBuilder {
    return this.addMessage("system", content, opts);
  }

  /**
   * Add a user message.
   */
  user(
    content: TextInput | ((builder: MessageBuilder) => MessageBuilder),
    opts?: { priority?: number; id?: string }
  ): PromptBuilder {
    return this.addMessage("user", content, opts);
  }

  /**
   * Add an assistant message.
   */
  assistant(
    content: TextInput | ((builder: MessageBuilder) => MessageBuilder),
    opts?: { priority?: number; id?: string }
  ): PromptBuilder {
    return this.addMessage("assistant", content, opts);
  }

  /**
   * Add a message with a custom role.
   */
  message(
    role: PromptRole,
    content: TextInput | ((builder: MessageBuilder) => MessageBuilder),
    opts?: { priority?: number; id?: string }
  ): PromptBuilder {
    return this.addMessage(role, content, opts);
  }

  /**
   * Build the final PromptElement tree.
   */
  async build(): Promise<PromptElement> {
    return Region({
      priority: 0,
      children: await this.buildChildren(),
      ...(this.context && { context: this.context }),
    });
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
    opts?: { priority?: number; id?: string }
  ): PromptBuilder {
    const priority = opts?.priority;
    const element = createPromptElement(
      () =>
        typeof content === "function"
          ? content(new MessageBuilder([], this.context)).buildChildren()
          : normalizeTextInput(content),
      (children) =>
        Message({
          messageRole: role,
          children,
          ...(priority !== undefined ? { priority } : {}),
          ...(opts?.id ? { id: opts.id } : {}),
        })
    );

    return this.addChild(element);
  }
}

export type Prompt = PromptBuilder;

/**
 * Namespace for building prompts without JSX.
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

export function c(
  strings: TemplateStringsArray,
  ...values: readonly TextInput[]
): PromptChildren {
  const normalizedStrings = normalizeTemplateStrings(strings);
  const children: PromptChildren = [];

  for (let index = 0; index < normalizedStrings.length; index += 1) {
    const segment = normalizedStrings[index];
    if (segment.length > 0) {
      children.push(segment);
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

function createPromptElement(
  buildChildren: () => Promise<PromptChildren> | PromptChildren,
  buildElement: (children: PromptChildren) => PromptElement
): Promise<PromptElement> {
  const result = buildChildren();
  if (result instanceof Promise) {
    return result.then((children) => buildElement(children));
  }
  return Promise.resolve(buildElement(result));
}

// Normalize text-like inputs into prompt children.
function normalizeTextInput(content?: TextInput): PromptChildren {
  if (content === null || content === undefined) {
    return [];
  }

  if (Array.isArray(content)) {
    const flattened: PromptChildren = [];
    for (const item of content) {
      flattened.push(...normalizeTextInput(item));
    }
    return flattened;
  }

  if (typeof content === "string") {
    return [content];
  }

  if (typeof content === "number" || typeof content === "boolean") {
    return [String(content)];
  }

  return [content];
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

// Utility to recursively build and expand / resolve children
async function resolveBuilderChildren(
  children: BuilderChild | readonly BuilderChild[]
): Promise<PromptChildren> {
  const list = Array.isArray(children) ? children : [children];
  const resolved = await Promise.all(
    list.map(async (child) => {
      if (typeof child === "string") {
        return [child];
      }
      if (child instanceof Promise) {
        const value = await child;
        return [value];
      }
      if (child instanceof PromptBuilder) {
        return [await child.build()];
      }
      return [child];
    })
  );

  return resolved.flat();
}
