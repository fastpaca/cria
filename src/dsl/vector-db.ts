/**
 * Vector DB helper for shared retrieval + indexing.
 */

import type { MemoryEntry, VectorMemory } from "../memory";
import type { ToolIOForProvider } from "../types";
import type { PromptPlugin } from "./builder";
import { VectorSearch } from "./vector-search";

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

export type VectorDBUseOptions = VectorDBSearchOptions;

export interface VectorDBLoadOptions {
  id: string;
}

export interface VectorDBComponent<T = unknown, TStored = T> {
  <P = unknown>(options: VectorDBUseOptions): PromptPlugin<P>;
  search<P = unknown>(options: VectorDBUseOptions): PromptPlugin<P>;
  index(options: VectorDBEntry<T>): Promise<void>;
  load(options: VectorDBLoadOptions): Promise<MemoryEntry<TStored> | null>;
}

const resolveQuery = (options: VectorDBUseOptions): string => {
  const trimmed = options.query.trim();
  if (!trimmed) {
    throw new Error("VectorDB search requires a non-empty query.");
  }
  return trimmed;
};

const resolveLimit = (options: VectorDBUseOptions): number => {
  return options.limit ?? 10;
};

const createPlugin = <P, T>(
  store: VectorMemory<T>,
  options: VectorDBUseOptions
): PromptPlugin<P> => {
  const query = resolveQuery(options);
  const limit = resolveLimit(options);

  return {
    render: () =>
      VectorSearch<T, ToolIOForProvider<P>>({
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
    const baseStore = config.store;
    const formatter = config.format;

    const component = Object.assign(
      <P = unknown>(options: VectorDBUseOptions): PromptPlugin<P> =>
        createPlugin<P, string>(baseStore, options),
      {
        search: <P = unknown>(options: VectorDBUseOptions): PromptPlugin<P> =>
          createPlugin<P, string>(baseStore, options),
        index: async (options: VectorDBEntry<T>) => {
          const value = formatter(options.data);
          await baseStore.set(options.id, value, options.metadata);
        },
        load: async (
          options: VectorDBLoadOptions
        ): Promise<MemoryEntry<string> | null> => {
          return await baseStore.get(options.id);
        },
      }
    );

    return component;
  }

  const baseStore = config.store;

  const component = Object.assign(
    <P = unknown>(options: VectorDBUseOptions): PromptPlugin<P> =>
      createPlugin<P, T>(baseStore, options),
    {
      search: <P = unknown>(options: VectorDBUseOptions): PromptPlugin<P> =>
        createPlugin<P, T>(baseStore, options),
      index: async (options: VectorDBEntry<T>) => {
        await baseStore.set(options.id, options.data, options.metadata);
      },
      load: async (
        options: VectorDBLoadOptions
      ): Promise<MemoryEntry<T> | null> => {
        return await baseStore.get(options.id);
      },
    }
  );

  return component;
}
