/**
 * Vector store contracts and VectorDB helper.
 */

import type { PromptPlugin } from "../dsl/builder";
import { createMessage, createScope } from "../dsl/strategies";
import { textPart } from "../dsl/templating";
import type { MaybePromise, ToolIOForProvider } from "../types";
import type { KVMemory, MemoryEntry } from "./key-value";

/**
 * Search result from a vector store query.
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
 * Vector store interface for semantic search.
 *
 * Extends the KV store interface with vector-based similarity search.
 * Useful for RAG (Retrieval Augmented Generation), semantic memory,
 * and finding related content.
 *
 * @template T - The type of data stored in the store
 *
 * @example
 * ```typescript
 * // Implementation would use embeddings from OpenAI, Cohere, etc.
 * class PineconeStore<T> implements VectorStore<T> {
 *   async search(query: string, options?: VectorSearchOptions) {
 *     const embedding = await this.embedder(query);
 *     return this.client.query(embedding, options);
 *   }
 *   // ... other methods
 * }
 * ```
 */
export interface VectorStore<T = unknown> extends KVMemory<T> {
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

type VectorDBFilterValue = string | number | boolean;

export interface VectorDBSearchOptions {
  query: string;
  limit?: number;
  filter?: Record<string, VectorDBFilterValue>;
}

export interface VectorDBEntry<T> {
  id: string;
  data: T;
  metadata?: Record<string, unknown>;
}

const DEFAULT_SEARCH_LIMIT = 10;
const DEFAULT_FILTER_OVERFETCH_MULTIPLIER = 5;

const formatEntry = <T>(data: T): string => {
  if (typeof data === "string") {
    return data;
  }
  return JSON.stringify(data, null, 2);
};

const matchesFilter = <T>(
  result: VectorSearchResult<T>,
  filter: Record<string, VectorDBFilterValue>
): boolean => {
  const metadata = result.entry.metadata;
  if (!metadata) {
    return false;
  }

  for (const [key, value] of Object.entries(filter)) {
    if (metadata[key] !== value) {
      return false;
    }
  }

  return true;
};

const formatResults = <T>(results: VectorSearchResult<T>[]): string => {
  if (results.length === 0) {
    return "Vector search returned no results.";
  }

  return results
    .map((result, index) => {
      return `[${index + 1}] (score: ${result.score.toFixed(3)})\n${formatEntry(
        result.entry.data
      )}`;
    })
    .join("\n\n");
};

const resolveSearchLimit = (limit?: number): number => {
  return Math.max(0, Math.trunc(limit ?? DEFAULT_SEARCH_LIMIT));
};

class VectorDBPlugin<P, T> implements PromptPlugin<P> {
  private readonly db: VectorDB<T>;
  private readonly options: VectorDBSearchOptions;

  constructor(db: VectorDB<T>, options: VectorDBSearchOptions) {
    this.db = db;
    this.options = options;
  }

  async render() {
    const content = await this.db.renderSearch(this.options);
    const message = createMessage<ToolIOForProvider<P>>("user", [
      textPart<ToolIOForProvider<P>>(content),
    ]);

    return createScope<ToolIOForProvider<P>>([message]);
  }
}

export class VectorDB<T> {
  private readonly store: VectorStore<T>;

  constructor(store: VectorStore<T>) {
    this.store = store;
  }

  plugin<P = unknown>(options: VectorDBSearchOptions): PromptPlugin<P> {
    return new VectorDBPlugin<P, T>(this, options);
  }

  async index(options: VectorDBEntry<T>): Promise<void> {
    await this.store.set(options.id, options.data, options.metadata);
  }

  async load(options: { id: string }): Promise<MemoryEntry<T> | null> {
    return await this.store.get(options.id);
  }

  async search(query: string, limit: number): Promise<VectorSearchResult<T>[]> {
    return await this.store.search(query, { limit });
  }

  async renderSearch(options: VectorDBSearchOptions): Promise<string> {
    const results = await this.searchWithFilter(options);
    return formatResults(results);
  }

  private async searchWithFilter(
    options: VectorDBSearchOptions
  ): Promise<VectorSearchResult<T>[]> {
    const query = options.query.trim();
    if (!query) {
      throw new Error("VectorDB search requires a non-empty query.");
    }

    const limit = resolveSearchLimit(options.limit);
    const filter = options.filter;
    const searchLimit = filter
      ? limit * DEFAULT_FILTER_OVERFETCH_MULTIPLIER
      : limit;

    const rawResults = await this.search(query, searchLimit);
    const filteredResults = filter
      ? rawResults.filter((result) => matchesFilter(result, filter))
      : rawResults;

    return filteredResults.slice(0, limit);
  }
}

export const vectordb = <T>(store: VectorStore<T>): VectorDB<T> => {
  return new VectorDB(store);
};
