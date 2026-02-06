/**
 * Vector DB helper for shared retrieval + indexing.
 */

import type { PromptPlugin } from "../dsl/builder";
import { createMessage, createScope } from "../dsl/strategies";
import { textPart } from "../dsl/templating";
import type { ToolIOForProvider } from "../types";
import type { MemoryEntry } from "./key-value";
import type { VectorMemory, VectorSearchResult } from "./vector";

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

class VectorDBPlugin<P, T> implements PromptPlugin<P> {
  private readonly db: VectorDB<T>;
  private readonly options: VectorDBSearchOptions;

  constructor(db: VectorDB<T>, options: VectorDBSearchOptions) {
    this.db = db;
    this.options = options;
  }

  async render() {
    const query = this.options.query.trim();
    if (!query) {
      throw new Error("VectorDB search requires a non-empty query.");
    }
    const filter = this.options.filter;
    const limit = this.options.limit ?? DEFAULT_SEARCH_LIMIT;
    const searchLimit = filter
      ? limit * DEFAULT_FILTER_OVERFETCH_MULTIPLIER
      : limit;

    const rawResults = await this.db.search(query, searchLimit);
    const results = filter
      ? rawResults.filter((result) => matchesFilter(result, filter))
      : rawResults;
    const content = formatResults(results.slice(0, limit));
    const message = createMessage<ToolIOForProvider<P>>("user", [
      textPart<ToolIOForProvider<P>>(content),
    ]);

    return createScope<ToolIOForProvider<P>>([message]);
  }
}

export class VectorDB<T> {
  private readonly store: VectorMemory<T>;

  constructor(store: VectorMemory<T>) {
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
}

export const vectordb = <T>(store: VectorMemory<T>): VectorDB<T> => {
  return new VectorDB(store);
};
