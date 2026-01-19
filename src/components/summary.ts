import type { KVMemory } from "../memory";
import { render } from "../render";
import type {
  MaybePromise,
  ModelProvider,
  PromptNode,
  PromptPart,
  PromptRole,
  PromptScope,
  ScopeChildren,
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
  const summaryPrompt = buildSummaryPrompt(ctx.target, ctx.existingSummary);
  const rendered = await render(summaryPrompt, { provider });

  return provider.completion(rendered);
}

interface SummaryStrategyOptions {
  id: string;
  store: KVMemory<StoredSummary>;
  summarize?: Summarizer | undefined;
  role: PromptRole;
}

function createSummaryStrategy({
  id,
  store,
  summarize,
  role,
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

    return {
      kind: "scope",
      priority: target.priority,
      children: [
        createMessage(role, `[Summary of earlier conversation]\n${newSummary}`),
      ],
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
  return {
    kind: "scope",
    priority,
    strategy: createSummaryStrategy({ id, store, summarize, role }),
    children,
  };
}

const SUMMARY_SYSTEM_PROMPT =
  "You are a conversation summarizer. Create a concise summary that captures the key points and context needed to continue the conversation. Be brief but preserve essential information.";

const SUMMARY_REQUEST = "Summarize the conversation above.";
const SUMMARY_UPDATE_REQUEST =
  "Update the summary based on the previous summary and the conversation above.";

function buildSummaryPrompt(
  target: PromptScope,
  existingSummary: string | null
): PromptScope {
  const children: PromptNode[] = [
    createMessage("system", SUMMARY_SYSTEM_PROMPT),
  ];

  if (existingSummary) {
    children.push(
      createMessage("assistant", `Current summary:\n${existingSummary}`)
    );
  }

  children.push({
    kind: "scope",
    priority: 0,
    children: [...target.children],
  });

  children.push(
    createMessage(
      "user",
      existingSummary ? SUMMARY_UPDATE_REQUEST : SUMMARY_REQUEST
    )
  );

  return {
    kind: "scope",
    priority: 0,
    children,
  };
}

function createMessage(role: PromptRole, text: string): PromptNode {
  const part: PromptPart = { type: "text", text };
  return {
    kind: "message",
    role,
    children: [part],
  };
}
