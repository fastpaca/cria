/**
 * Vector DB helper for shared retrieval + indexing.
 */

import type { VectorMemory } from "../memory";
import type { ToolIOForProvider } from "../types";
import type { PromptPlugin } from "./builder";
import { VectorSearch } from "./vector-search";

export interface VectorDBSearchOptions {
  query: string;
  limit: number;
}

export interface VectorDBEntry<T> {
  id: string;
  data: T;
  metadata?: Record<string, unknown>;
}

export type VectorDBFormatter<T> = (data: T) => string;

export type VectorDBOptions<T> =
  | { store: VectorMemory<T> }
  | { store: VectorMemory<string>; format: VectorDBFormatter<T> };

export class VectorDB<T> {
  private readonly store: VectorMemory<unknown>;
  private readonly format: VectorDBFormatter<T> | null;

  constructor(options: VectorDBOptions<T>) {
    if ("format" in options) {
      this.store = options.store;
      this.format = options.format;
    } else {
      this.store = options.store;
      this.format = null;
    }
  }

  search<P = unknown>(options: VectorDBSearchOptions): PromptPlugin<P> {
    return {
      render: () =>
        VectorSearch<unknown, ToolIOForProvider<P>>({
          store: this.store,
          query: options.query,
          limit: options.limit,
        }),
    };
  }

  async index({ id, data, metadata }: VectorDBEntry<T>): Promise<void> {
    const value = this.format ? this.format(data) : data;
    await this.store.set(id, value, metadata);
  }
}
