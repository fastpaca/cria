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

type VectorDBMode<T> =
  | { kind: "raw"; store: VectorMemory<T> }
  | {
      kind: "formatted";
      store: VectorMemory<string>;
      format: VectorDBFormatter<T>;
    };

export type VectorDBOptions<T> =
  | { store: VectorMemory<T> }
  | { store: VectorMemory<string>; format: VectorDBFormatter<T> };

export class VectorDB<T> {
  private readonly mode: VectorDBMode<T>;

  constructor(options: VectorDBOptions<T>) {
    if ("format" in options) {
      this.mode = {
        kind: "formatted",
        store: options.store,
        format: options.format,
      };
    } else {
      this.mode = { kind: "raw", store: options.store };
    }
  }

  search<P = unknown>(options: VectorDBSearchOptions): PromptPlugin<P> {
    const mode = this.mode;
    if (mode.kind === "formatted") {
      return {
        render: () =>
          VectorSearch<string, ToolIOForProvider<P>>({
            store: mode.store,
            query: options.query,
            limit: options.limit,
          }),
      };
    }

    return {
      render: () =>
        VectorSearch<T, ToolIOForProvider<P>>({
          store: mode.store,
          query: options.query,
          limit: options.limit,
        }),
    };
  }

  async index({ id, data, metadata }: VectorDBEntry<T>): Promise<void> {
    const mode = this.mode;
    if (mode.kind === "formatted") {
      await mode.store.set(id, mode.format(data), metadata);
      return;
    }

    await mode.store.set(id, data, metadata);
  }
}
