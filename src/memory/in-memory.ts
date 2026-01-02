import type { KVMemory, MemoryEntry } from "./types";

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
