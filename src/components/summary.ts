import type { KVMemory } from "../memory";
import { render } from "../render";
import type {
  MaybePromise,
  ModelProvider,
  PromptChildren,
  PromptElement,
  PromptRole,
  Strategy,
  StrategyInput,
} from "../types";

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
  target: PromptElement;
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
  const summaryPrompt = buildSummaryPrompt(ctx.target, ctx.existingSummary);
  const rendered = await render(summaryPrompt, { provider });

  return provider.completion(rendered);
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
      newSummary = await defaultSummarizer(summarizerContext, context.provider);
    } else {
      throw new Error(
        `Summary "${id}" requires either a 'summarize' function or a provider. Pass a provider to render() or wrap the summary in cria.provider(modelProvider, (p) => p.summary(...)).`
      );
    }

    await store.set(id, {
      content: newSummary,
    });

    // Summary never creates a message boundary; wrap it in a message if needed.
    return {
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
  children?: PromptChildren;
}

/**
 * A region that summarizes its content when the prompt needs to shrink.
 *
 * When the overall prompt exceeds budget and this region is selected for
 * reduction (based on priority), the summarizer is called and the result
 * replaces the original content.
 *
 * If no `summarize` function is provided, the component will use the
 * `ModelProvider` from an ancestor provider scope with a default
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
 *   summarize={async ({ target, existingSummary }) => {
 *     const plainText = target.children
 *       .map((child) => (typeof child === "string" ? child : ""))
 *       .join("");
 *     return callAI(`Summarize, building on: ${existingSummary}\n\n${plainText}`);
 *   }}
 *   priority={2}
 * >
 *   {conversationHistory}
 * </Summary>
 * ```
 *
 * @example Using a provider scope (DSL)
 * ```ts
 * import { cria, InMemoryStore, type StoredSummary } from "@fastpaca/cria";
 * import { createProvider } from "@fastpaca/cria/ai-sdk";
 * import { openai } from "@ai-sdk/openai";
 *
 * const store = new InMemoryStore<StoredSummary>();
 * const provider = createProvider(openai("gpt-4o"));
 *
 * const prompt = cria
 *   .prompt()
 *   .provider(provider, (p) =>
 *     p.summary(conversationHistory, { id: "conv-history", store, priority: 2 })
 *   );
 *
 * const result = await prompt.render({ budget: 4000, provider });
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
    children,
  };
}

const SUMMARY_SYSTEM_PROMPT =
  "You are a conversation summarizer. Create a concise summary that captures the key points and context needed to continue the conversation. Be brief but preserve essential information.";

const SUMMARY_REQUEST = "Summarize the conversation above.";
const SUMMARY_UPDATE_REQUEST =
  "Update the summary based on the previous summary and the conversation above.";

function buildSummaryPrompt(
  target: PromptElement,
  existingSummary: string | null
): PromptElement {
  const children: PromptChildren = [
    createMessage("system", [SUMMARY_SYSTEM_PROMPT]),
  ];

  if (existingSummary) {
    children.push(
      createMessage("assistant", [`Current summary:\n${existingSummary}`])
    );
  }

  if (containsMessageNodes(target)) {
    children.push({
      priority: 0,
      children: [...target.children],
    });
    children.push(
      createMessage("user", [
        existingSummary ? SUMMARY_UPDATE_REQUEST : SUMMARY_REQUEST,
      ])
    );
  } else {
    const userChildren: PromptChildren = [
      "Conversation:\n",
      ...target.children,
      "\n\n",
      existingSummary ? SUMMARY_UPDATE_REQUEST : SUMMARY_REQUEST,
    ];
    children.push(createMessage("user", userChildren));
  }

  return {
    priority: 0,
    children,
  };
}

function createMessage(
  role: PromptRole,
  children: PromptChildren
): PromptElement {
  return {
    kind: "message",
    role,
    priority: 0,
    children,
  };
}

function containsMessageNodes(element: PromptElement): boolean {
  if ("kind" in element && element.kind === "message") {
    return true;
  }

  for (const child of element.children) {
    if (typeof child === "string") {
      continue;
    }
    // PromptPart has no children, skip
    if ("type" in child) {
      continue;
    }
    if (containsMessageNodes(child)) {
      return true;
    }
  }

  return false;
}
