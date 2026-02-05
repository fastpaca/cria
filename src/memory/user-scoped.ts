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

export class UserScopedStore<T = unknown> implements KVMemory<T> {
  protected readonly store: KVMemory<T>;
  protected readonly keyPrefix: string;
  protected readonly scopeMetadata: Record<string, unknown>;
  protected readonly userId: string;
  protected readonly sessionId: string | undefined;

  constructor(store: KVMemory<T>, options: UserScopeOptions) {
    this.store = store;
    this.userId = options.userId;
    this.sessionId = options.sessionId;
    this.keyPrefix =
      options.keyPrefix ??
      (options.sessionId
        ? `user:${options.userId}:session:${options.sessionId}`
        : `user:${options.userId}`);
    this.scopeMetadata = {
      ...options.metadata,
      userId: options.userId,
      ...(options.sessionId ? { sessionId: options.sessionId } : {}),
    };
  }

  protected scopedKey(key: string): string {
    const prefix = `${this.keyPrefix}:`;
    return key.startsWith(prefix) ? key : `${this.keyPrefix}:${key}`;
  }

  protected stripPrefix(key: string): string {
    const prefix = `${this.keyPrefix}:`;
    return key.startsWith(prefix) ? key.slice(prefix.length) : key;
  }

  async get(key: string): Promise<MemoryEntry<T> | null> {
    return await this.store.get(this.scopedKey(key));
  }

  async set(
    key: string,
    data: T,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    await this.store.set(this.scopedKey(key), data, {
      ...metadata,
      ...this.scopeMetadata,
    });
  }

  async delete(key: string): Promise<boolean> {
    return await this.store.delete(this.scopedKey(key));
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
    const prefix = `${this.keyPrefix}:`;

    return results
      .filter((result) => {
        if (result.key.startsWith(prefix)) {
          return true;
        }
        const meta = result.entry.metadata as
          | { userId?: string; sessionId?: string }
          | undefined;
        if (!meta || meta.userId !== this.userId) {
          return false;
        }
        return !this.sessionId || meta.sessionId === this.sessionId;
      })
      .map((result) => ({
        ...result,
        key: this.stripPrefix(result.key),
      }));
  }
}
