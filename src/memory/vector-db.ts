/**
 * Vector DB helper for shared retrieval + indexing.
 */

import type { PromptPlugin } from "../dsl/builder";
import { VectorSearch } from "../dsl/vector-search";
import type { ToolIOForProvider } from "../types";
import type { MemoryEntry } from "./key-value";
import type { VectorMemory } from "./vector";

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

export interface VectorDBConfig<TStored, TInput = TStored> {
  store: VectorMemory<TStored>;
  format?: VectorDBFormatter<TInput>;
}

export interface VectorDBComponent<TInput = unknown, TStored = TInput> {
  <P = unknown>(options: VectorDBSearchOptions): PromptPlugin<P>;
  search<P = unknown>(options: VectorDBSearchOptions): PromptPlugin<P>;
  index(options: VectorDBEntry<TInput>): Promise<void>;
  load(options: { id: string }): Promise<MemoryEntry<TStored> | null>;
}

const createPlugin = <P, TStored>(
  store: VectorMemory<TStored>,
  options: VectorDBSearchOptions
): PromptPlugin<P> => {
  const query = options.query.trim();
  if (!query) {
    throw new Error("VectorDB search requires a non-empty query.");
  }
  const limit = options.limit ?? 10;

  return {
    render: () =>
      VectorSearch<TStored, ToolIOForProvider<P>>({
        store,
        query,
        limit,
      }),
  } satisfies PromptPlugin<P>;
};

export const vectordb = <TStored, TInput = TStored>(
  config: VectorDBConfig<TStored, TInput>
): VectorDBComponent<TInput, TStored> => {
  const { store, format } = config;
  const plugin = <P = unknown>(
    options: VectorDBSearchOptions
  ): PromptPlugin<P> => createPlugin<P, TStored>(store, options);

  if (format) {
    const component: VectorDBComponent<TInput, TStored> = Object.assign(
      plugin,
      {
        search: plugin,
        index: async (options: VectorDBEntry<TInput>) => {
          await store.set(options.id, format(options.data), options.metadata);
        },
        load: async ({ id }: { id: string }) => await store.get(id),
      }
    );

    return component;
  }

  const component: VectorDBComponent<TStored, TStored> = Object.assign(plugin, {
    search: plugin,
    index: async (options: VectorDBEntry<TStored>) => {
      await store.set(options.id, options.data, options.metadata);
    },
    load: async ({ id }: { id: string }) => await store.get(id),
  });

  return component;
};
