/**
 * Summary strategy for progressively summarizing conversation history.
 */

import { z } from "zod";
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
  PromptRole,
  PromptScope,
  ProviderToolIO,
  StrategyInput,
} from "../types";
import type { KVMemory, MemoryEntry } from "./key-value";

export const StoredSummarySchema = z.object({
  content: z.string(),
});

/**
 * Stored summary data persisted across renders.
 */
export type StoredSummary = z.infer<typeof StoredSummarySchema>;

type SummarizerProvider = ModelProvider<unknown, ProviderToolIO>;

export interface SummarizerOptions {
  history: ScopeContent<SummarizerProvider>;
  id?: string;
  metadata?: Record<string, unknown>;
}

export const summarizer = (config: {
  store: KVMemory<StoredSummary>;
  id: string;
  provider: SummarizerProvider;
  metadata?: Record<string, unknown>;
  role?: PromptRole;
  priority?: number;
}): {
  (options: SummarizerOptions): PromptPlugin<SummarizerProvider>;
  writeNow(options: SummarizerOptions): Promise<string>;
  load(options?: { id?: string }): Promise<MemoryEntry<StoredSummary> | null>;
} => {
  const { store, id: defaultId, provider, metadata, role, priority } = config;
  const messageRole = role ?? "system";

  const resolveHistory = async (
    history: ScopeContent<SummarizerProvider>
  ): Promise<PromptScope<ProviderToolIO>["children"]> =>
    await resolveScopeContent(history, provider.codec);

  const summarize = async (
    target: PromptScope<ProviderToolIO>,
    summaryId: string,
    summaryMetadata: Record<string, unknown> | undefined
  ): Promise<string> => {
    const existingEntry = await store.get(summaryId);
    const existingSummary = existingEntry
      ? StoredSummarySchema.parse(existingEntry.data).content
      : null;

    let builder = PromptBuilder.create(provider).system(
      "You are a conversation summarizer. Create a concise summary that captures the key points and context needed to continue the conversation. Be brief but preserve essential information."
    );

    if (existingSummary) {
      builder = builder.assistant(`Current summary:\n${existingSummary}`);
    }

    builder = builder.merge(target.children);

    builder = builder.user(
      existingSummary
        ? "Update the summary based on the previous summary and the conversation above."
        : "Summarize the conversation above."
    );

    const summaryPrompt = await builder.build();
    const rendered = await render(summaryPrompt, { provider });
    const summaryText = await provider.completion(rendered);

    await store.set(summaryId, { content: summaryText }, summaryMetadata);
    return summaryText;
  };

  const createPlugin = (
    options: SummarizerOptions
  ): PromptPlugin<SummarizerProvider> => {
    const summaryId = options.id ?? defaultId;
    const summaryMetadata = options.metadata ?? metadata;

    return {
      render: async () => {
        const children = await resolveHistory(options.history);
        return createScope(children, {
          ...(priority !== undefined ? { priority } : {}),
          strategy: async <TToolIO extends ProviderToolIO>(
            input: StrategyInput<TToolIO>
          ) => {
            const summaryText = await summarize(
              input.target,
              summaryId,
              summaryMetadata
            );

            const message = createMessage<TToolIO>(messageRole, [
              textPart<TToolIO>(summaryText),
            ]);
            return createScope<TToolIO>([message], {
              priority: input.target.priority,
            });
          },
        });
      },
    };
  };

  return Object.assign(createPlugin, {
    writeNow: async (options: SummarizerOptions): Promise<string> => {
      const summaryId = options.id ?? defaultId;
      const summaryMetadata = options.metadata ?? metadata;
      const children = await resolveHistory(options.history);
      const target = createScope(children, {
        ...(priority !== undefined ? { priority } : {}),
      });

      return await summarize(target, summaryId, summaryMetadata);
    },
    load: async (options: { id?: string } = {}) => {
      const summaryId = options.id ?? defaultId;
      const entry = await store.get(summaryId);
      if (!entry) {
        return null;
      }
      return {
        ...entry,
        data: StoredSummarySchema.parse(entry.data),
      };
    },
  });
};
