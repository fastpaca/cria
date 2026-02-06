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
}

/**
 * In-memory implementation of KVMemory.
 *
 * @template T - The type of data to store
 *
 * @example
 * ```typescript
 * import { InMemoryStore, cria, type StoredSummary } from "@fastpaca/cria";
 * import { createProvider } from "@fastpaca/cria/openai";
 * import OpenAI from "openai";
 *
 * const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
 * const provider = createProvider(client, "gpt-4o-mini");
 *
 * const store = new InMemoryStore<StoredSummary>();
 * const summarizer = cria.summarizer({ id: "conv", store, provider });
 * const summary = summarizer.plugin({ history });
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
}
