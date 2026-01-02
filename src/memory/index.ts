/**
 * LLM Memory interfaces and implementations.
 *
 * This module provides storage abstractions for LLM-related data like
 * conversation summaries, embeddings, cached responses, and more.
 *
 * @example
 * ```typescript
 * import { createMemory } from "@fastpaca/cria";
 *
 * // Create an in-memory store
 * const memory = createMemory<{ content: string }>();
 *
 * // Use with Summary component
 * <Summary store={memory} ... />
 * ```
 *
 * @packageDocumentation
 */

export { createMemory } from "./in-memory";
export type {
  KVListOptions,
  KVListResult,
  KVMemory,
  LLMMemory,
  MemoryEntry,
  VectorMemory,
  VectorSearchOptions,
  VectorSearchResult,
} from "./types";
