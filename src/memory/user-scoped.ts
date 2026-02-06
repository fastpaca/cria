import type { KVMemory, MemoryEntry } from "./key-value";
import type {
  VectorMemory,
  VectorSearchOptions,
  VectorSearchResult,
} from "./vector";

/**
 * Namespacing options for multi-tenant memory wrappers.
 * Stores remain unchanged; wrappers only prefix keys + attach metadata.
 */
export interface UserScopeOptions {
  /** Required user identifier for scoping */
  userId: string;
  /** Optional session identifier for further scoping */
  sessionId?: string;
  /** Override the default key prefix */
  keyPrefix?: string;
}

const SCOPED_SEARCH_OVERFETCH_MULTIPLIER = 5;

interface ScopeConfig {
  keyPrefix: string;
  metadata: Record<string, unknown>;
}

const resolveScopeConfig = (options: UserScopeOptions): ScopeConfig => {
  const basePrefix =
    options.keyPrefix ??
    (options.sessionId
      ? `user:${options.userId}:session:${options.sessionId}`
      : `user:${options.userId}`);
  const keyPrefix = basePrefix.endsWith(":") ? basePrefix : `${basePrefix}:`;

  return {
    keyPrefix,
    metadata: {
      userId: options.userId,
      ...(options.sessionId ? { sessionId: options.sessionId } : {}),
    },
  };
};

const mergeMetadata = (
  metadata: Record<string, unknown> | undefined,
  scopeMetadata: Record<string, unknown>
): Record<string, unknown> => ({ ...(metadata ?? {}), ...scopeMetadata });

export const scopeKVStore = <T>(
  store: KVMemory<T>,
  options: UserScopeOptions
): KVMemory<T> => {
  const scope = resolveScopeConfig(options);
  const scopedKey = (key: string): string => `${scope.keyPrefix}${key}`;

  return {
    get: async (key: string): Promise<MemoryEntry<T> | null> =>
      await store.get(scopedKey(key)),
    set: async (
      key: string,
      data: T,
      entryMetadata?: Record<string, unknown>
    ): Promise<void> => {
      await store.set(
        scopedKey(key),
        data,
        mergeMetadata(entryMetadata, scope.metadata)
      );
    },
    delete: async (key: string): Promise<boolean> =>
      await store.delete(scopedKey(key)),
  };
};

export const scopeVectorStore = <T>(
  store: VectorMemory<T>,
  options: UserScopeOptions
): VectorMemory<T> => {
  const scope = resolveScopeConfig(options);
  const scopedKey = (key: string): string => `${scope.keyPrefix}${key}`;

  return {
    get: async (key: string): Promise<MemoryEntry<T> | null> =>
      await store.get(scopedKey(key)),
    set: async (
      key: string,
      data: T,
      entryMetadata?: Record<string, unknown>
    ): Promise<void> => {
      await store.set(
        scopedKey(key),
        data,
        mergeMetadata(entryMetadata, scope.metadata)
      );
    },
    delete: async (key: string): Promise<boolean> =>
      await store.delete(scopedKey(key)),
    search: async (
      query: string,
      options?: VectorSearchOptions
    ): Promise<VectorSearchResult<T>[]> => {
      const scopedLimit = options?.limit;
      const searchOptions =
        scopedLimit === undefined
          ? options
          : {
              ...(options ?? {}),
              limit: scopedLimit * SCOPED_SEARCH_OVERFETCH_MULTIPLIER,
            };
      const results = await store.search(query, searchOptions);

      const scopedResults = results
        .filter((result) => result.key.startsWith(scope.keyPrefix))
        .map((result) => ({
          ...result,
          key: result.key.slice(scope.keyPrefix.length),
        }));

      if (scopedLimit === undefined) {
        return scopedResults;
      }

      return scopedResults.slice(0, scopedLimit);
    },
  };
};
