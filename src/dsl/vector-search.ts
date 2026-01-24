/**
 * VectorSearch async component for RAG-style retrieval.
 */

import type { VectorMemory, VectorSearchResult } from "../memory";
import type { PromptScope, ProviderToolIO } from "../types";
import { createMessage, createScope } from "./strategies";
import { textPart } from "./templating";

/**
 * Default formatter that renders results as a numbered list.
 * Returns a placeholder string when no results are found so prompts can degrade gracefully.
 */
function defaultFormatter<T>(results: VectorSearchResult<T>[]): string {
  if (results.length === 0) {
    return "Vector search returned no results.";
  }

  return results
    .map((result, index) => {
      const data =
        typeof result.entry.data === "string"
          ? result.entry.data
          : JSON.stringify(result.entry.data, null, 2);
      return `[${index + 1}] (score: ${result.score.toFixed(3)})\n${data}`;
    })
    .join("\n\n");
}

interface VectorSearchProps<
  T = unknown,
  TToolIO extends ProviderToolIO = ProviderToolIO,
> {
  /** Vector memory store to search */
  store: VectorMemory<T>;
  /** Query string */
  query: string;
  /** Maximum number of results to return */
  limit: number;
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
}: VectorSearchProps<T, TToolIO>): Promise<PromptScope<TToolIO>> {
  const finalQuery = query.trim();
  if (finalQuery.length === 0) {
    throw new Error("VectorSearch: query must be a non-empty string.");
  }

  const results = await store.search(finalQuery, { limit });
  const content = defaultFormatter(results);

  const message = createMessage<TToolIO>("user", [textPart<TToolIO>(content)]);
  return createScope<TToolIO>([message]);
}
