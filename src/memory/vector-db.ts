/**
 * Vector DB helper for shared retrieval + indexing.
 */

import type { PromptPlugin } from "../dsl/builder";
import { createMessage, createScope } from "../dsl/strategies";
import { textPart } from "../dsl/templating";
import type { ToolIOForProvider } from "../types";
import type { MemoryEntry } from "./key-value";
import type { VectorMemory, VectorSearchResult } from "./vector";

export interface VectorDBSearchOptions {
  query: string;
  limit?: number;
}

export interface VectorDBEntry<T> {
  id: string;
  data: T;
  metadata?: Record<string, unknown>;
}

export type VectorDBFormatter<T> = (data: T) => string;

export type VectorDBConfig<T> =
  | { store: VectorMemory<T> }
  | { store: VectorMemory<string>; format: VectorDBFormatter<T> };

export interface VectorDBComponent<TInput = unknown, TStored = TInput> {
  <P = unknown>(options: VectorDBSearchOptions): PromptPlugin<P>;
  index(options: VectorDBEntry<TInput>): Promise<void>;
  load(options: { id: string }): Promise<MemoryEntry<TStored> | null>;
}

const DEFAULT_SEARCH_LIMIT = 10;

const formatEntry = <T>(data: T): string => {
  if (typeof data === "string") {
    return data;
  }
  return JSON.stringify(data, null, 2);
};

const formatResults = <T>(results: VectorSearchResult<T>[]): string => {
  if (results.length === 0) {
    return "Vector search returned no results.";
  }

  return results
    .map((result, index) => {
      return `[${index + 1}] (score: ${result.score.toFixed(3)})\n${formatEntry(
        result.entry.data
      )}`;
    })
    .join("\n\n");
};

const createPlugin = <P, TStored>(
  store: VectorMemory<TStored>,
  options: VectorDBSearchOptions
): PromptPlugin<P> => ({
  render: async () => {
    const query = options.query.trim();
    if (!query) {
      throw new Error("VectorDB search requires a non-empty query.");
    }
    const limit = options.limit ?? DEFAULT_SEARCH_LIMIT;

    const results = await store.search(query, { limit });
    const content = formatResults(results);
    const message = createMessage<ToolIOForProvider<P>>("user", [
      textPart<ToolIOForProvider<P>>(content),
    ]);
    return createScope<ToolIOForProvider<P>>([message]);
  },
});

const createVectorDb = <TInput, TStored>(
  store: VectorMemory<TStored>,
  toStored: (data: TInput) => TStored
): VectorDBComponent<TInput, TStored> => {
  const plugin = <P = unknown>(
    options: VectorDBSearchOptions
  ): PromptPlugin<P> => createPlugin<P, TStored>(store, options);

  return Object.assign(plugin, {
    index: async (options: VectorDBEntry<TInput>) => {
      await store.set(options.id, toStored(options.data), options.metadata);
    },
    load: async ({ id }: { id: string }) => await store.get(id),
  });
};

export function vectordb<T>(config: {
  store: VectorMemory<T>;
}): VectorDBComponent<T, T>;
export function vectordb<T>(config: {
  store: VectorMemory<string>;
  format: VectorDBFormatter<T>;
}): VectorDBComponent<T, string>;
export function vectordb<T>(config: VectorDBConfig<T>) {
  if ("format" in config) {
    return createVectorDb<T, string>(config.store, config.format);
  }

  return createVectorDb<T, T>(config.store, (data) => data);
}
