/**
 * Fluent DSL for building prompts without JSX.
 *
 * @example
 * ```typescript
 * import { cria, render } from "@fastpaca/cria";
 *
 * const prompt = cria
 *   .prompt()
 *   .system("You are a helpful assistant.")
 *   .user("What is the capital of France?")
 *   .build();
 *
 * const result = await render(prompt, { tokenizer, budget: 4000, renderer });
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
  PromptChildren,
  PromptElement,
  PromptRole,
} from "./types";

/**
 * Children can include promises (async components like VectorSearch).
 * These are resolved when `.build()` resolves the tree.
 */
type BuilderChild =
  | PromptElement
  | PromptBuilder
  | string
  | Promise<PromptElement>
  | Promise<string>;

type RenderResult<TOptions extends RenderOptions> = TOptions extends {
  renderer: import("./types").PromptRenderer<infer TOutput>;
}
  ? TOutput
  : string;

/**
 * Fluent builder for constructing prompt trees without JSX.
 *
 * Every method returns a new immutable builder instance.
 * Call `.build()` to get the final `PromptElement`.
 */
export class PromptBuilder {
  private readonly children: BuilderChild[];
  private readonly context?: CriaContext;

  private constructor(children: BuilderChild[] = [], context?: CriaContext) {
    this.children = children;
    this.context = context;
  }

  /**
   * Create a new empty prompt builder.
   */
  static create(): PromptBuilder {
    return new PromptBuilder();
  }

  // ─── Messages ───────────────────────────────────────────────

  /**
   * Add a system message.
   */
  system(text: string, opts?: { priority?: number }): PromptBuilder {
    return this.addChild(
      Message({
        messageRole: "system",
        children: [text],
        priority: opts?.priority,
      })
    );
  }

  /**
   * Add a user message.
   */
  user(text: string, opts?: { priority?: number }): PromptBuilder {
    return this.addChild(
      Message({
        messageRole: "user",
        children: [text],
        priority: opts?.priority,
      })
    );
  }

  /**
   * Add an assistant message.
   */
  assistant(text: string, opts?: { priority?: number }): PromptBuilder {
    return this.addChild(
      Message({
        messageRole: "assistant",
        children: [text],
        priority: opts?.priority,
      })
    );
  }

  /**
   * Add a message with a custom role.
   */
  message(
    role: PromptRole,
    text: string,
    opts?: { priority?: number }
  ): PromptBuilder {
    return this.addChild(
      Message({
        messageRole: role,
        children: [text],
        priority: opts?.priority,
      })
    );
  }

  // ─── Strategies ─────────────────────────────────────────────

  /**
   * Add content that will be truncated when over budget.
   */
  truncate(
    content: string | PromptElement | PromptBuilder,
    opts: { budget: number; from?: "start" | "end"; priority?: number }
  ): PromptBuilder {
    const node = (async (): Promise<PromptElement> => {
      const children = await this.resolveContent(content);
      return Truncate({
        children,
        budget: opts.budget,
        from: opts.from,
        priority: opts.priority,
      });
    })();

    return this.addChild(node);
  }

  /**
   * Add content that will be entirely removed when over budget.
   */
  omit(
    content: string | PromptElement | PromptBuilder,
    opts?: { priority?: number }
  ): PromptBuilder {
    const node = (async (): Promise<PromptElement> => {
      const children = await this.resolveContent(content);
      return Omit({ children, priority: opts?.priority });
    })();

    return this.addChild(node);
  }

  // ─── Sections ───────────────────────────────────────────────

  /**
   * Create a nested section.
   *
   * @example Anonymous section
   * ```typescript
   * .section((s) => s.truncate(content, { budget: 1000 }))
   * ```
   *
   * @example Named section
   * ```typescript
   * .section("context", (s) => s.truncate(content, { budget: 1000 }))
   * ```
   */
  section(fn: (builder: PromptBuilder) => PromptBuilder): PromptBuilder;
  region(fn: (builder: PromptBuilder) => PromptBuilder): PromptBuilder;
  region(
    name: string,
    fn: (builder: PromptBuilder) => PromptBuilder
  ): PromptBuilder;
  region(
    nameOrFn: string | ((builder: PromptBuilder) => PromptBuilder),
    maybeFn?: (builder: PromptBuilder) => PromptBuilder
  ): PromptBuilder {
    if (typeof nameOrFn === "string") {
      if (!maybeFn) {
        throw new Error("region() requires a callback function");
      }
      return this.section(nameOrFn, maybeFn);
    }

    return this.section(nameOrFn);
  }

