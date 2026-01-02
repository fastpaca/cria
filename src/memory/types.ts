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
 * Base memory interface for LLM-related storage.
 *
 * This is the foundation interface that all memory backends implement.
 * It provides simple key-value operations suitable for storing summaries,
 * conversation state, embeddings, and other LLM-related data.
 *
 * @template T - The type of data stored in the memory
 *
 * @example
 * ```typescript
 * // Create an in-memory store for summaries
 * const summaryMemory = createMemory<StoredSummary>();
 *
 * await summaryMemory.set("conv-123", {
 *   content: "User asked about Paris",
 *   tokenCount: 5,
 * });
 *
 * const entry = await summaryMemory.get("conv-123");
 * ```
 */
export interface LLMMemory<T = unknown> {
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
 * Extends the base memory interface with vector-based similarity search.
 * Useful for RAG (Retrieval Augmented Generation), semantic memory,
 * and finding related content.
 *
 * @template T - The type of data stored in the memory
 *
 * @example
 * ```typescript
 * // Implementation would use embeddings from OpenAI, Cohere, etc.
 * const vectorMemory: VectorMemory<Document> = createVectorMemory({
 *   embedder: async (text) => await openai.embeddings.create({ input: text }),
 * });
 *
 * await vectorMemory.set("doc-1", { content: "Paris is the capital of France" });
 *
 * const results = await vectorMemory.search("What's the French capital?", {
 *   limit: 5,
 *   threshold: 0.7,
 * });
 * ```
 */
export interface VectorMemory<T = unknown> extends LLMMemory<T> {
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

/**
 * Options for listing entries in a KV memory.
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
 * Key-value memory interface with listing capabilities.
 *
 * Extends the base memory interface with bulk operations like
 * listing and clearing. Useful for caching, session storage,
 * and scenarios where you need to iterate over entries.
 *
 * @template T - The type of data stored in the memory
 *
 * @example
 * ```typescript
 * const kvMemory: KVMemory<CachedResponse> = createKVMemory();
 *
 * // Store some entries
 * await kvMemory.set("cache:api:user-1", { result: "..." });
 * await kvMemory.set("cache:api:user-2", { result: "..." });
 *
 * // List all cache entries
 * const { entries } = await kvMemory.list({ prefix: "cache:api:" });
 *
 * // Clear all entries
 * await kvMemory.clear();
 * ```
 */
export interface KVMemory<T = unknown> extends LLMMemory<T> {
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
