/**
 * Fluent builders for constructing prompts.
 */

import type { InputLayout, ModelProvider } from "../provider";
import type { RenderOptions } from "../render";
import { assertValidMessageScope, render as renderPrompt } from "../render";
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
import {
  isPromptPart,
  normalizeTextInput,
  type TextInput,
  textPart,
} from "./templating";

type PinState = "unpinned" | "pinned";

interface PinnedPrefix<P> {
  hint: CacheHint;
  priority?: number;
  children: ScopeChild<P>[];
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
  | InputLayoutFor<P>
  | Promise<PromptNodeFor<P>>
  | readonly ScopeContent<P>[];

export interface PromptPlugin<P = unknown> {
  render(): ScopeContent<P> | Promise<ScopeContent<P>>;
}

/**
 * Message-level children (text + parts).
 */
type MessageChildValue<P> =
  | PromptPartFor<P>
  | string
  | number
  | boolean
  | readonly MessageChildValue<P>[];
type MessageChild<P> = MessageChildValue<P> | Promise<MessageChildValue<P>>;

/**
 * Prompt-level children (scopes + messages).
 * Includes promises and node fragments (async components like plugins).
 */
type ScopeChildValue<P> =
  | PromptNodeFor<P>
  | PromptBuilder<P, PinState>
  | AnyPromptBuilder
  | readonly PromptNodeFor<P>[];
type ScopeChild<P> =
  | ScopeChildValue<P>
  | Promise<PromptNodeFor<P> | readonly PromptNodeFor<P>[]>;

export type BuilderChild<P = unknown> = ScopeChild<P>;

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
  TBuilder extends BuilderBase<TBuilder, P, TChild>,
  P,
  TChild,
> {
  readonly children: TChild[];
  readonly context: CriaContext | undefined;

  protected constructor(
    children: TChild[] = [],
    context: CriaContext | undefined = undefined
  ) {
    this.children = children;
    this.context = context;
  }

  protected abstract create(
    children: TChild[],
    context: CriaContext | undefined
  ): TBuilder;

  /**
   * Merge another builder's contents into this one (zod-like merge).
   * Contexts must be compatible (either identical or undefined).
   */
  merge(...builders: TBuilder[]): TBuilder {
    const sources: BuilderBase<TBuilder, P, TChild>[] = [this, ...builders];
    let nextContext = this.context;
    const totalChildren = sources.reduce(
      (sum, builder) => sum + builder.children.length,
      0
    );
    const mergedChildren = new Array<TChild>(totalChildren);
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

  protected addChild(child: TChild): TBuilder {
    return this.create([...this.children, child], this.context);
  }

  protected addChildren(children: readonly TChild[]): TBuilder {
    return this.create([...this.children, ...children], this.context);
  }
}

export class MessageBuilder<P = unknown> extends BuilderBase<
  MessageBuilder<P>,
  P,
  MessageChild<P>
> {
  constructor(
    children: MessageChild<P>[] = [],
    context: CriaContext | undefined = undefined
  ) {
    super(children, context);
  }

  protected create(
    children: MessageChild<P>[],
    context: CriaContext | undefined
  ): MessageBuilder<P> {
    return new MessageBuilder<P>(children, context);
  }

  append(content: TextInputFor<P>): MessageBuilder<P> {
    const normalized = normalizeTextInput<ToolIOFor<P>>(content);
    return this.addChildren(normalized);
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
> extends BuilderBase<PromptBuilder<P, TPinned>, P, ScopeChild<P>> {
  private readonly boundProvider: BoundProvider | undefined;
  private readonly pinState: PinnedPrefix<P> | null;

  private constructor(
    children: ScopeChild<P>[] = [],
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
    children: ScopeChild<P>[],
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
    children: ScopeChild<P>[],
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
    const element = (async (): Promise<PromptScopeFor<P>> => {
      const children = await inner.buildChildren();
      return createScope<ToolIOFor<P>>(
        children,
        opts?.id ? { id: opts.id } : undefined
      );
    })();

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

    const element = (async (): Promise<PromptScopeFor<P>> => {
      const children = await resolveScopeContent(content);
      return createScope<ToolIOFor<P>>(
        children,
        opts?.id ? { id: opts.id } : undefined
      );
    })();

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
    const node = (async (): Promise<PromptScopeFor<P>> => {
      const children = await resolveScopeContent(content);
      return createScope<ToolIOFor<P>>(children, {
        ...(opts.priority !== undefined && { priority: opts.priority }),
        strategy: createTruncateStrategy(opts.budget, opts.from ?? "start"),
        ...(opts.id && { id: opts.id }),
      });
    })();

    return this.addChild(node);
  }

  /**
   * Add content that will be entirely removed when over budget.
   */
  omit(
    content: ScopeContent<P>,
    opts?: { priority?: number; id?: string }
  ): PromptBuilder<P, TPinned> {
    const node = (async (): Promise<PromptScopeFor<P>> => {
      const children = await resolveScopeContent(content);
      return createScope<ToolIOFor<P>>(children, {
        ...(opts?.priority !== undefined && { priority: opts.priority }),
        strategy: createOmitStrategy(),
        ...(opts?.id && { id: opts.id }),
      });
    })();

    return this.addChild(node);
  }

  /**
   * Create a provider scope for AI-powered operations like summaries.
   *
   * @example
   * ```typescript
   * import { cria } from "@fastpaca/cria";
   * import { createProvider } from "@fastpaca/cria/ai-sdk";
   * import { openai } from "@ai-sdk/openai";
   *
   * const provider = createProvider(openai("gpt-4o"));
   * const summarizer = cria.summarizer({ id: "conv", store, provider });
   * cria.prompt()
   *   .providerScope(provider, (p) =>
   *     p.use(summarizer.plugin({ history: content }))
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

    const element = (async (): Promise<PromptScopeFor<TProvider>> => {
      const children = await inner.buildChildren();
      return {
        kind: "scope",
        priority: 0,
        children,
        context,
      };
    })();

    return bound.addChild(element);
  }

  /**
   * Add a PromptLayout input.
   */
  inputLayout(content: PromptLayout<ToolIOFor<P>>): PromptBuilder<P, TPinned> {
    return this.addChildren(promptLayoutToNodes(content));
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
    const element = (async (): Promise<PromptScopeFor<P>> => {
      const children = await resolveScopeContent(content);
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
    })();

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
    const newChildren: ScopeChild<P>[] = [...this.children];
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

      newChildren.push(item);
    }

    return new PromptBuilder<P, PinState>(
      newChildren,
      nextContext,
      this.boundProvider,
      nextPinState
    );
  }

  /**
   * Insert a prompt plugin at the current position.
   */
  use(plugin: PromptPlugin<P>): PromptBuilder<P, TPinned> {
    if (!plugin || typeof plugin.render !== "function") {
      throw new Error("use() requires a plugin with a render() method.");
    }

    const element = (async (): Promise<PromptNodeFor<P>[]> => {
      const content = await plugin.render();
      return await resolveScopeContent(content);
    })();

    return this.addChild(element);
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

  private addMessage(
    role: PromptRole,
    content:
      | TextInputFor<P>
      | ((builder: MessageBuilder<P>) => MessageBuilder<P>),
    opts?: { id?: string }
  ): PromptBuilder<P, TPinned> {
    // Normalize text-like inputs into typed parts so tool IO stays provider-bound.
    const element = (async (): Promise<PromptMessageNode<ToolIOFor<P>>> => {
      const children =
        typeof content === "function"
          ? await content(
              new MessageBuilder<P>([], this.context)
            ).buildChildren()
          : normalizeTextInput<ToolIOFor<P>>(content);
      return createMessage<ToolIOFor<P>>(role, children, opts?.id);
    })();

    return this.addChild(element);
  }
}

/**
 * Prompt type alias for external use.
 */
export type Prompt<P = unknown> = PromptBuilder<P, PinState>;

// Resolution functions (colocated with builders).
// They resolve async children and normalize message/scope content.

async function resolveMessageChildren<P>(
  children: MessageChild<P> | readonly MessageChild<P>[]
): Promise<PromptPartFor<P>[]> {
  const list = Array.isArray(children) ? children : [children];
  const resolved: PromptPartFor<P>[] = [];

  for (const child of list) {
    const parts = await resolveMessageChild(child);
    resolved.push(...parts);
  }

  return resolved;
}

async function resolveScopeChildren<P>(
  children: ScopeChild<P> | readonly ScopeChild<P>[]
): Promise<PromptNodeFor<P>[]> {
  const list = Array.isArray(children) ? children : [children];
  const resolved: PromptNodeFor<P>[] = [];

  for (const child of list) {
    const nodes = await resolveScopeChild(child);
    resolved.push(...nodes);
  }

  return resolved;
}

export async function resolveScopeContent<P>(
  content: ScopeContent<P>
): Promise<PromptNodeFor<P>[]> {
  // Scope content can be trees, builders, and prompt layouts.
  if (content instanceof PromptBuilder) {
    const built = await content.build();
    return [...built.children];
  }

  if (content instanceof Promise) {
    return await resolveScopeContent(await content);
  }

  if (Array.isArray(content)) {
    const resolved: PromptNodeFor<P>[] = [];
    for (const item of content) {
      resolved.push(...(await resolveScopeContent<P>(item)));
    }
    return resolved;
  }

  if (isPromptNode<ToolIOFor<P>>(content)) {
    return [content];
  }

  if (isInputLayout<ToolIOFor<P>>(content)) {
    return promptLayoutToNodes(content.value);
  }

  throw new Error(
    "Scope content must be prompt nodes, prompt builders, or input layouts."
  );
}

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

function isInputLayout<TToolIO extends ProviderToolIO>(
  value: unknown
): value is InputLayout<TToolIO> {
  return hasKind(value) && value.kind === "input-layout";
}

function hasKind(value: unknown): value is { kind: unknown } {
  return typeof value === "object" && value !== null && "kind" in value;
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

async function resolveChild<T>(child: T | Promise<T>): Promise<T> {
  if (child instanceof Promise) {
    return await child;
  }
  return child;
}

async function resolveMessageChild<P>(
  child: MessageChild<P>
): Promise<PromptPartFor<P>[]> {
  const resolved = await resolveChild(child);

  if (Array.isArray(resolved)) {
    return await resolveMessageChildren(resolved);
  }

  if (typeof resolved === "string") {
    return [textPart<ToolIOFor<P>>(resolved)];
  }

  if (typeof resolved === "number" || typeof resolved === "boolean") {
    return [textPart<ToolIOFor<P>>(String(resolved))];
  }

  if (isPromptPart<ToolIOFor<P>>(resolved)) {
    return [resolved];
  }

  throw new Error("Message content must be text or message parts.");
}

async function resolveScopeChild<P>(
  child: ScopeChild<P>
): Promise<PromptNodeFor<P>[]> {
  const resolved = await resolveChild(child);

  if (Array.isArray(resolved)) {
    return await resolveScopeChildren(resolved);
  }

  if (resolved instanceof PromptBuilder) {
    const built = await resolved.build();
    return [built];
  }

  if (isPromptNode<ToolIOFor<P>>(resolved)) {
    return [resolved];
  }

  throw new Error("Scope content must be prompt nodes or prompt builders.");
}
