/**
 * LLM Memory interfaces and implementations.
 *
 * @example
 * ```typescript
 * import { InMemoryStore, type StoredSummary } from "@fastpaca/cria";
 *
 * const store = new InMemoryStore<StoredSummary>();
 * ```
 *
 * @packageDocumentation
 */

export { InMemoryStore } from "./in-memory";
export type {
  KVMemory,
  MemoryEntry,
  VectorMemory,
  VectorSearchOptions,
  VectorSearchResult,
} from "./types";
