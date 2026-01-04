import type {
  VectorMemory,
  VectorSearchOptions,
  VectorSearchResult,
} from "../memory";
import type { PromptChildren, PromptElement } from "../types";

/**
 * Function that formats search results into prompt content.
 *
 * @template T - The type of data stored in the vector memory
 */
export type ResultFormatter<T = unknown> = (
  results: VectorSearchResult<T>[]
) => string;

/**
 * Default formatter that renders results as a numbered list.
 */
function defaultFormatter<T>(results: VectorSearchResult<T>[]): string {
  if (results.length === 0) {
    return "[No relevant results found]";
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

interface VectorSearchProps<T = unknown> {
  /** Pre-fetched search results from a VectorMemory store */
  results: VectorSearchResult<T>[];
  /** Custom formatter for search results. Default: numbered list format */
  formatResults?: ResultFormatter<T>;
  /** Priority for this region (higher number = reduced first). Default: 0 */
  priority?: number;
  /** Stable identifier for caching/debugging */
  id?: string;
}

/**
 * Renders vector search results into the prompt.
 *
 * This component formats pre-fetched search results for inclusion in the prompt.
 * It's the core building block for RAG (Retrieval Augmented Generation) workflows.
 *
 * Search results should be fetched before rendering using the VectorMemory.search() method.
 * This explicit pattern keeps the component pure and makes caching/debugging easier.
 *
 * @example
 * ```tsx
 * import { VectorSearch } from "@fastpaca/cria";
 * import { ChromaStore } from "@fastpaca/cria/memory/chroma"; // adapter
 *
 * const store = new ChromaStore({ collection: "my-collection", ... });
 * const results = await store.search(userQuestion, { limit: 5, threshold: 0.7 });
 *
 * <VectorSearch results={results} priority={1} />
 * ```
 *
 * @example Custom formatter
 * ```tsx
 * <VectorSearch
 *   results={results}
 *   formatResults={(results) =>
 *     results.map(r => `• ${r.entry.data.title}: ${r.entry.data.content}`).join("\n")
 *   }
 * />
 * ```
 */
export function VectorSearch<T = unknown>({
  results,
  formatResults = defaultFormatter,
  priority = 0,
  id,
}: VectorSearchProps<T>): PromptElement {
  const content = formatResults(results);

  return {
    priority,
    children: [content] as PromptChildren,
    ...(id && { id }),
  };
}

interface SearchAndRenderOptions<T = unknown> {
  /** The search query string */
  query: string;
  /** Vector memory store to search */
  store: VectorMemory<T>;
  /** Maximum number of results to return. Default: 5 */
  limit?: number;
  /** Minimum similarity threshold (0-1). Results below this are excluded. */
  threshold?: number;
  /** Custom formatter for search results. Default: numbered list format */
  formatResults?: ResultFormatter<T>;
  /** Priority for this region (higher number = reduced first). Default: 0 */
  priority?: number;
  /** Stable identifier for caching/debugging */
  id?: string;
}

/**
 * Helper function that performs search and returns a VectorSearch element.
 *
 * This is a convenience wrapper that combines the search and render steps.
 * For more control over caching or error handling, use the store.search()
 * and VectorSearch component separately.
 *
 * @example
 * ```tsx
 * import { searchAndRender } from "@fastpaca/cria";
 *
 * // In an async context:
 * const element = await searchAndRender({
 *   query: userQuestion,
 *   store: chromaStore,
 *   limit: 5,
 *   threshold: 0.7,
 *   priority: 1,
 * });
 *
 * // Use in your prompt tree
 * <Region>
 *   <Message messageRole="system">Use this context:</Message>
 *   {element}
 * </Region>
 * ```
 */
export async function searchAndRender<T = unknown>({
  query,
  store,
  limit = 5,
  threshold,
  formatResults = defaultFormatter,
  priority = 0,
  id,
}: SearchAndRenderOptions<T>): Promise<PromptElement> {
  const searchOptions: VectorSearchOptions = {
    limit,
    ...(threshold !== undefined && { threshold }),
  };

  const results = await store.search(query, searchOptions);

  return VectorSearch({
    results,
    formatResults,
    priority,
    ...(id && { id }),
  });
}
