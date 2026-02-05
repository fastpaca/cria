/**
 * Summary strategy for progressively summarizing conversation history.
 */

import {
  PromptBuilder,
  type PromptPlugin,
  resolveScopeContent,
  type ScopeContent,
} from "../dsl/builder";
import { createMessage, createScope } from "../dsl/strategies";
import { textPart } from "../dsl/templating";
import type { ModelProvider } from "../provider";
import { render } from "../render";
import type {
  MaybePromise,
  PromptRole,
  PromptScope,
  ProviderToolIO,
  StrategyInput,
} from "../types";
import type { KVMemory, MemoryEntry } from "./key-value";

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

const SUMMARY_SYSTEM_PROMPT =
  "You are a conversation summarizer. Create a concise summary that captures the key points and context needed to continue the conversation. Be brief but preserve essential information.";

/**
 * Default summarizer that uses a ModelProvider.
 */
async function defaultSummarizer(
  ctx: SummarizerContext,
  provider: ModelProvider<unknown, ProviderToolIO>
): Promise<string> {
  const summaryPrompt = await PromptBuilder.create()
    .system(SUMMARY_SYSTEM_PROMPT)
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

type SummarizerProvider<T> =
  T extends ModelProvider<unknown, ProviderToolIO> ? T : unknown;

export interface SummarizerOptions<P = unknown> {
  /** Content to summarize (prompt nodes/builders/inputs) */
  history?: ScopeContent<P>;
  /** Override summary id */
  id?: string;
  /** Optional metadata to attach to stored summaries */
  metadata?: Record<string, unknown>;
  /** Optional provider for decoding inputs or summarizing outside a prompt */
  provider?: SummarizerProviderFor<P>;
}

export interface SummarizerComponent<PDefault = unknown> {
  <P extends PDefault = PDefault>(
    options: SummarizerOptions<P>
  ): PromptPlugin<P>;
  writeNow<P extends PDefault = PDefault>(
    options: SummarizerOptions<P>
  ): Promise<string>;
  load(options?: { id?: string }): Promise<MemoryEntry<StoredSummary> | null>;
}

export async function writeSummary({
  id,
  store,
  target,
  metadata,
  summarize,
  provider,
}: {
  id: string;
  store: KVMemory<StoredSummary>;
  target: PromptScope<ProviderToolIO>;
  metadata?: Record<string, unknown>;
  summarize?: Summarizer;
  provider?: ModelProvider<unknown, ProviderToolIO>;
}): Promise<string> {
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

export const summarizer = <
  TProvider extends
    | ModelProvider<unknown, ProviderToolIO>
    | undefined = undefined,
>(
  config: SummarizerConfig<TProvider>
): SummarizerComponent<SummarizerProvider<TProvider>> => {
  const store = config.store;

  const component: SummarizerComponent<SummarizerProvider<TProvider>> =
    Object.assign(
      <P extends SummarizerProvider<TProvider> = SummarizerProvider<TProvider>>(
        options: SummarizerOptions<P>
      ): PromptPlugin<P> => {
        const id = resolveSummaryId(config.id, options.id);
        if (!options.history) {
          throw new Error(
            "Summarizer requires history. Pass { history } when creating the plugin or calling writeNow()."
          );
        }
        const metadata =
          config.metadata || options.metadata
            ? { ...(config.metadata ?? {}), ...(options.metadata ?? {}) }
            : undefined;
        const role = config.role ?? "system";
        const priority = config.priority;
        const decodeProvider = config.provider ?? options.provider;

        return {
          render: async () => {
            const children = await resolveScopeContent(
              options.history,
              decodeProvider?.codec
            );

            return createScope(children, {
              priority,
              strategy: async <TToolIO extends ProviderToolIO>(
                input: StrategyInput<TToolIO>
              ) => {
                const resolvedProvider =
                  config.provider ?? options.provider ?? input.context.provider;
                const summaryText = await writeSummary({
                  id,
                  store,
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
      },
      {
        writeNow: async <
          P extends
            SummarizerProvider<TProvider> = SummarizerProvider<TProvider>,
        >(
          options: SummarizerOptions<P>
        ): Promise<string> => {
          const id = resolveSummaryId(config.id, options.id);
          if (!options.history) {
            throw new Error(
              "Summarizer requires history. Pass { history } when creating the plugin or calling writeNow()."
            );
          }
          const metadata =
            config.metadata || options.metadata
              ? { ...(config.metadata ?? {}), ...(options.metadata ?? {}) }
              : undefined;
          const decodeProvider = config.provider ?? options.provider;

          const children = await resolveScopeContent(
            options.history,
            decodeProvider?.codec
          );
          const target = createScope(children, { priority: config.priority });

          return await writeSummary({
            id,
            store,
            target,
            metadata,
            summarize: config.summarize,
            provider: config.provider ?? options.provider,
          });
        },
        load: async (options: { id?: string } = {}) => {
          const id = resolveSummaryId(config.id, options.id);
          return await store.get(id);
        },
      }
    );

  return component;
};
