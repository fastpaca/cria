/**
 * Summary strategy for progressively summarizing conversation history.
 */

import type { KVMemory } from "../memory";
import { render } from "../render";
import type {
  MaybePromise,
  ModelProvider,
  PromptRole,
  PromptScope,
  ScopeChildren,
  StrategyInput,
} from "../types";
import { PromptBuilder } from "./builder";
import { createScope } from "./strategies";

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
  target: PromptScope;
  /** Previous summary to build upon (null if first summary) */
  existingSummary: string | null;
  /** Provider in scope, if any */
  provider?: ModelProvider<unknown>;
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
  provider: ModelProvider<unknown>
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

interface SummaryProps {
  /** Unique identifier for this summary in the store */
  id: string;
  /** Storage adapter for persisting summaries */
  store: KVMemory<StoredSummary>;
  /**
   * Function that generates summaries.
   * If omitted, uses the ModelProvider from render options with a default prompt.
   */
  summarize?: Summarizer;
  /** Priority for this scope (higher number = reduced first). Default: 0 */
  priority?: number;
  /** Role for the summary message. Default: "system" */
  role?: PromptRole;
  /** Content to potentially summarize */
  children?: ScopeChildren;
}

/**
 * A scope that summarizes its content when the prompt needs to shrink.
 */
export function Summary({
  id,
  store,
  summarize,
  priority = 0,
  role = "system",
  children = [],
}: SummaryProps): PromptScope {
  return createScope(children, {
    priority,
    strategy: async (input: StrategyInput) => {
      const { target, context } = input;
      const existingEntry = await store.get(id);

      const summarizerContext: SummarizerContext = {
        target,
        existingSummary: existingEntry?.data.content ?? null,
        ...(context.provider ? { provider: context.provider } : {}),
      };

      let newSummary: string;
      if (summarize) {
        newSummary = await summarize(summarizerContext);
      } else if (context.provider) {
        newSummary = await defaultSummarizer(
          summarizerContext,
          context.provider
        );
      } else {
        throw new Error(
          `Summary "${id}" requires either a 'summarize' function or a provider. Pass a provider to render(), bind one with cria.prompt(provider) or cria.prompt().provider(provider), or wrap the summary in cria.prompt().providerScope(provider, (p) => p.summary(...)).`
        );
      }

      await store.set(id, {
        content: newSummary,
      });

      const tree = await PromptBuilder.create()
        .message(role, newSummary)
        .build();
      return { ...tree, priority: target.priority };
    },
  });
}
