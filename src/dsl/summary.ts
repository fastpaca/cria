/**
 * Summary strategy for progressively summarizing conversation history.
 */

import type { KVMemory } from "../memory";
import type { ModelProvider } from "../provider";
import { render } from "../render";
import type {
  MaybePromise,
  PromptRole,
  PromptScope,
  ProviderToolIO,
  StrategyInput,
} from "../types";
import {
  PromptBuilder,
  type PromptPlugin,
  resolveScopeContent,
  type ScopeContent,
} from "./builder";
import { createMessage, createScope } from "./strategies";
import { textPart } from "./templating";

/**
 * Stored summary data persisted across renders.
 */
export interface StoredSummary {
  /** The summary text content */
  content: string;
}

/**
 * Context passed to the summarizer function.
 */
export interface SummarizerContext {
  /** The subtree being summarized */
  target: PromptScope<ProviderToolIO>;
  /** Previous summary to build upon (null if first summary) */
  existingSummary: string | null;
  /** Provider in scope, if any */
  provider?: ModelProvider<unknown, ProviderToolIO>;
}

/**
 * Function that generates summaries.
 */
export type Summarizer = (ctx: SummarizerContext) => MaybePromise<string>;

/**
 * Default summarizer that uses a ModelProvider.
 * This is used when no custom summarize function is provided.
 */
async function defaultSummarizer(
  ctx: SummarizerContext,
  provider: ModelProvider<unknown, ProviderToolIO>
): Promise<string> {
  const summaryPrompt = await PromptBuilder.create()
    .system(
      "You are a conversation summarizer. Create a concise summary that captures the key points and context needed to continue the conversation. Be brief but preserve essential information."
    )
    .when(ctx.existingSummary !== null, (p) =>
      p.assistant(`Current summary:\n${ctx.existingSummary}`)
    )
    .merge(ctx.target.children)
    .when(ctx.existingSummary !== null, (p) =>
      p.user(
        "Update the summary based on the previous summary and the conversation above."
      )
    )
    .when(ctx.existingSummary === null, (p) =>
      p.user("Summarize the conversation above.")
    )
    .build();

  const rendered = await render(summaryPrompt, { provider });
  return provider.completion(rendered);
}

export interface SummaryOptions {
  /** Unique identifier for this summary in the store */
  id: string;
  /** Storage adapter for persisting summaries */
  store: KVMemory<StoredSummary>;
  /** Optional metadata to attach to stored summaries (e.g., user/session ids) */
  metadata?: Record<string, unknown>;
  /**
   * Function that generates summaries.
   * If omitted, uses the provided ModelProvider with a default prompt.
   */
  summarize?: Summarizer;
  /** Provider to use for the default summarizer */
  provider?: ModelProvider<unknown, ProviderToolIO>;
  /** Role for the summary message. Default: "system" */
  role?: PromptRole;
  /** Priority for this scope (higher number = reduced first). Default: 0 */
  priority?: number;
}

export interface WriteSummaryOptions {
  id: string;
  store: KVMemory<StoredSummary>;
  target: PromptScope<ProviderToolIO>;
  metadata?: Record<string, unknown>;
  summarize?: Summarizer;
  provider?: ModelProvider<unknown, ProviderToolIO>;
}

export async function writeSummary({
  id,
  store,
  target,
  metadata,
  summarize,
  provider,
}: WriteSummaryOptions): Promise<string> {
  const existingEntry = await store.get(id);

  const summarizerContext: SummarizerContext = {
    target,
    existingSummary: existingEntry?.data.content ?? null,
    ...(provider ? { provider } : {}),
  };

  let newSummary: string;
  if (summarize) {
    newSummary = await summarize(summarizerContext);
  } else if (provider) {
    newSummary = await defaultSummarizer(summarizerContext, provider);
  } else {
    throw new Error(
      `Summary "${id}" requires either a 'summarize' function or a provider. Pass a provider to the Summary options or supply a custom summarizer.`
    );
  }

  if (metadata) {
    await store.set(
      id,
      {
        content: newSummary,
      },
      metadata
    );
  } else {
    await store.set(id, {
      content: newSummary,
    });
  }

  return newSummary;
}

export class Summary<P = unknown> implements PromptPlugin<P> {
  private readonly options: SummaryOptions;
  private readonly content: ScopeContent<P> | null;

  constructor(options: SummaryOptions, content?: ScopeContent<P>) {
    this.options = options;
    this.content = content ?? null;
  }

  extend<T>(content: ScopeContent<T>): Summary<T> {
    return new Summary<T>(this.options, content);
  }

  private requireContent(): ScopeContent<P> {
    if (!this.content) {
      throw new Error(
        `Summary "${this.options.id}" requires content. Call .extend(...) before use.`
      );
    }

    return this.content;
  }

  async render(): Promise<ScopeContent<P>> {
    const content = this.requireContent();
    const children = await resolveScopeContent(
      content,
      this.options.provider?.codec
    );
    const role = this.options.role ?? "system";

    return createScope(children, {
      ...(this.options.priority !== undefined
        ? { priority: this.options.priority }
        : {}),
      strategy: async <TToolIO extends ProviderToolIO>(
        input: StrategyInput<TToolIO>
      ) => {
        const provider = this.options.provider ?? input.context.provider;
        const summaryText = await writeSummary({
          id: this.options.id,
          store: this.options.store,
          target: input.target,
          ...(this.options.metadata ? { metadata: this.options.metadata } : {}),
          ...(this.options.summarize
            ? { summarize: this.options.summarize }
            : {}),
          ...(provider ? { provider } : {}),
        });

        const message = createMessage<TToolIO>(role, [
          textPart<TToolIO>(summaryText),
        ]);
        return createScope<TToolIO>([message], {
          priority: input.target.priority,
        });
      },
    });
  }

  async writeNow(): Promise<string> {
    const content = this.requireContent();
    const children = await resolveScopeContent(
      content,
      this.options.provider?.codec
    );
    const target = createScope(children, {
      ...(this.options.priority !== undefined
        ? { priority: this.options.priority }
        : {}),
    });

    return await writeSummary({
      id: this.options.id,
      store: this.options.store,
      target,
      ...(this.options.metadata ? { metadata: this.options.metadata } : {}),
      ...(this.options.summarize ? { summarize: this.options.summarize } : {}),
      ...(this.options.provider ? { provider: this.options.provider } : {}),
    });
  }
}
