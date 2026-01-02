import type { Child } from "../jsx-runtime";
import type { LLMMemory } from "../memory";
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
  /** Timestamp when last updated (used by legacy memoryStore) */
  lastUpdated?: number;
}

/**
 * Legacy storage adapter for persisting summaries.
 * @deprecated Use `LLMMemory<StoredSummary>` instead
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
 * @deprecated Use `createMemory<StoredSummary>()` instead
 */
export function memoryStore(): SummaryStore {
  const map = new Map<string, StoredSummary>();
  return {
    get(id) {
      return map.get(id) ?? null;
    },
    set(id, summary) {
      map.set(id, { ...summary, lastUpdated: Date.now() });
    },
  };
}

/**
 * Type that accepts either the new LLMMemory interface or legacy SummaryStore.
 */
type SummaryMemory = LLMMemory<StoredSummary> | SummaryStore;

/**
 * Normalizes a store to the new interface for internal use.
 */
function normalizeSummaryStore(store: SummaryMemory): {
  get: (id: string) => MaybePromise<StoredSummary | null>;
  set: (id: string, summary: StoredSummary) => MaybePromise<void>;
} {
  // Check if it's the new LLMMemory interface (has entry wrapper)
  // vs the legacy SummaryStore (returns data directly)
  const isLLMMemory =
    "has" in store && "delete" in store && typeof store.has === "function";

  if (isLLMMemory) {
    const llmMemory = store as LLMMemory<StoredSummary>;
    return {
      async get(id) {
        const entry = await llmMemory.get(id);
        return entry?.data ?? null;
      },
      async set(id, summary) {
        await llmMemory.set(id, summary);
      },
    };
  }

  // Legacy SummaryStore - use as-is
  return store as SummaryStore;
}

interface SummaryStrategyOptions {
  id: string;
  store: SummaryMemory;
  summarize: Summarizer;
}

function createSummaryStrategy({
  id,
  store,
  summarize,
}: SummaryStrategyOptions): Strategy {
  const normalizedStore = normalizeSummaryStore(store);

  return async (input) => {
    const { target, tokenizer, tokenString } = input;

    const content = tokenString(target);
    const existingSummary = await normalizedStore.get(id);

    const newSummary = await summarize({
      content,
      existingSummary: existingSummary?.content ?? null,
    });

    const newTokenCount = tokenizer(newSummary);

    await normalizedStore.set(id, {
      content: newSummary,
      tokenCount: newTokenCount,
      lastUpdated: Date.now(),
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
  /** Storage adapter for persisting summaries (LLMMemory or legacy SummaryStore) */
  store: SummaryMemory;
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
 * // Using the new LLMMemory interface
 * import { createMemory, Summary } from "@fastpaca/cria";
 *
 * const memory = createMemory<StoredSummary>();
 *
 * <Summary
 *   id="conv-history"
 *   store={memory}
 *   summarize={async ({ content, existingSummary }) => {
 *     return callAI(`Summarize, building on: ${existingSummary}\n\n${content}`);
 *   }}
 *   priority={2}
 * >
 *   {conversationHistory}
 * </Summary>
 * ```
 *
 * @example
 * ```tsx
 * // Legacy memoryStore() still works
 * import { memoryStore, Summary } from "@fastpaca/cria";
 *
 * <Summary
 *   id="conv-history"
 *   store={memoryStore()}
 *   summarize={...}
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
