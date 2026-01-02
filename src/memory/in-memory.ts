import type {
  KVListOptions,
  KVListResult,
  KVMemory,
  MemoryEntry,
} from "./types";

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

  list(options?: KVListOptions): KVListResult<T> {
    const { prefix, limit, cursor } = options ?? {};
    const allKeys = [...this.store.keys()];

    // Filter by prefix if provided
    const filteredKeys = prefix
      ? allKeys.filter((k) => k.startsWith(prefix))
      : allKeys;

    // Sort by key for consistent ordering
    filteredKeys.sort();

    // Handle cursor-based pagination
    let startIndex = 0;
    if (cursor) {
      const cursorIndex = filteredKeys.indexOf(cursor);
      if (cursorIndex >= 0) {
        startIndex = cursorIndex + 1;
      }
    }

    // Apply limit
    const pageKeys = limit
      ? filteredKeys.slice(startIndex, startIndex + limit)
      : filteredKeys.slice(startIndex);

    const entries = pageKeys.map((key) => ({
      key,
      entry: this.store.get(key) as MemoryEntry<T>,
    }));

    // Determine next cursor
    const lastKey = pageKeys.at(-1);
    const hasMore =
      lastKey && filteredKeys.indexOf(lastKey) < filteredKeys.length - 1;

    return {
      entries,
      nextCursor: hasMore && lastKey ? lastKey : null,
    };
  }

  clear(): void {
    this.store.clear();
  }

  size(): number {
    return this.store.size;
  }
}
