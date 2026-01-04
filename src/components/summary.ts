import type { Child } from "../jsx-runtime";
import type { KVMemory } from "../memory";
import type { ModelProvider } from "../providers/types";
import type {
  MaybePromise,
  PromptChildren,
  PromptElement,
  Strategy,
  StrategyInput,
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

/**
 * Default summarizer that uses a ModelProvider.
 * This is used when no custom summarize function is provided.
 */
async function defaultSummarizer(
  ctx: SummarizerContext,
  provider: ModelProvider
): Promise<string> {
  const systemPrompt =
    "You are a conversation summarizer. Create a concise summary that captures the key points and context needed to continue the conversation. Be brief but preserve essential information.";

  let userPrompt: string;
  if (ctx.existingSummary) {
    userPrompt = `Here is the existing summary of the conversation so far:

${ctx.existingSummary}

Here is new conversation content to incorporate into the summary:

${ctx.content}

Please provide an updated summary that incorporates both the existing summary and the new content.`;
  } else {
    userPrompt = `Please summarize the following conversation:

${ctx.content}`;
  }

  const result = await provider.completion({
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });

  return result.text;
}

interface SummaryStrategyOptions {
  id: string;
  store: KVMemory<StoredSummary>;
  summarize?: Summarizer | undefined;
}

function createSummaryStrategy({
  id,
  store,
  summarize,
}: SummaryStrategyOptions): Strategy {
  return async (input: StrategyInput) => {
    const { target, tokenizer, tokenString, context } = input;

    const content = tokenString(target);
    const existingEntry = await store.get(id);

    const summarizerContext: SummarizerContext = {
      content,
      existingSummary: existingEntry?.data.content ?? null,
    };

    let newSummary: string;
    if (summarize) {
      newSummary = await summarize(summarizerContext);
    } else if (context.provider) {
      newSummary = await defaultSummarizer(summarizerContext, context.provider);
    } else {
      throw new Error(
        `Summary "${id}" requires either a 'summarize' function or a provider component ancestor (e.g. <AISDKProvider>)`
      );
    }

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
  /**
   * Function that generates summaries.
   * If omitted, uses the ModelProvider from render options with a default prompt.
   */
  summarize?: Summarizer;
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
 * If no `summarize` function is provided, the component will use the
 * `ModelProvider` from an ancestor provider component with a default
 * summarization prompt.
 *
 * @example Using a custom summarizer
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
 *
 * @example Using a provider component
 * ```tsx
 * import { InMemoryStore, Summary, type StoredSummary, render } from "@fastpaca/cria";
 * import { AISDKProvider } from "@fastpaca/cria/ai-sdk";
 * import { openai } from "@ai-sdk/openai";
 *
 * const store = new InMemoryStore<StoredSummary>();
 *
 * const prompt = (
 *   <AISDKProvider model={openai("gpt-4o")}>
 *     <Summary id="conv-history" store={store} priority={2}>
 *       {conversationHistory}
 *     </Summary>
 *   </AISDKProvider>
 * );
 *
 * const result = await render(prompt, { tokenizer, budget: 4000 });
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
