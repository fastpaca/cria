import type { MaybePromise } from "../types";
import type { KVMemory, MemoryEntry } from "./key-value";

/**
 * An embedding function that converts text to a vector.
 */
export type EmbeddingFunction = (text: string) => Promise<number[]>;

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
