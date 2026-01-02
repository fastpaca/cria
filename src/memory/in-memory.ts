import type {
  KVListOptions,
  KVListResult,
  KVMemory,
  MemoryEntry,
} from "./types";

/**
 * Creates an in-memory KV store.
 *
 * This is the simplest memory implementation, storing everything in a Map.
 * Suitable for development, testing, and short-lived applications.
 * For production use, consider a persistent backend like Redis or a database.
 *
 * @template T - The type of data to store
 *
 * @example
 * ```typescript
 * import { createMemory } from "@fastpaca/cria";
 *
 * // Simple usage
 * const memory = createMemory<{ content: string }>();
 * await memory.set("key-1", { content: "Hello" });
 *
 * // With Summary component
 * const store = createMemory<StoredSummary>();
 * <Summary store={store} ... />
 * ```
 */
export function createMemory<T = unknown>(): KVMemory<T> {
  const store = new Map<string, MemoryEntry<T>>();

  return {
    get(key) {
      return store.get(key) ?? null;
    },

    set(key, data, metadata) {
      const now = Date.now();
      const existing = store.get(key);

      store.set(key, {
        data,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        ...(metadata && { metadata }),
      });
    },

    delete(key) {
      return store.delete(key);
    },

    has(key) {
      return store.has(key);
    },

    list(options?: KVListOptions): KVListResult<T> {
      const { prefix, limit, cursor } = options ?? {};
      const allKeys = [...store.keys()];

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
        entry: store.get(key) as MemoryEntry<T>,
      }));

      // Determine next cursor
      const lastKey = pageKeys.at(-1);
      const hasMore =
        lastKey && filteredKeys.indexOf(lastKey) < filteredKeys.length - 1;

      return {
        entries,
        nextCursor: hasMore && lastKey ? lastKey : null,
      };
    },

    clear() {
      store.clear();
    },

    size() {
      return store.size;
    },
  };
}
