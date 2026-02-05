/**
 * Summary strategy for progressively summarizing conversation history.
 */

import type { KVMemory, MemoryEntry } from "../memory";
import { scopeKVStore } from "../memory";
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

export interface SummarizerConfig<
  TProvider extends
    | ModelProvider<unknown, ProviderToolIO>
    | undefined = undefined,
> {
  /** Storage adapter for persisting summaries */
  store: KVMemory<StoredSummary>;
  /** Default summary id (overridable per call) */
  id?: string;
  /** Optional metadata to attach to stored summaries */
  metadata?: Record<string, unknown>;
  /**
   * Function that generates summaries.
   * If omitted, uses the provided ModelProvider with a default prompt.
   */
  summarize?: Summarizer;
  /** Provider to use for the default summarizer */
  provider?: TProvider;
  /** Role for the summary message. Default: "system" */
  role?: PromptRole;
  /** Priority for this scope (higher number = reduced first). Default: 0 */
  priority?: number;
}

type SummarizerProviderFor<P> =
  P extends ModelProvider<unknown, ProviderToolIO>
    ? P
    : ModelProvider<unknown, ProviderToolIO>;

export interface SummarizerUseOptions<P = unknown> {
  /** Content to summarize (prompt nodes/builders/inputs) */
  history?: ScopeContent<P>;
  /** Override summary id */
  id?: string;
  /** Optional metadata to attach to stored summaries */
  metadata?: Record<string, unknown>;
  /** Optional provider for decoding inputs or summarizing outside a prompt */
  provider?: SummarizerProviderFor<P>;
  /** Required for per-user scoping */
  userId?: string;
  /** Optional session identifier for further scoping */
  sessionId?: string;
  /** Override the default key prefix for scoped storage */
  keyPrefix?: string;
}

export type SummarizerPluginOptions<P = unknown> = SummarizerUseOptions<P>;

export type SummarizerWriteOptions<P = unknown> = SummarizerUseOptions<P>;

export interface SummarizerLoadOptions {
  /** Override summary id */
  id?: string;
  /** Required for per-user scoping */
  userId?: string;
  /** Optional session identifier for further scoping */
  sessionId?: string;
  /** Override the default key prefix for scoped storage */
  keyPrefix?: string;
}

type SummarizerProvider<T> =
  T extends ModelProvider<unknown, ProviderToolIO> ? T : unknown;

export interface SummarizerComponent<PDefault = unknown> {
  <P extends PDefault = PDefault>(
    options: SummarizerPluginOptions<P>
  ): PromptPlugin<P>;
  writeNow<P extends PDefault = PDefault>(
    options: SummarizerWriteOptions<P>
  ): Promise<string>;
  load(
    options?: SummarizerLoadOptions
  ): Promise<MemoryEntry<StoredSummary> | null>;
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
    provider,
  };

  let newSummary: string;
  if (summarize) {
    newSummary = await summarize(summarizerContext);
  } else if (provider) {
    newSummary = await defaultSummarizer(summarizerContext, provider);
  } else {
    throw new Error(
      `Summarizer "${id}" requires either a 'summarize' function or a provider. Pass a provider to the summarizer config or supply a custom summarizer.`
    );
  }

  await store.set(id, { content: newSummary }, metadata);
  return newSummary;
}

const resolveSummaryId = (
  configId: string | undefined,
  callId: string | undefined
): string => {
  const id = callId ?? configId;
  if (!id) {
    throw new Error(
      "Summarizer requires an id. Provide one in the config or per call."
    );
  }
  return id;
};

const resolveScope = (options: {
  userId?: string;
  sessionId?: string;
  keyPrefix?: string;
}): { userId?: string; sessionId?: string; keyPrefix?: string } => {
  if (!options.userId && (options.sessionId || options.keyPrefix)) {
    throw new Error("userId is required when using sessionId or keyPrefix.");
  }
  return options;
};

