import type { Child } from "../jsx-runtime";
import type { KVMemory } from "../memory";
import type {
  MaybePromise,
  PromptChildren,
  PromptElement,
  Strategy,
} from "../types";

/**
 * Stored summary data persisted across renders.
 */
export interface StoredSummary {
  /** The summary text content */
  content: string;
  /** Token count of the summary */
  tokenCount: number;
}

/**
 * Context passed to the summarizer function.
 */
export interface SummarizerContext {
  /** The content to summarize (as rendered string) */
  content: string;
  /** Previous summary to build upon (null if first summary) */
  existingSummary: string | null;
}

/**
 * Function that generates summaries.
 */
export type Summarizer = (ctx: SummarizerContext) => MaybePromise<string>;

interface SummaryStrategyOptions {
  id: string;
  store: KVMemory<StoredSummary>;
  summarize: Summarizer;
}

function createSummaryStrategy({
  id,
  store,
  summarize,
}: SummaryStrategyOptions): Strategy {
  return async (input) => {
    const { target, tokenizer, tokenString } = input;

    const content = tokenString(target);
    const existingEntry = await store.get(id);

    const newSummary = await summarize({
      content,
      existingSummary: existingEntry?.data.content ?? null,
    });

    const newTokenCount = tokenizer(newSummary);

    await store.set(id, {
      content: newSummary,
      tokenCount: newTokenCount,
    });

    // Return as an assistant message so it renders properly
    return {
      kind: "message",
      role: "assistant",
      priority: target.priority,
      children: [`[Summary of earlier conversation]\n${newSummary}`],
    };
  };
}

interface SummaryProps {
  /** Unique identifier for this summary in the store */
  id: string;
  /** Storage adapter for persisting summaries */
  store: KVMemory<StoredSummary>;
  /** Function that generates summaries */
  summarize: Summarizer;
  /** Priority for this region (higher number = reduced first). Default: 0 */
  priority?: number;
  /** Content to potentially summarize */
  children?: Child;
}

/**
 * A region that summarizes its content when the prompt needs to shrink.
 *
 * When the overall prompt exceeds budget and this region is selected for
 * reduction (based on priority), the summarizer is called and the result
 * replaces the original content.
 *
 * @example
 * ```tsx
 * import { InMemoryStore, Summary, type StoredSummary } from "@fastpaca/cria";
 *
 * const store = new InMemoryStore<StoredSummary>();
 *
 * <Summary
 *   id="conv-history"
 *   store={store}
 *   summarize={async ({ content, existingSummary }) => {
 *     return callAI(`Summarize, building on: ${existingSummary}\n\n${content}`);
 *   }}
 *   priority={2}
 * >
 *   {conversationHistory}
 * </Summary>
 * ```
 */
export function Summary({
  id,
  store,
  summarize,
  priority = 0,
  children = [],
}: SummaryProps): PromptElement {
  return {
    priority,
    strategy: createSummaryStrategy({ id, store, summarize }),
    children: children as PromptChildren,
  };
}
