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
  /** Additional metadata to attach on write */
  metadata?: Record<string, unknown>;
}

interface UserScope {
  keyPrefix: string;
  metadata: Record<string, unknown>;
  userId: string;
  sessionId?: string;
}

const createScope = (options: UserScopeOptions): UserScope => {
  const { userId, sessionId, keyPrefix, metadata } = options;
  const scopeKey =
    keyPrefix ??
    (sessionId ? `user:${userId}:session:${sessionId}` : `user:${userId}`);

  return {
    keyPrefix: scopeKey,
    metadata: {
      ...(metadata ?? {}),
      userId,
      ...(sessionId ? { sessionId } : {}),
    },
    userId,
    ...(sessionId ? { sessionId } : {}),
  };
};

const scopedKeyFor = (scope: UserScope, key: string): string => {
  const prefix = `${scope.keyPrefix}:`;
  return key.startsWith(prefix) ? key : `${scope.keyPrefix}:${key}`;
};

const stripScopeKey = (scope: UserScope, key: string): string => {
  const prefix = `${scope.keyPrefix}:`;
  return key.startsWith(prefix) ? key.slice(prefix.length) : key;
};

const mergeMetadata = (
  scope: UserScope,
  metadata?: Record<string, unknown>
): Record<string, unknown> => ({
  ...(metadata ?? {}),
  ...scope.metadata,
});

const resultMatchesScope = <T>(
  scope: UserScope,
  result: VectorSearchResult<T>
): boolean => {
  const prefix = `${scope.keyPrefix}:`;
  if (result.key.startsWith(prefix)) {
    return true;
  }

  const entryMetadata = result.entry.metadata as
    | { userId?: string; sessionId?: string }
    | undefined;
  if (!entryMetadata) {
    return false;
  }

  const userId = entryMetadata.userId;
  if (userId !== scope.userId) {
    return false;
  }

  const sessionId = entryMetadata.sessionId;
  if (scope.sessionId && sessionId !== scope.sessionId) {
    return false;
  }

  return true;
};

export class UserScopedStore<T = unknown> implements KVMemory<T> {
  protected readonly store: KVMemory<T>;
  protected readonly scope: UserScope;

  constructor(store: KVMemory<T>, options: UserScopeOptions) {
    this.store = store;
    this.scope = createScope(options);
  }

  async get(key: string): Promise<MemoryEntry<T> | null> {
    return await this.store.get(scopedKeyFor(this.scope, key));
  }

  async set(
    key: string,
    data: T,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    await this.store.set(
      scopedKeyFor(this.scope, key),
      data,
      mergeMetadata(this.scope, metadata)
    );
  }

  async delete(key: string): Promise<boolean> {
    return await this.store.delete(scopedKeyFor(this.scope, key));
  }
}

export class UserScopedVectorStore<T = unknown>
  extends UserScopedStore<T>
  implements VectorMemory<T>
{
  private readonly vectorStore: VectorMemory<T>;

  constructor(store: VectorMemory<T>, options: UserScopeOptions) {
    super(store, options);
    this.vectorStore = store;
  }

  async search(
    query: string,
    options?: VectorSearchOptions
  ): Promise<VectorSearchResult<T>[]> {
    const results = await this.vectorStore.search(query, options);
    return results
      .filter((result) => resultMatchesScope(this.scope, result))
      .map((result) => ({
        ...result,
        key: stripScopeKey(this.scope, result.key),
      }));
  }
}
