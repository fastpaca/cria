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

export type VectorDBConfig<T> =
  | { store: VectorMemory<T> }
  | { store: VectorMemory<string>; format: VectorDBFormatter<T> };

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

export function vectordb<T>(config: {
  store: VectorMemory<T>;
}): VectorDBComponent<T, T>;
export function vectordb<T>(config: {
  store: VectorMemory<string>;
  format: VectorDBFormatter<T>;
}): VectorDBComponent<T, string>;
export function vectordb<T>(config: VectorDBConfig<T>) {
  if ("format" in config) {
    const store = config.store;
    const formatter = config.format;
    const plugin = <P = unknown>(
      options: VectorDBSearchOptions
    ): PromptPlugin<P> => createPlugin<P, string>(store, options);

    const component: VectorDBComponent<T, string> = Object.assign(plugin, {
      search: plugin,
      index: async (options: VectorDBEntry<T>) => {
        await store.set(options.id, formatter(options.data), options.metadata);
      },
      load: async ({ id }: { id: string }) => await store.get(id),
    });

    return component;
  }

  const store = config.store;
  const plugin = <P = unknown>(
    options: VectorDBSearchOptions
  ): PromptPlugin<P> => createPlugin<P, T>(store, options);

  const component: VectorDBComponent<T, T> = Object.assign(plugin, {
    search: plugin,
    index: async (options: VectorDBEntry<T>) => {
      await store.set(options.id, options.data, options.metadata);
    },
    load: async ({ id }: { id: string }) => await store.get(id),
  });

  return component;
}
