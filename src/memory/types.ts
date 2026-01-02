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
 * Options for listing entries.
 */
export interface KVListOptions {
  /** Filter to keys starting with this prefix */
  prefix?: string;
  /** Maximum number of entries to return */
  limit?: number;
  /** Cursor for pagination (implementation-specific) */
  cursor?: string;
}

/**
 * Result of a list operation with pagination support.
 */
export interface KVListResult<T = unknown> {
  /** The entries matching the query */
  entries: Array<{ key: string; entry: MemoryEntry<T> }>;
  /** Cursor for the next page, null if no more results */
  nextCursor: string | null;
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
   * List entries, optionally filtered by prefix.
   * @param options - List options including prefix filter and pagination
   * @returns Entries and pagination cursor
   */
  list(options?: KVListOptions): MaybePromise<KVListResult<T>>;

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
 * Search result from a vector memory query.
 */
export interface VectorSearchResult<T = unknown> {
  /** The matching entry */
  entry: MemoryEntry<T>;
  /** The key of the matching entry */
  key: string;
  /** Similarity score (0-1, higher is more similar) */
  score: number;
}

/**
 * Options for vector search operations.
 */
export interface VectorSearchOptions {
  /** Maximum number of results to return. Default: 10 */
  limit?: number;
  /** Minimum similarity threshold (0-1). Results below this are excluded. */
  threshold?: number;
}

/**
 * Vector memory interface for semantic search.
 *
 * Extends the KV memory interface with vector-based similarity search.
 * Useful for RAG (Retrieval Augmented Generation), semantic memory,
 * and finding related content.
 *
 * @template T - The type of data stored in the memory
 *
 * @example
 * ```typescript
 * // Implementation would use embeddings from OpenAI, Cohere, etc.
 * class PineconeStore<T> implements VectorMemory<T> {
 *   async search(query: string, options?: VectorSearchOptions) {
 *     const embedding = await this.embedder(query);
 *     return this.client.query(embedding, options);
 *   }
 *   // ... other methods
 * }
 * ```
 */
export interface VectorMemory<T = unknown> extends KVMemory<T> {
  /**
   * Search for entries semantically similar to the query.
   * @param query - The search query (will be embedded)
   * @param options - Search options
   * @returns Matching entries sorted by similarity (highest first)
   */
  search(
    query: string,
    options?: VectorSearchOptions
  ): MaybePromise<VectorSearchResult<T>[]>;
}
