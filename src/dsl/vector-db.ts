/**
 * Vector DB helper for shared retrieval + indexing.
 */

import type { MemoryEntry, VectorMemory } from "../memory";
import { scopeVectorStore } from "../memory";
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

export interface VectorDBScopeOptions {
  userId?: string;
  sessionId?: string;
  keyPrefix?: string;
}

export interface VectorDBUseOptions
  extends VectorDBSearchOptions,
    VectorDBScopeOptions {}

export interface VectorDBLoadOptions extends VectorDBScopeOptions {
  id: string;
}

export interface VectorDBComponent<T = unknown, TStored = T> {
  <P = unknown>(options: VectorDBUseOptions): PromptPlugin<P>;
  search<P = unknown>(options: VectorDBUseOptions): PromptPlugin<P>;
  index(options: VectorDBEntry<T> & VectorDBScopeOptions): Promise<void>;
  load(options: VectorDBLoadOptions): Promise<MemoryEntry<TStored> | null>;
}

const resolveScope = (options: VectorDBScopeOptions): VectorDBScopeOptions => {
  if (!options.userId && (options.sessionId || options.keyPrefix)) {
    throw new Error("userId is required when using sessionId or keyPrefix.");
  }
  return options;
};

const withUserScope = <T>(
  store: VectorMemory<T>,
  options: VectorDBScopeOptions
): VectorMemory<T> => {
  const scope = resolveScope(options);
  if (!scope.userId) {
    return store;
  }
  return scopeVectorStore(store, {
    userId: scope.userId,
    sessionId: scope.sessionId,
    keyPrefix: scope.keyPrefix,
  });
};

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
  const scopedStore = withUserScope(store, {
    userId: options.userId,
    sessionId: options.sessionId,
    keyPrefix: options.keyPrefix,
  });

  return {
    render: () =>
      VectorSearch<T, ToolIOForProvider<P>>({
        store: scopedStore,
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
        index: async (options: VectorDBEntry<T> & VectorDBScopeOptions) => {
          const scopedStore = withUserScope(baseStore, {
            userId: options.userId,
            sessionId: options.sessionId,
            keyPrefix: options.keyPrefix,
          });
          const value = formatter(options.data);
          await scopedStore.set(options.id, value, options.metadata);
        },
        load: async (
          options: VectorDBLoadOptions
        ): Promise<MemoryEntry<string> | null> => {
          const scopedStore = withUserScope(baseStore, {
            userId: options.userId,
            sessionId: options.sessionId,
            keyPrefix: options.keyPrefix,
          });
          return await scopedStore.get(options.id);
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
      index: async (options: VectorDBEntry<T> & VectorDBScopeOptions) => {
        const scopedStore = withUserScope(baseStore, {
          userId: options.userId,
          sessionId: options.sessionId,
          keyPrefix: options.keyPrefix,
        });
        await scopedStore.set(options.id, options.data, options.metadata);
      },
      load: async (
        options: VectorDBLoadOptions
      ): Promise<MemoryEntry<T> | null> => {
        const scopedStore = withUserScope(baseStore, {
          userId: options.userId,
          sessionId: options.sessionId,
          keyPrefix: options.keyPrefix,
        });
        return await scopedStore.get(options.id);
      },
    }
  );

  return component;
}
