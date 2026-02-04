/**
 * VectorSearch async component for RAG-style retrieval.
 */

import type { VectorMemory, VectorSearchResult } from "../memory";
import type { PromptScope, ProviderToolIO } from "../types";
import { createMessage, createScope } from "./strategies";
import { textPart } from "./templating";

/**
 * Formatter for vector search entries.
 */
export type VectorSearchFormatter<T> = (data: T) => string;

const defaultFormatter = <T>(data: T): string => {
  if (typeof data === "string") {
    return data;
  }
  return JSON.stringify(data, null, 2);
};

/**
 * Render results as a numbered list.
 * Returns a placeholder string when no results are found so prompts can degrade gracefully.
 */
function formatResults<T>(
  results: VectorSearchResult<T>[],
  format: VectorSearchFormatter<T>
): string {
  if (results.length === 0) {
    return "Vector search returned no results.";
  }

  return results
    .map((result, index) => {
      return `[${index + 1}] (score: ${result.score.toFixed(3)})\n${format(
        result.entry.data
      )}`;
    })
    .join("\n\n");
}

interface VectorSearchProps<T = unknown> {
  /** Vector memory store to search */
  store: VectorMemory<T>;
  /** Query string */
  query: string;
  /** Maximum number of results to return */
  limit: number;
  /** Optional formatter for each entry */
  format?: VectorSearchFormatter<T>;
}

/**
 * Renders vector search results into a scoped message.
 */
export async function VectorSearch<
  T = unknown,
  TToolIO extends ProviderToolIO = ProviderToolIO,
>({
  store,
  query,
  limit,
  format,
}: VectorSearchProps<T>): Promise<PromptScope<TToolIO>> {
  const finalQuery = query.trim();
  if (finalQuery.length === 0) {
    throw new Error("VectorSearch: query must be a non-empty string.");
  }

  const results = await store.search(finalQuery, { limit });
  const content = formatResults(results, format ?? defaultFormatter);

  const message = createMessage<TToolIO>("user", [textPart<TToolIO>(content)]);
  return createScope<TToolIO>([message]);
}
