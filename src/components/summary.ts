import type { Child } from "../jsx-runtime";
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
  /** Timestamp when last updated */
  lastUpdated: number;
}

/**
 * Storage adapter for persisting summaries.
 */
export interface SummaryStore {
  get(id: string): MaybePromise<StoredSummary | null>;
  set(id: string, summary: StoredSummary): MaybePromise<void>;
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

/**
 * Creates an in-memory summary store.
 */
export function memoryStore(): SummaryStore {
  const map = new Map<string, StoredSummary>();
  return {
    get(id) {
      return map.get(id) ?? null;
    },
    set(id, summary) {
      map.set(id, summary);
    },
  };
}

interface SummaryStrategyOptions {
  id: string;
  store: SummaryStore;
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
    const existingSummary = await store.get(id);

    const newSummary = await summarize({
      content,
      existingSummary: existingSummary?.content ?? null,
    });

    const newTokenCount = tokenizer(newSummary);

    await store.set(id, {
      content: newSummary,
      tokenCount: newTokenCount,
      lastUpdated: Date.now(),
    });

    const { strategy: _, ...rest } = target;
    return {
      ...rest,
      children: [newSummary],
    };
  };
}

interface SummaryProps {
  /** Unique identifier for this summary in the store */
  id: string;
  /** Storage adapter for persisting summaries */
  store: SummaryStore;
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
 * <Summary
 *   id="conv-history"
 *   store={memoryStore()}
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
