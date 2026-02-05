import type { KVMemory, MemoryEntry } from "./key-value";
import type {
  VectorMemory,
  VectorSearchOptions,
  VectorSearchResult,
} from "./vector";

export interface UserScopeOptions {
  /** Required user identifier for scoping */
  userId: string;
  /** Optional session identifier for further scoping */
  sessionId?: string;
  /** Override the default key prefix */
  keyPrefix?: string;
}

const buildKeyPrefix = (options: UserScopeOptions): string => {
  if (options.keyPrefix) {
    return options.keyPrefix;
  }
  return options.sessionId
    ? `user:${options.userId}:session:${options.sessionId}`
    : `user:${options.userId}`;
};

const scopeMetadata = (options: UserScopeOptions): Record<string, unknown> => ({
  userId: options.userId,
  ...(options.sessionId ? { sessionId: options.sessionId } : {}),
});

const mergeMetadata = (
  metadata: Record<string, unknown> | undefined,
  extra: Record<string, unknown>
): Record<string, unknown> => ({ ...(metadata ?? {}), ...extra });

export const scopeKVStore = <T>(
  store: KVMemory<T>,
  options: UserScopeOptions
): KVMemory<T> => {
  const keyPrefix = `${buildKeyPrefix(options)}:`;
  const metadata = scopeMetadata(options);

  return {
    get: async (key: string): Promise<MemoryEntry<T> | null> =>
      await store.get(`${keyPrefix}${key}`),
    set: async (
      key: string,
      data: T,
      entryMetadata?: Record<string, unknown>
    ): Promise<void> => {
      await store.set(
        `${keyPrefix}${key}`,
        data,
        mergeMetadata(entryMetadata, metadata)
      );
    },
    delete: async (key: string): Promise<boolean> =>
      await store.delete(`${keyPrefix}${key}`),
  };
};

export const scopeVectorStore = <T>(
  store: VectorMemory<T>,
  options: UserScopeOptions
): VectorMemory<T> => {
  const keyPrefix = `${buildKeyPrefix(options)}:`;
  const metadata = scopeMetadata(options);

  return {
    get: async (key: string): Promise<MemoryEntry<T> | null> =>
      await store.get(`${keyPrefix}${key}`),
    set: async (
      key: string,
      data: T,
      entryMetadata?: Record<string, unknown>
    ): Promise<void> => {
      await store.set(
        `${keyPrefix}${key}`,
        data,
        mergeMetadata(entryMetadata, metadata)
      );
    },
    delete: async (key: string): Promise<boolean> =>
      await store.delete(`${keyPrefix}${key}`),
    search: async (
      query: string,
      options?: VectorSearchOptions
    ): Promise<VectorSearchResult<T>[]> => {
      const results = await store.search(query, options);

      return results
        .filter((result) => result.key.startsWith(keyPrefix))
        .map((result) => ({
          ...result,
          key: result.key.slice(keyPrefix.length),
        }));
    },
  };
};
