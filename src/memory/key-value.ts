import type { MaybePromise } from "../types";

/**
 * A stored memory entry with metadata.
 *
 * @template T - The type of data stored in the entry
 */
export interface MemoryEntry<T = unknown> {
  /** The stored data */
  data: T;
  /** When the entry was created (epoch ms) */
  createdAt: number;
  /** When the entry was last updated (epoch ms) */
  updatedAt: number;
  /** Optional metadata for the entry */
  metadata?: Record<string, unknown>;
}

/**
 * Key-value memory interface for LLM-related storage.
 *
 * This is the base interface for storing summaries, conversation state,
 * cached responses, and other LLM-related data.
 *
 * @template T - The type of data stored in the memory
 *
 * @example
 * ```typescript
 * import { InMemoryStore } from "@fastpaca/cria";
 *
 * const store = new InMemoryStore<{ content: string }>();
 *
 * await store.set("key-1", { content: "Hello" });
 * const entry = await store.get("key-1");
 * ```
 */
export interface KVMemory<T = unknown> {
  /**
   * Retrieve an entry by its key.
   * @returns The entry if found, null otherwise
   */
  get(key: string): MaybePromise<MemoryEntry<T> | null>;

  /**
   * Store or update an entry.
   * @param key - The unique key for this entry
   * @param data - The data to store
   * @param metadata - Optional metadata to attach
   */
  set(
    key: string,
    data: T,
    metadata?: Record<string, unknown>
  ): MaybePromise<void>;

  /**
   * Delete an entry by its key.
   * @returns true if the entry existed and was deleted, false otherwise
   */
  delete(key: string): MaybePromise<boolean>;

  /**
   * Check if an entry exists.
   * @returns true if the entry exists, false otherwise
   */
  has(key: string): MaybePromise<boolean>;

  /**
   * List all entries.
   * @param prefix - Optional prefix to filter keys
   * @returns Array of key-entry pairs
   */
  list(
    prefix?: string
  ): MaybePromise<Array<{ key: string; entry: MemoryEntry<T> }>>;

  /**
   * Delete all entries.
   */
  clear(): MaybePromise<void>;

  /**
   * Get the total number of entries.
   */
  size(): MaybePromise<number>;
}

/**
 * In-memory implementation of KVMemory.
 *
 * Stores everything in a Map. Suitable for development, testing,
 * and short-lived applications. For production, use a persistent
 * backend like Redis or a database.
 *
 * @template T - The type of data to store
 *
 * @example
 * ```typescript
 * import { InMemoryStore, Summary, type StoredSummary } from "@fastpaca/cria";
 *
 * const store = new InMemoryStore<StoredSummary>();
 *
 * <Summary store={store} ... />
 * ```
 */
export class InMemoryStore<T = unknown> implements KVMemory<T> {
  private readonly store = new Map<string, MemoryEntry<T>>();

  get(key: string): MemoryEntry<T> | null {
    return this.store.get(key) ?? null;
  }

  set(key: string, data: T, metadata?: Record<string, unknown>): void {
    const now = Date.now();
    const existing = this.store.get(key);

    this.store.set(key, {
      data,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      ...(metadata && { metadata }),
    });
  }

  delete(key: string): boolean {
    return this.store.delete(key);
  }

  has(key: string): boolean {
    return this.store.has(key);
  }

  list(prefix?: string): Array<{ key: string; entry: MemoryEntry<T> }> {
    const entries: Array<{ key: string; entry: MemoryEntry<T> }> = [];

    for (const [key, entry] of this.store) {
      if (!prefix || key.startsWith(prefix)) {
        entries.push({ key, entry });
      }
    }

    return entries;
  }

  clear(): void {
    this.store.clear();
  }

  size(): number {
    return this.store.size;
  }
}
