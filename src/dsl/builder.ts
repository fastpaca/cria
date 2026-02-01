/**
 * Fluent builders for constructing prompts.
 */

import type { KVMemory, VectorMemory } from "../memory";
import type {
  InputLayout,
  MessageCodec,
  ModelProvider,
  PromptInput,
} from "../provider";
import type { RenderOptions, RenderResult } from "../render";
import {
  assertValidMessageScope,
  render as renderPrompt,
  renderWithContext as renderPromptWithContext,
} from "../render";
import type {
  CacheHint,
  CriaContext,
  PromptLayout,
  PromptMessage,
  PromptMessageNode,
  PromptNode,
  PromptPart,
  PromptRole,
  PromptScope,
  PromptTree,
  ProviderToolIO,
  ToolIOForProvider,
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
import {
  isPromptPart,
  normalizeTextInput,
  type TextInput,
  textPart,
} from "./templating";
import { VectorSearch } from "./vector-search";

type PinState = "unpinned" | "pinned";

interface PinnedPrefix<P> {
  hint: CacheHint;
  priority?: number;
  children: BuilderChild<P>[];
}

/**
 * Content that can be passed to scope-level operations like truncate/omit.
 */
type AnyPromptBuilder = PromptBuilder<unknown, PinState>;

/**
 * Type flow in the DSL:
 * - P is the bound provider type (or unknown when unbound).
 * - ToolIOForProvider<P> extracts the provider's tool IO contract.
 * - PromptPart/PromptNode/etc. are all parameterized by that tool IO so tool calls
 *   stay typed from builder → tree → layout → codec.
 * - When P is unknown, ToolIOForProvider<P> resolves to "never" for tool IO,
 *   preventing tool parts until a provider is bound.
 */
type ToolIOFor<P> = ToolIOForProvider<P>;
type PromptPartFor<P> = PromptPart<ToolIOFor<P>>;
type PromptNodeFor<P> = PromptNode<ToolIOFor<P>>;
type PromptScopeFor<P> = PromptScope<ToolIOFor<P>>;
type PromptTreeFor<P> = PromptTree<ToolIOFor<P>>;
type ToolResultPartFor<P> = ToolResultPart<ToolIOFor<P>>;
type TextInputFor<P> = TextInput<ToolIOFor<P>>;
// Provider-native inputs flow through the bound provider codec into PromptLayout.
type InputFor<P> =
  P extends ModelProvider<infer TRendered, infer _TToolIO>
    ? PromptInput<TRendered>
    : never;
type InputLayoutFor<P> = InputLayout<ToolIOFor<P>>;

const DEFAULT_PIN_ID = "__cria:auto-pin__";

interface CachePinOptions {
  id?: string;
  version: string;
  scopeKey?: string;
  ttlSeconds?: number;
  priority?: number;
}

function createPinHint(opts: CachePinOptions): CacheHint {
  return {
    mode: "pin",
    id: opts.id ?? DEFAULT_PIN_ID,
    version: opts.version,
    ...(opts.scopeKey ? { scopeKey: opts.scopeKey } : {}),
    ...(opts.ttlSeconds !== undefined ? { ttlSeconds: opts.ttlSeconds } : {}),
  };
}

export type ScopeContent<P = unknown> =
  | PromptNodeFor<P>
  | PromptBuilder<P, PinState>
  | AnyPromptBuilder
  | InputFor<P>
  | InputLayoutFor<P>
  | Promise<PromptNodeFor<P>>
  | readonly ScopeContent<P>[];

/**
 * Children can include promises (async components like VectorSearch).
 * These are resolved when `.build()` resolves the tree.
 */
export type BuilderChild<P = unknown> =
  | PromptNodeFor<P>
  | PromptPartFor<P>
  | PromptBuilder<P, PinState>
  | AnyPromptBuilder
  | string
  | number
  | boolean
  | Promise<PromptNodeFor<P> | PromptPartFor<P> | string | number | boolean>;

type BoundProvider = ModelProvider<unknown, ProviderToolIO>;
// Tie a builder's provider type to the codec render output for that provider.
type RenderedForProvider<P> =
  P extends ModelProvider<infer TOutput, infer _TToolIO> ? TOutput : unknown;

/**
 * Provider binding helpers:
 * - BoundProvider captures any provider with a codec + tool IO contract.
 * - RenderedForProvider ties render() return types to a specific provider.
 * - RenderOptionsWithoutProvider omits provider when the builder is already bound.
 */
type RenderOptionsWithoutProvider<
  TRendered,
  TToolIO extends ProviderToolIO,
> = Omit<RenderOptions<TRendered, TToolIO>, "provider">;

/**
 * Shared fluent API for prompt-level and message-level builders.
 */
export abstract class BuilderBase<
  TBuilder extends BuilderBase<TBuilder, P>,
  P,
> {
  readonly children: BuilderChild<P>[];
  readonly context: CriaContext | undefined;

  protected constructor(
    children: BuilderChild<P>[] = [],
    context: CriaContext | undefined = undefined
  ) {
    this.children = children;
    this.context = context;
  }

  protected abstract create(
    children: BuilderChild<P>[],
    context: CriaContext | undefined
  ): TBuilder;

  /**
   * Merge another builder's contents into this one (zod-like merge).
   * Contexts must be compatible (either identical or undefined).
   */
  merge(...builders: TBuilder[]): TBuilder {
    const sources: BuilderBase<TBuilder, P>[] = [this, ...builders];
    let nextContext = this.context;
    const totalChildren = sources.reduce(
      (sum, builder) => sum + builder.children.length,
      0
    );
    const mergedChildren = new Array<BuilderChild<P>>(totalChildren);
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

  protected addChild(child: BuilderChild<P>): TBuilder {
    return this.create([...this.children, child], this.context);
  }

  protected addChildren(children: readonly BuilderChild<P>[]): TBuilder {
    return this.create([...this.children, ...children], this.context);
  }
}

export class MessageBuilder<P = unknown> extends BuilderBase<
  MessageBuilder<P>,
  P
> {
  constructor(
    children: BuilderChild<P>[] = [],
    context: CriaContext | undefined = undefined
  ) {
    super(children, context);
  }

  protected create(
    children: BuilderChild<P>[],
    context: CriaContext | undefined
  ): MessageBuilder<P> {
    return new MessageBuilder<P>(children, context);
  }

  append(content: TextInputFor<P>): MessageBuilder<P> {
    const normalized = normalizeTextInput<ToolIOFor<P>>(content);
    return this.addChildren(normalized);
  }

  /**
   * Add vector search results as message content (async, resolved at render time).
   */
  vectorSearch<T = unknown>(opts: {
    store: VectorMemory<T>;
    query: string;
    limit: number;
  }): MessageBuilder<P> {
    const asyncPart = VectorSearch<T, ToolIOFor<P>>({
      store: opts.store,
      query: opts.query,
      limit: opts.limit,
    }).then((scope) => {
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
  examples(title: string, items: string[]): MessageBuilder<P> {
    const element = formatExamples<ToolIOFor<P>>(title, items);
    return this.addChild(element);
  }

  async buildChildren(): Promise<PromptPartFor<P>[]> {
    return await resolveMessageChildren(this.children);
  }
}

/**
 * Fluent builder for constructing prompt trees.
 *
 * Every method returns a new immutable builder instance; large chains will copy
 * child arrays, so keep prompts reasonably sized.
 * Call `.build()` to get the final `PromptTree`.
 *
 * Cache pinning behavior:
 * - `.pin()` may only be called once and always pins the current prompt prefix.
 * - After `.pin()`, continue chaining to add the unpinned tail.
 * - `prefix(pinnedBuilder)` adopts the pinned prefix when it is the first content.
 * - Merging a pinned builder after unpinned content throws.
 */
export class PromptBuilder<
  P = unknown,
  TPinned extends PinState = "unpinned",
> extends BuilderBase<PromptBuilder<P, TPinned>, P> {
  private readonly boundProvider: BoundProvider | undefined;
  private readonly pinState: PinnedPrefix<P> | null;

  private constructor(
    children: BuilderChild<P>[] = [],
    context: CriaContext | undefined = undefined,
    provider: BoundProvider | undefined = undefined,
    pinState: PinnedPrefix<P> | null = null
  ) {
    const existingProvider = context?.provider;
    if (provider && existingProvider && provider !== existingProvider) {
      throw new Error(
        "Cannot create a prompt builder with a mismatched provider."
      );
    }
    const nextContext =
      provider && (!context || context.provider !== provider)
        ? { ...(context ?? {}), provider }
        : context;
    super(children, nextContext);
    this.boundProvider = provider;
    this.pinState = pinState;
  }

  /**
   * Create a new empty prompt builder.
   */
  static create(): PromptBuilder<unknown, "unpinned">;
  static create<TProvider extends BoundProvider>(
    provider: TProvider
  ): PromptBuilder<TProvider, "unpinned">;
  static create<TProvider extends BoundProvider>(provider?: TProvider) {
    if (!provider) {
      return new PromptBuilder();
    }
    return new PromptBuilder<TProvider, "unpinned">([], undefined, provider);
  }

  protected create(
    children: BuilderChild<P>[],
    context: CriaContext | undefined
  ): PromptBuilder<P, TPinned> {
    return new PromptBuilder<P, TPinned>(
      children,
      context,
      this.boundProvider,
      this.pinState
    );
  }

  private createUnpinned(
    children: BuilderChild<P>[],
    context: CriaContext | undefined
  ): PromptBuilder<P, "unpinned"> {
    return new PromptBuilder<P, "unpinned">(
      children,
      context,
      this.boundProvider
    );
  }

  private clonePinState(pinState: PinnedPrefix<P>): PinnedPrefix<P> {
    return { ...pinState, children: [...pinState.children] };
  }

  /**
   * Bind this prompt builder to a provider.
   * Enables provider-specific rendering without passing a provider at render time.
   * This also locks tool-call input/output types for the rest of the builder chain.
   */
  provider<TProvider extends BoundProvider, TPin extends PinState>(
    this: PromptBuilder<unknown, TPin> | PromptBuilder<TProvider, TPin>,
    modelProvider: TProvider
  ): PromptBuilder<TProvider, TPin> {
    if (this.context?.provider && this.context.provider !== modelProvider) {
      throw new Error("Cannot bind a prompt builder to a different provider.");
    }

    return PromptBuilder.create(modelProvider).merge(this);
  }

  scope(
    fn: (builder: PromptBuilder<P, "unpinned">) => PromptBuilder<P, "unpinned">,
    opts?: { id?: string }
  ): PromptBuilder<P, TPinned> {
    if (typeof fn !== "function") {
      throw new Error(
        `scope() requires a callback function. Received: ${typeof fn}`
      );
    }

    const inner = fn(this.createUnpinned([], this.context));
    const element = inner
      .buildChildren()
      .then((children) =>
        createScope<ToolIOFor<P>>(
          children,
          opts?.id ? { id: opts.id } : undefined
        )
      );

    return this.addChild(element);
  }

  /**
   * Place content at the start of the prompt.
   *
   * This is useful for provider cache pinning, which only applies to a shared
   * prompt prefix.
   */
  prefix(
    this: PromptBuilder<P, "unpinned">,
    content: PromptBuilder<P, "pinned"> | PromptBuilder<unknown, "pinned">,
    opts?: { id?: string }
  ): PromptBuilder<P, "pinned">;
  prefix(
    content: ScopeContent<P>,
    opts?: { id?: string }
  ): PromptBuilder<P, TPinned>;
  prefix(
    content: ScopeContent<P>,
    opts?: { id?: string }
  ): PromptBuilder<P, PinState> {
    if (content instanceof PromptBuilder) {
      if (content.context && this.context && content.context !== this.context) {
        throw new Error(
          "Cannot merge builders with different contexts/providers"
        );
      }

      if (content.pinState) {
        if (this.pinState) {
          throw new Error("Prompt is already pinned.");
        }

        // When prefixing a pinned builder, adopt its pinned prefix.
        const adoptedPinState = this.clonePinState(content.pinState);
        const combinedChildren = [...content.children, ...this.children];
        return new PromptBuilder<P, "pinned">(
          combinedChildren,
          this.context,
          this.boundProvider,
          adoptedPinState
        );
      }
    }

    const element = resolveScopeContent(
      content,
      this.boundProvider?.codec
    ).then((children) =>
      createScope<ToolIOFor<P>>(
        children,
        opts?.id ? { id: opts.id } : undefined
      )
    );

    if (this.pinState) {
      // Once pinned, prefix additions expand the pinned prefix itself.
      const nextPinState: PinnedPrefix<P> = {
        ...this.pinState,
        children: [element, ...this.pinState.children],
      };
      return new PromptBuilder<P, "pinned">(
        this.children,
        this.context,
        this.boundProvider,
        nextPinState
      );
    }

    return this.create([element, ...this.children], this.context);
  }

  /**
   * Add content that will be truncated when over budget.
   */
  truncate(
    content: ScopeContent<P>,
    opts: {
      budget: number;
      from?: "start" | "end";
      priority?: number;
      id?: string;
    }
  ): PromptBuilder<P, TPinned> {
    const node = resolveScopeContent(content, this.boundProvider?.codec).then(
      (children) =>
        createScope<ToolIOFor<P>>(children, {
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
    content: ScopeContent<P>,
    opts?: { priority?: number; id?: string }
  ): PromptBuilder<P, TPinned> {
    const node = resolveScopeContent(content, this.boundProvider?.codec).then(
      (children) =>
        createScope<ToolIOFor<P>>(children, {
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
   *   .providerScope(provider, (p) =>
   *     p.summary(content, { id: "conv", store })
   *   )
   * ```
   */
  providerScope<TProvider extends BoundProvider, TPin extends PinState>(
    this: PromptBuilder<unknown, TPin> | PromptBuilder<TProvider, TPin>,
    modelProvider: TProvider,
    fn: (
      builder: PromptBuilder<TProvider, "unpinned">
    ) => PromptBuilder<TProvider, "unpinned">
  ): PromptBuilder<TProvider, TPin> {
    const context: CriaContext = { provider: modelProvider };
    if (this.context?.provider && this.context.provider !== modelProvider) {
      throw new Error("Cannot bind a prompt builder to a different provider.");
    }
    const bound = this.provider(modelProvider);
    const inner = fn(PromptBuilder.create(modelProvider));

    const element = inner.buildChildren().then(
      (children): PromptScopeFor<TProvider> => ({
        kind: "scope",
        priority: 0,
        children,
        context,
      })
    );

    return bound.addChild(element);
  }

  /**
   * Add provider-native input (requires a bound provider).
   */
  input<TRendered, TToolIO extends ProviderToolIO>(
    this: PromptBuilder<ModelProvider<TRendered, TToolIO>, TPinned>,
    content: TRendered
  ): PromptBuilder<ModelProvider<TRendered, TToolIO>, TPinned> {
    const provider = this.boundProvider;
    if (!hasProvider<TRendered, TToolIO>(provider)) {
      throw new Error("Inputs require a bound provider.");
    }
    const layout = provider.codec.parse(content);
    return this.addChildren(promptLayoutToNodes(layout));
  }

  /**
   * Add a PromptLayout input.
   */
  inputLayout(content: PromptLayout<ToolIOFor<P>>): PromptBuilder<P, TPinned> {
    return this.addChildren(promptLayoutToNodes(content));
  }

  /**
   * Add vector search results (async, resolved at render time).
   */
  vectorSearch<T = unknown>(opts: {
    store: VectorMemory<T>;
    query: string;
    limit: number;
  }): PromptBuilder<P, TPinned> {
    const asyncElement = VectorSearch<T, ToolIOFor<P>>({
      store: opts.store,
      query: opts.query,
      limit: opts.limit,
    });
    return this.addChild(asyncElement);
  }

  /**
   * Add content that will be summarized when over budget.
   */
  summary(
    content: ScopeContent<P>,
    opts: {
      id: string;
      store: KVMemory<StoredSummary>;
      summarize?: Summarizer;
      priority?: number;
    }
  ): PromptBuilder<P, TPinned> {
    const element = resolveScopeContent(
      content,
      this.boundProvider?.codec
    ).then((children) =>
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
   * Mark the current builder contents as cache-pinned.
   *
   * Provide a stable id + version to control cache reuse across runs.
   * Only one pin is allowed per prompt.
   */
  pin(
    this: PromptBuilder<P, "unpinned">,
    opts: CachePinOptions
  ): PromptBuilder<P, "pinned"> {
    if (this.pinState) {
      throw new Error("Prompt is already pinned.");
    }
    if (!opts?.version) {
      throw new Error("pin() requires a version.");
    }

    const cache = createPinHint(opts);
    const pinState: PinnedPrefix<P> = {
      hint: cache,
      ...(opts?.priority !== undefined ? { priority: opts.priority } : {}),
      children: [...this.children],
    };

    // After pinning, the current children become the pinned prefix.
    // Further builder chaining appends the unpinned tail.
    return new PromptBuilder<P, "pinned">(
      [],
      this.context,
      this.boundProvider,
      pinState
    );
  }

  /**
   * Keep only the last N messages from the content.
   *
   * @example
   * ```typescript
   * cria.prompt()
   *   .system("You are helpful.")
   *   .last(conversationHistory, { n: 20 })
   *   .user("What's next?")
   * ```
   */
  last(
    content: ScopeContent<P>,
    opts: { n: number; id?: string }
  ): PromptBuilder<P, TPinned> {
    const element = resolveScopeContent(
      content,
      this.boundProvider?.codec
    ).then((children) => {
      // Filter to only message nodes and take the last N
      const messages = children.filter(
        (child): child is PromptMessageNode<ToolIOFor<P>> =>
          child.kind === "message"
      );
      const lastN = messages.slice(-opts.n);
      return createScope<ToolIOFor<P>>(
        lastN,
        opts.id ? { id: opts.id } : undefined
      );
    });

    return this.addChild(element);
  }

  /**
   * Add a raw PromptNode (escape hatch for advanced usage).
   */
  raw(
    element: PromptNodeFor<P> | Promise<PromptNodeFor<P>>
  ): PromptBuilder<P, TPinned> {
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
    this: PromptBuilder<P, "unpinned">,
    ...items: (
      | PromptBuilder<P, "unpinned">
      | PromptBuilder<unknown, "unpinned">
      | PromptNodeFor<P>
      | readonly PromptNodeFor<P>[]
    )[]
  ): PromptBuilder<P, "unpinned">;
  override merge(
    ...items: (
      | PromptBuilder<P, PinState>
      | PromptBuilder<unknown, PinState>
      | PromptNodeFor<P>
      | readonly PromptNodeFor<P>[]
    )[]
  ): PromptBuilder<P, PinState> {
    const newChildren: BuilderChild<P>[] = [...this.children];
    let nextContext = this.context;
    let nextPinState = this.pinState ? this.clonePinState(this.pinState) : null;

    const mergeBuilder = (item: PromptBuilder<unknown, PinState>): void => {
      if (item.context && nextContext && item.context !== nextContext) {
        throw new Error(
          "Cannot merge builders with different contexts/providers"
        );
      }
      if (!nextContext) {
        nextContext = item.context;
      }

      if (item.pinState) {
        if (nextPinState) {
          throw new Error("Prompt is already pinned.");
        }
        if (newChildren.length > 0) {
          throw new Error(
            "Cannot merge a pinned prompt after unpinned content."
          );
        }
        nextPinState = this.clonePinState(item.pinState);
      }

      newChildren.push(...item.children);
    };

    for (const item of items) {
      if (item instanceof PromptBuilder) {
        mergeBuilder(item);
        continue;
      }

      if (Array.isArray(item)) {
        for (const node of item) {
          newChildren.push(node);
        }
        continue;
      }

      if (isPromptNode<ToolIOFor<P>>(item)) {
        newChildren.push(item);
      }
    }

    return new PromptBuilder<P, PinState>(
      newChildren,
      nextContext,
      this.boundProvider,
      nextPinState
    );
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
    fn: (builder: PromptBuilder<P, TPinned>) => PromptBuilder<P, TPinned>
  ): PromptBuilder<P, TPinned> {
    return condition ? fn(this) : this;
  }

  /**
   * Add a system message.
   */
  system(
    content:
      | TextInputFor<P>
      | ((builder: MessageBuilder<P>) => MessageBuilder<P>),
    opts?: { id?: string }
  ): PromptBuilder<P, TPinned> {
    return this.addMessage("system", content, opts);
  }

  /**
   * Add a developer message.
   */
  developer(
    content:
      | TextInputFor<P>
      | ((builder: MessageBuilder<P>) => MessageBuilder<P>),
    opts?: { id?: string }
  ): PromptBuilder<P, TPinned> {
    return this.addMessage("developer", content, opts);
  }

  /**
   * Add a user message.
   */
  user(
    content:
      | TextInputFor<P>
      | ((builder: MessageBuilder<P>) => MessageBuilder<P>),
    opts?: { id?: string }
  ): PromptBuilder<P, TPinned> {
    return this.addMessage("user", content, opts);
  }

  /**
   * Add an assistant message.
   */
  assistant(
    content:
      | TextInputFor<P>
      | ((builder: MessageBuilder<P>) => MessageBuilder<P>),
    opts?: { id?: string }
  ): PromptBuilder<P, TPinned> {
    return this.addMessage("assistant", content, opts);
  }

  /**
   * Add a tool result message.
   */
  tool<TProvider extends BoundProvider>(
    this: PromptBuilder<TProvider, TPinned>,
    result:
      | ToolResultPartFor<TProvider>
      | readonly ToolResultPartFor<TProvider>[],
    opts?: { id?: string }
  ): PromptBuilder<TProvider, TPinned> {
    if (!this.boundProvider) {
      throw new Error(
        "Tool results require a bound provider. Bind one with cria.prompt(provider) or cria.prompt().provider(provider)."
      );
    }
    const children = Array.isArray(result) ? [...result] : [result];
    const element = createMessage<ToolIOFor<TProvider>>(
      "tool",
      children,
      opts?.id
    );
    return this.addChild(element);
  }

  /**
   * Add a message with a custom role.
   */
  message(
    role: PromptRole,
    content:
      | TextInputFor<P>
      | ((builder: MessageBuilder<P>) => MessageBuilder<P>),
    opts?: { id?: string }
  ): PromptBuilder<P, TPinned> {
    return this.addMessage(role, content, opts);
  }

  async buildChildren(): Promise<PromptNodeFor<P>[]> {
    const resolvedChildren = await resolveScopeChildren(this.children);
    if (!this.pinState) {
      return resolvedChildren;
    }

    // The pinned prefix is emitted as the first scope in the tree,
    // followed by any unpinned tail content.
    const pinnedChildren = await resolveScopeChildren(this.pinState.children);
    const pinnedScope = createScope<ToolIOFor<P>>(pinnedChildren, {
      cache: this.pinState.hint,
      ...(this.pinState.priority !== undefined
        ? { priority: this.pinState.priority }
        : {}),
    });

    return [pinnedScope, ...resolvedChildren];
  }

  /**
   * Build the final PromptTree.
   */
  async build(): Promise<PromptTreeFor<P>> {
    const element: PromptScopeFor<P> = {
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
   *
   * Overloads:
   * - Bound builder: provider is implicit.
   * - Unbound builder: provider must be supplied to establish tool IO types.
   */
  async render<TProvider extends BoundProvider>(
    this: PromptBuilder<TProvider, PinState>,
    options?: RenderOptionsWithoutProvider<
      RenderedForProvider<TProvider>,
      ToolIOForProvider<TProvider>
    >
  ): Promise<RenderedForProvider<TProvider>>;
  async render<TProvider extends BoundProvider>(
    this: PromptBuilder<unknown, PinState>,
    options: RenderOptions<
      RenderedForProvider<TProvider>,
      ToolIOForProvider<TProvider>
    > & { provider: TProvider }
  ): Promise<RenderedForProvider<TProvider>>;
  async render(
    options?: RenderOptions<unknown, ProviderToolIO>
  ): Promise<unknown> {
    const element = await this.build();
    const providerOverride = options?.provider;
    if (providerOverride) {
      return await renderPrompt(element, {
        ...(options ?? {}),
        provider: providerOverride,
      });
    }

    if (!this.boundProvider) {
      throw new Error(
        "Rendering requires a provider. Bind one with cria.prompt(provider) or cria.prompt().provider(provider), or pass a provider to render()."
      );
    }

    return await renderPrompt(element, {
      ...(options ?? {}),
      provider: this.boundProvider,
    });
  }

  /**
   * Render the prompt and return the output alongside its render context.
   * Equivalent to `renderWithContext(await builder.build(), options)`.
   */
  async renderWithContext<TProvider extends BoundProvider>(
    this: PromptBuilder<TProvider, PinState>,
    options?: RenderOptionsWithoutProvider<
      RenderedForProvider<TProvider>,
      ToolIOForProvider<TProvider>
    >
  ): Promise<RenderResult<RenderedForProvider<TProvider>>>;
  async renderWithContext<TProvider extends BoundProvider>(
    this: PromptBuilder<unknown, PinState>,
    options: RenderOptions<
      RenderedForProvider<TProvider>,
      ToolIOForProvider<TProvider>
    > & { provider: TProvider }
  ): Promise<RenderResult<RenderedForProvider<TProvider>>>;
  async renderWithContext(
    options?: RenderOptions<unknown, ProviderToolIO>
  ): Promise<RenderResult<unknown>> {
    const element = await this.build();
    const providerOverride = options?.provider;
    if (providerOverride) {
      return await renderPromptWithContext(element, {
        ...(options ?? {}),
        provider: providerOverride,
      });
    }

    if (!this.boundProvider) {
      throw new Error(
        "Rendering requires a provider. Bind one with cria.prompt(provider) or cria.prompt().provider(provider), or pass a provider to render()."
      );
    }

    return await renderPromptWithContext(element, {
      ...(options ?? {}),
      provider: this.boundProvider,
    });
  }

  private addMessage(
    role: PromptRole,
    content:
      | TextInputFor<P>
      | ((builder: MessageBuilder<P>) => MessageBuilder<P>),
    opts?: { id?: string }
  ): PromptBuilder<P, TPinned> {
    // Normalize text-like inputs into typed parts so tool IO stays provider-bound.
    const childrenPromise =
      typeof content === "function"
        ? content(new MessageBuilder<P>([], this.context)).buildChildren()
        : Promise.resolve(normalizeTextInput<ToolIOFor<P>>(content));

    const element = childrenPromise.then((children) =>
      createMessage<ToolIOFor<P>>(role, children, opts?.id)
    );

    return this.addChild(element);
  }
}

/**
 * Prompt type alias for external use.
 */
export type Prompt<P = unknown> = PromptBuilder<P, PinState>;

// Resolution functions (colocated with builders).
// They resolve async children and enforce message/scope boundaries early.
// This avoids deferred checks and ensures type safety at build time.

function isPromptNode<TToolIO extends ProviderToolIO>(
  value: unknown
): value is PromptNode<TToolIO> {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  if (!("kind" in value)) {
    return false;
  }
  const kind = (value as { kind?: unknown }).kind;
  return kind === "scope" || kind === "message";
}

async function resolveMessageChildren<P>(
  children: BuilderChild<P> | readonly BuilderChild<P>[]
): Promise<PromptPartFor<P>[]> {
  const list = Array.isArray(children) ? children : [children];
  const resolved = await Promise.all(
    list.map((child) => resolveBuilderChild(child, "message"))
  );

  return resolved.flat();
}

async function resolveScopeChildren<P>(
  children: BuilderChild<P> | readonly BuilderChild<P>[]
): Promise<PromptNodeFor<P>[]> {
  const list = Array.isArray(children) ? children : [children];
  const resolved = await Promise.all(
    list.map((child) => resolveBuilderChild(child, "scope"))
  );

  return resolved.flat();
}

async function resolveScopeContent<P>(
  content: ScopeContent<P>,
  codec: MessageCodec<unknown, ProviderToolIO> | null | undefined
): Promise<PromptNodeFor<P>[]> {
  // Scope content can be trees, builders, layouts, or provider-native inputs.
  // Provider-native inputs are decoded back into PromptLayout via the codec.
  if (content instanceof PromptBuilder) {
    const built = await content.build();
    const nodes: PromptNodeFor<P>[] = [];
    // Extract children so strategies operate on individual items, not a wrapper scope
    for (const child of built.children) {
      if (!isPromptNode<ToolIOFor<P>>(child)) {
        throw new Error("Scope content must be prompt nodes.");
      }
      nodes.push(child);
    }
    return nodes;
  }

  if (content instanceof Promise) {
    const value = await content;
    return await resolveScopeContent(value as ScopeContent<P>, codec);
  }

  if (Array.isArray(content)) {
    const resolved = await Promise.all(
      content.map((item) => resolveScopeContent<P>(item, codec))
    );
    return resolved.flat();
  }

  if (isPromptNode<ToolIOFor<P>>(content)) {
    return [content];
  }

  if (isInputLayout<ToolIOFor<P>>(content)) {
    return promptLayoutToNodes(content.value);
  }

  if (isPromptInput<RenderedForProvider<P>>(content)) {
    if (!isCodecForInput<P>(codec, content)) {
      throw new Error("Inputs require a provider with a codec.");
    }
    return resolveInputContent<P>(content, codec);
  }

  throw new Error(
    "Scope content must be prompt nodes, prompt builders, or input wrappers."
  );
}

function resolveInputContent<P>(
  content: PromptInput<RenderedForProvider<P>>,
  codec: MessageCodec<RenderedForProvider<P>, ToolIOFor<P>>
): PromptNodeFor<P>[] {
  const layout = codec.parse(content.value);
  return promptLayoutToNodes(layout);
}

// Type-only narrowing: codec comes from the bound provider.
function isCodecForInput<P>(
  codec: MessageCodec<unknown, ProviderToolIO> | null | undefined,
  _content: PromptInput<RenderedForProvider<P>>
): codec is MessageCodec<RenderedForProvider<P>, ToolIOFor<P>> {
  return Boolean(codec);
}

function promptLayoutToNodes<TToolIO extends ProviderToolIO>(
  layout: PromptLayout<TToolIO>
): PromptMessageNode<TToolIO>[] {
  return layout.map((message) => promptMessageToNode(message));
}

function promptMessageToNode<TToolIO extends ProviderToolIO>(
  message: PromptMessage<TToolIO>
): PromptMessageNode<TToolIO> {
  if (message.role === "tool") {
    const part: ToolResultPart<TToolIO> = {
      type: "tool-result",
      toolCallId: message.toolCallId,
      toolName: message.toolName,
      output: message.output,
    };
    return createMessage<TToolIO>("tool", [part]);
  }

  if (message.role === "assistant") {
    const parts: PromptPart<TToolIO>[] = [];
    if (message.text) {
      parts.push(textPart<TToolIO>(message.text));
    }
    if (message.reasoning) {
      parts.push({ type: "reasoning", text: message.reasoning });
    }
    if (message.toolCalls) {
      parts.push(...message.toolCalls);
    }
    return createMessage<TToolIO>("assistant", parts);
  }

  const parts = message.text ? [textPart<TToolIO>(message.text)] : [];
  return createMessage<TToolIO>(message.role, parts);
}

function isInputLayout<TToolIO extends ProviderToolIO>(
  value: unknown
): value is InputLayout<TToolIO> {
  return hasKind(value) && value.kind === "input-layout";
}

function isPromptInput<TRendered>(
  value: unknown
): value is PromptInput<TRendered> {
  return hasKind(value) && value.kind === "input";
}

function hasKind(value: unknown): value is { kind: unknown } {
  return typeof value === "object" && value !== null && "kind" in value;
}

// Narrow a bound provider so codec usage preserves render/tool IO types.
function hasProvider<TRendered, TToolIO extends ProviderToolIO>(
  provider: BoundProvider | undefined
): provider is ModelProvider<TRendered, TToolIO> {
  return Boolean(provider);
}

async function resolveBuilderChild<P>(
  child: BuilderChild<P>,
  target: "message"
): Promise<PromptPartFor<P>[]>;
async function resolveBuilderChild<P>(
  child: BuilderChild<P>,
  target: "scope"
): Promise<PromptNodeFor<P>[]>;
async function resolveBuilderChild<P>(
  child: BuilderChild<P>,
  target: "message" | "scope"
): Promise<PromptPartFor<P>[] | PromptNodeFor<P>[]> {
  const resolved = await resolveBuilderChildPromise(child);

  if (target === "message") {
    return resolveMessageChild(resolved);
  }

  return await resolveScopeChild(resolved);
}

async function resolveBuilderChildPromise<P>(
  child: BuilderChild<P>
): Promise<BuilderChild<P>> {
  if (child instanceof Promise) {
    return await child;
  }
  return child;
}

function resolveMessageChild<P>(child: BuilderChild<P>): PromptPartFor<P>[] {
  if (child instanceof PromptBuilder) {
    throw new Error("Prompt builders cannot be nested inside messages.");
  }

  if (typeof child === "string") {
    return [textPart<ToolIOFor<P>>(child)];
  }

  if (typeof child === "number" || typeof child === "boolean") {
    return [textPart<ToolIOFor<P>>(String(child))];
  }

  if (isPromptPart<ToolIOFor<P>>(child)) {
    return [child];
  }

  if (isPromptNode<ToolIOFor<P>>(child)) {
    throw new Error("Prompt nodes are not allowed inside messages.");
  }

  throw new Error("Unsupported child type.");
}

async function resolveScopeChild<P>(
  child: BuilderChild<P>
): Promise<PromptNodeFor<P>[]> {
  if (child instanceof PromptBuilder) {
    const built = await child.build();
    if (!isPromptNode<ToolIOFor<P>>(built)) {
      throw new Error("Scope content must be prompt nodes.");
    }
    return [built];
  }

  if (
    typeof child === "string" ||
    typeof child === "number" ||
    typeof child === "boolean"
  ) {
    throw new Error("Text nodes are only allowed inside messages.");
  }

  if (isPromptPart<ToolIOFor<P>>(child)) {
    throw new Error("Message parts are only allowed inside messages.");
  }

  if (isPromptNode<ToolIOFor<P>>(child)) {
    return [child];
  }

  throw new Error("Unsupported child type.");
}