const withUserScope = <T>(
  store: KVMemory<T>,
  options: { userId?: string; sessionId?: string; keyPrefix?: string }
): KVMemory<T> => {
  const scope = resolveScope(options);
  if (!scope.userId) {
    return store;
  }
  return scopeKVStore(store, {
    userId: scope.userId,
    sessionId: scope.sessionId,
    keyPrefix: scope.keyPrefix,
  });
};

const mergeMetadata = (
  base: Record<string, unknown> | undefined,
  override: Record<string, unknown> | undefined
): Record<string, unknown> | undefined => {
  if (!(base || override)) {
    return undefined;
  }
  return { ...(base ?? {}), ...(override ?? {}) };
};

const requireHistory = <P>(
  history: ScopeContent<P> | undefined
): ScopeContent<P> => {
  if (!history) {
    throw new Error(
      "Summarizer requires history. Pass { history } when creating the plugin or calling writeNow()."
    );
  }
  return history;
};

export const summarizer = <
  TProvider extends
    | ModelProvider<unknown, ProviderToolIO>
    | undefined = undefined,
>(
  config: SummarizerConfig<TProvider>
): SummarizerComponent<SummarizerProvider<TProvider>> => {
  const store = config.store;

  const component = (<
    P extends SummarizerProvider<TProvider> = SummarizerProvider<TProvider>,
  >(
    options: SummarizerPluginOptions<P>
  ): PromptPlugin<P> => {
    const callOptions = options;
    const id = resolveSummaryId(config.id, callOptions.id);
    const history = requireHistory(callOptions.history);
    const scopedStore = withUserScope(store, {
      userId: callOptions.userId,
      sessionId: callOptions.sessionId,
      keyPrefix: callOptions.keyPrefix,
    });
    const metadata = mergeMetadata(config.metadata, callOptions.metadata);
    const role = config.role ?? "system";
    const priority = config.priority;
    const decodeProvider = config.provider ?? callOptions.provider;

    return {
      render: async () => {
        const children = await resolveScopeContent(
          history,
          decodeProvider?.codec
        );

        return createScope(children, {
          priority,
          strategy: async <TToolIO extends ProviderToolIO>(
            input: StrategyInput<TToolIO>
          ) => {
            const resolvedProvider =
              config.provider ?? callOptions.provider ?? input.context.provider;
            const summaryText = await writeSummary({
              id,
              store: scopedStore,
              target: input.target,
              metadata,
              summarize: config.summarize,
              provider: resolvedProvider,
            });

            const message = createMessage<TToolIO>(role, [
              textPart<TToolIO>(summaryText),
            ]);
            return createScope<TToolIO>([message], {
              priority: input.target.priority,
            });
          },
        });
      },
    } satisfies PromptPlugin<P>;
  }) as SummarizerComponent<SummarizerProvider<TProvider>>;

  component.writeNow = async <
    P extends SummarizerProvider<TProvider> = SummarizerProvider<TProvider>,
  >(
    options: SummarizerWriteOptions<P>
  ): Promise<string> => {
    const id = resolveSummaryId(config.id, options.id);
    const history = requireHistory(options.history);
    const scopedStore = withUserScope(store, {
      userId: options.userId,
      sessionId: options.sessionId,
      keyPrefix: options.keyPrefix,
    });
    const metadata = mergeMetadata(config.metadata, options.metadata);
    const decodeProvider = config.provider ?? options.provider;

    const children = await resolveScopeContent(history, decodeProvider?.codec);
    const target = createScope(children, { priority: config.priority });

    return await writeSummary({
      id,
      store: scopedStore,
      target,
      metadata,
      summarize: config.summarize,
      provider: config.provider ?? options.provider,
    });
  };

  component.load = async (
    options: SummarizerLoadOptions = {}
  ): Promise<MemoryEntry<StoredSummary> | null> => {
    const id = resolveSummaryId(config.id, options.id);
    const scopedStore = withUserScope(store, {
      userId: options.userId,
      sessionId: options.sessionId,
      keyPrefix: options.keyPrefix,
    });

    return await scopedStore.get(id);
  };

  return component;
};
