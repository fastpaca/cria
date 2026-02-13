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

export type SummarizerProvider = ModelProvider<unknown, ProviderToolIO>;

type SummarizerPromptSeed = string | ScopeContent<SummarizerProvider>;

export interface SummarizerPromptContext {
  existingSummary: string | null;
}

export type SummarizerPrompt =
  | SummarizerPromptSeed
  | ((
      context: SummarizerPromptContext
    ) => SummarizerPromptSeed | Promise<SummarizerPromptSeed>);

export interface SummarizerOptions {
  history: ScopeContent<SummarizerProvider>;
  id?: string;
  metadata?: Record<string, unknown>;
  prompt?: SummarizerPrompt;
}

export interface SummarizerConfig {
  store: KVMemory<StoredSummary>;
  id: string;
  provider: SummarizerProvider;
  metadata?: Record<string, unknown>;
  prompt?: SummarizerPrompt;
  role?: PromptRole;
  priority?: number;
}

class SummarizerPlugin implements PromptPlugin<SummarizerProvider> {
  private readonly component: Summarizer;
  private readonly options: SummarizerOptions;

  constructor(component: Summarizer, options: SummarizerOptions) {
    this.component = component;
    this.options = options;
  }

  async render() {
    return await this.component.renderPlugin(this.options);
  }
}

export class Summarizer {
  private readonly store: KVMemory<StoredSummary>;
  private readonly defaultId: string;
  private readonly provider: SummarizerProvider;
  private readonly defaultMetadata: Record<string, unknown> | undefined;
  private readonly messageRole: PromptRole;
  private readonly priority: number | undefined;
  private readonly defaultPrompt: SummarizerPrompt;

  constructor(config: SummarizerConfig) {
    this.store = config.store;
    this.defaultId = config.id;
    this.provider = config.provider;
    this.defaultMetadata = config.metadata;
    this.defaultPrompt =
      config.prompt ??
      "You are a conversation summarizer. Create a concise summary that captures the key points and context needed to continue the conversation. Be brief but preserve essential information.";
    this.messageRole = config.role ?? "system";
    this.priority = config.priority;
  }

  plugin(options: SummarizerOptions): PromptPlugin<SummarizerProvider> {
    return new SummarizerPlugin(this, options);
  }

  async writeNow(options: SummarizerOptions): Promise<string> {
    const summaryId = this.resolveId(options.id);
    const summaryMetadata = this.resolveMetadata(options.metadata);
    const children = await this.resolveHistory(options.history);
    const target = createScope(children, {
      ...(this.priority !== undefined ? { priority: this.priority } : {}),
    });

    return await this.summarize(
      target,
      summaryId,
      summaryMetadata,
      options.prompt
    );
  }

  async load(
    options: { id?: string } = {}
  ): Promise<MemoryEntry<StoredSummary> | null> {
    const summaryId = this.resolveId(options.id);
    const entry = await this.store.get(summaryId);
    if (!entry) {
      return null;
    }
    return {
      ...entry,
      data: StoredSummarySchema.parse(entry.data),
    };
  }

  async get(options: { id?: string } = {}): Promise<string | null> {
    const entry = await this.load(options);
    return entry?.data.content.trim() || null;
  }

  async renderPlugin(options: SummarizerOptions) {
    const summaryId = this.resolveId(options.id);
    const summaryMetadata = this.resolveMetadata(options.metadata);
    const children = await this.resolveHistory(options.history);

    return createScope(children, {
      ...(this.priority !== undefined ? { priority: this.priority } : {}),
      strategy: async <TToolIO extends ProviderToolIO>(
        input: StrategyInput<TToolIO>
      ) => {
        const summaryText = await this.summarize(
          input.target,
          summaryId,
          summaryMetadata,
          options.prompt
        );

        const message = createMessage<TToolIO>(this.messageRole, [
          textPart<TToolIO>(summaryText),
        ]);
        return createScope<TToolIO>([message], {
          priority: input.target.priority,
        });
      },
    });
  }

  private resolveId(idOverride?: string): string {
    return idOverride ?? this.defaultId;
  }

  private resolveMetadata(
    metadataOverride?: Record<string, unknown>
  ): Record<string, unknown> | undefined {
    return metadataOverride ?? this.defaultMetadata;
  }

  private async resolveHistory(
    history: ScopeContent<SummarizerProvider>
  ): Promise<PromptScope<ProviderToolIO>["children"]> {
    return await resolveScopeContent(history);
  }

  private async summarize(
    target: PromptScope<ProviderToolIO>,
    summaryId: string,
    summaryMetadata: Record<string, unknown> | undefined,
    summaryPrompt?: SummarizerPrompt
  ): Promise<string> {
    const existingEntry = await this.store.get(summaryId);
    const existingSummary = existingEntry
      ? StoredSummarySchema.parse(existingEntry.data).content
      : null;

    const seed = await this.resolvePromptSeed(
      {
        existingSummary,
      },
      summaryPrompt
    );
    const prompt = await this.makeBuilderFromSeed(seed);
    const builder = this.applySummaryFlow(
      prompt,
      existingSummary,
      target.children
    );

    const summaryPromptTree = await builder.build();
    const rendered = await render(summaryPromptTree, {
      provider: this.provider,
    });
    const summaryText = await this.provider.completion(rendered);

    await this.store.set(summaryId, { content: summaryText }, summaryMetadata);
    return summaryText;
  }

  private async resolvePromptSeed(
    context: SummarizerPromptContext,
    customPrompt?: SummarizerPrompt
  ): Promise<SummarizerPromptSeed> {
    const template = customPrompt ?? this.defaultPrompt;
    if (typeof template === "function") {
      return await template(context);
    }

    return template;
  }

  private applySummaryFlow(
    basePrompt: PromptBuilder<SummarizerProvider>,
    existingSummary: string | null,
    historyChildren: PromptScope<ProviderToolIO>["children"]
  ): PromptBuilder<SummarizerProvider> {
    let builder = basePrompt;

    if (existingSummary) {
      builder = builder.assistant(`Current summary:\n${existingSummary}`);
    }

    builder = builder.merge(historyChildren);

    builder = builder.user(
      existingSummary
        ? "Update the summary based on the previous summary and the conversation above."
        : "Summarize the conversation above."
    );

    return builder;
  }

  private async makeBuilderFromSeed(
    seed: SummarizerPromptSeed
  ): Promise<PromptBuilder<SummarizerProvider>> {
    if (typeof seed === "string") {
      return PromptBuilder.create(this.provider).system(seed);
    }

    const nodes = await this.resolveHistory(seed);
    return PromptBuilder.create(this.provider).merge(...nodes);
  }
}

export const summarizer = (config: SummarizerConfig): Summarizer => {
  return new Summarizer(config);
};