  /**
   * Create a nested section/region.
   *
   * @example Anonymous section
   * ```typescript
   * .section((s) => s.truncate(content, { budget: 1000 }))
   * ```
   *
   * @example Named section
   * ```typescript
   * .section("context", (s) => s.truncate(content, { budget: 1000 }))
   * ```
   */
  section(fn: (builder: PromptBuilder) => PromptBuilder): PromptBuilder;
  section(
    name: string,
    fn: (builder: PromptBuilder) => PromptBuilder
  ): PromptBuilder;
  section(
    nameOrFn: string | ((builder: PromptBuilder) => PromptBuilder),
    maybeFn?: (builder: PromptBuilder) => PromptBuilder
  ): PromptBuilder {
    const name = typeof nameOrFn === "string" ? nameOrFn : undefined;
    const fn = typeof nameOrFn === "string" ? maybeFn : nameOrFn;

    if (!fn) {
      const received = typeof nameOrFn === "string" ? typeof maybeFn : typeof nameOrFn;
      throw new Error(
        `section() requires a callback function (e.g. cria.prompt().section("name", (s) => ...)). Received: ${received}`
      );
    }

    const inner = fn(new PromptBuilder([], this.context));

    const element = (async (): Promise<PromptElement> => {
      const built = await inner.build();
      return {
        ...built,
        ...(name ? { id: name } : {}),
      };
    })();

    return this.addChild(element);
  }

  /**
   * Merge another builder's contents into this one (zod-like merge).
   * Contexts must be compatible (either identical or undefined).
   */
  merge(...builders: PromptBuilder[]): PromptBuilder {
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

    return new PromptBuilder(mergedChildren, nextContext);
  }

  // ─── Provider/Context ───────────────────────────────────────

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
    fn: (builder: PromptBuilder) => PromptBuilder
  ): PromptBuilder {
    const context: CriaContext = { provider: modelProvider };
    const inner = fn(new PromptBuilder([], context));

    const element = (async (): Promise<PromptElement> => {
      const built = await inner.build();
      return {
        priority: 0,
        children: built.children,
        context,
      };
    })();

    return this.addChild(element);
  }

  // ─── Async Components ───────────────────────────────────────

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
    const asyncElement = VectorSearch<T>({
      store: opts.store,
      query: opts.query,
      limit: opts.limit,
      threshold: opts.threshold,
      formatResults: opts.formatter,
      priority: opts.priority,
      id: opts.id,
    });
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
  ): PromptBuilder {
    const element = (async (): Promise<PromptElement> => {
      const children = await this.resolveContent(content);
      return Summary({
        id: opts.id,
        store: opts.store,
        summarize: opts.summarize,
        children,
        priority: opts.priority,
      });
    })();

    return this.addChild(element);
  }

  // ─── Utilities ──────────────────────────────────────────────

  /**
   * Add a formatted list of examples.
   */
  examples(
    title: string,
    items: (string | PromptElement)[],
    opts?: { priority?: number }
  ): PromptBuilder {
    return this.addChild(
      Examples({ title, children: items, priority: opts?.priority })
    );
  }

  /**
   * Add a raw PromptElement (escape hatch for advanced usage).
   */
  raw(element: PromptElement | Promise<PromptElement>): PromptBuilder {
    return this.addChild(element);
  }

  // ─── Terminal ───────────────────────────────────────────────

  /**
   * Build the final PromptElement tree.
   */
  async build(): Promise<PromptElement> {
    return Region({
      priority: 0,
      children: await normalizeChildren(this.children),
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

  // ─── Private ────────────────────────────────────────────────

  private addChild(child: BuilderChild): PromptBuilder {
    return new PromptBuilder([...this.children, child], this.context);
  }

  private resolveContent(
    content: string | PromptElement | PromptBuilder
  ): Promise<PromptChildren> {
    return normalizeContent(content);
  }
}

// ─── Entry Points ─────────────────────────────────────────────

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
  merge: (...builders: PromptBuilder[]) => {
    if (builders.length === 0) {
      return PromptBuilder.create();
    }
    const [first, ...rest] = builders;
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

async function normalizeContent(
  content: string | PromptElement | PromptBuilder
): Promise<PromptChildren> {
  if (typeof content === "string") {
    return [content];
  }

  if (content instanceof PromptBuilder) {
    const built = await content.build();
    return [built];
  }

  return [content];
}

async function normalizeChild(child: BuilderChild): Promise<PromptChildren> {
  if (typeof child === "string") {
    return [child];
  }

  if (child instanceof Promise) {
    const resolved = await child;
    if (typeof resolved === "string") {
      return [resolved];
    }
    return [resolved];
  }

  if (child instanceof PromptBuilder) {
    const built = await child.build();
    return [built];
  }

  return [child];
}

async function normalizeChildren(
  children: readonly BuilderChild[]
): Promise<PromptChildren> {
  const normalized = await Promise.all(children.map((child) => normalizeChild(child)));
  return normalized.flat();
}
