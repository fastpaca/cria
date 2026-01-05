import type {
  VectorMemory,
  VectorSearchOptions,
  VectorSearchResult,
} from "../memory";
import type {
  CompletionMessage,
  PromptChildren,
  PromptElement,
} from "../types";

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
 *
 * @deprecated Use `vectorSearch` instead for a more flexible API
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

/**
 * Function to extract a query from messages.
 * Default: returns the content of the last user message.
 */
export type QueryExtractor = (
  messages: CompletionMessage[]
) => string | undefined;

/**
 * Default query extractor: gets the last user message content.
 */
function defaultQueryExtractor(
  messages: CompletionMessage[]
): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg?.role === "user") {
      return msg.content;
    }
  }
  return undefined;
}

/**
 * Normalizes children (string, number, array, etc.) into a single query string.
 */
function childrenToQuery(children: PromptChildren): string {
  return children
    .map((child) => (typeof child === "string" ? child : ""))
    .join("")
    .trim();
}

/**
 * Options for the vectorSearch function.
 *
 * Query can be provided in three ways (in order of precedence):
 * 1. `query` - explicit query string
 * 2. `children` - query built from children (like JSX children)
 * 3. `messages` - auto-extracted from conversation (last user message by default)
 */
interface VectorSearchOptions2<T = unknown> {
  /** Vector memory store to search */
  store: VectorMemory<T>;

  /** Explicit query string. Takes precedence over children and messages. */
  query?: string;

  /**
   * Query built from children. Use this for JSX-like patterns:
   * `await vectorSearch({ store, children: ["Find docs about: ", topic] })`
   */
  children?: PromptChildren;

  /**
   * Conversation messages to extract query from.
   * By default, uses the last user message.
   */
  messages?: CompletionMessage[];

  /**
   * Custom function to extract query from messages.
   * Default: returns the last user message content.
   */
  extractQuery?: QueryExtractor;

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
 * Async function that performs vector search and returns a PromptElement.
 *
 * This is the primary way to integrate RAG into your prompts. The search
 * happens at call time, giving you control over caching, error handling,
 * and parallel fetching.
 *
 * Query can be provided in three ways:
 * 1. **Explicit query** - `query: "What is RAG?"`
 * 2. **Children as query** - `children: ["Find docs about: ", topic]`
 * 3. **From messages** - `messages: conversationHistory` (uses last user message)
 *
 * @example Explicit query
 * ```tsx
 * const context = await vectorSearch({
 *   store,
 *   query: "What is retrieval augmented generation?",
 *   limit: 5,
 * });
 *
 * <System>Use this context: {context}</System>
 * ```
 *
 * @example Children as query (template pattern)
 * ```tsx
 * const context = await vectorSearch({
 *   store,
 *   children: ["Find information about: ", userTopic],
 * });
 * ```
 *
 * @example Auto-query from messages (plug-and-play)
 * ```tsx
 * // Automatically uses the last user message as the query
 * const context = await vectorSearch({
 *   store,
 *   messages: conversationHistory,
 * });
 * ```
 *
 * @example Custom query extraction
 * ```tsx
 * const context = await vectorSearch({
 *   store,
 *   messages: conversationHistory,
 *   extractQuery: (msgs) => {
 *     // Use last 3 user messages for better context
 *     return msgs
 *       .filter(m => m.role === "user")
 *       .slice(-3)
 *       .map(m => m.content)
 *       .join(" ");
 *   },
 * });
 * ```
 *
 * @example Parallel fetching for multiple sources
 * ```tsx
 * const [docsContext, faqContext] = await Promise.all([
 *   vectorSearch({ store: docsStore, messages }),
 *   vectorSearch({ store: faqStore, messages }),
 * ]);
 *
 * <System>
 *   Documentation: {docsContext}
 *   FAQ: {faqContext}
 * </System>
 * ```
 */
export async function vectorSearch<T = unknown>({
  store,
  query,
  children,
  messages,
  extractQuery = defaultQueryExtractor,
  limit = 5,
  threshold,
  formatResults = defaultFormatter,
  priority = 0,
  id,
}: VectorSearchOptions2<T>): Promise<PromptElement> {
  // Determine the query using precedence: query > children > messages
  let resolvedQuery: string | undefined = query;

  if (resolvedQuery === undefined && children !== undefined) {
    resolvedQuery = childrenToQuery(children);
  }

  if (resolvedQuery === undefined && messages !== undefined) {
    resolvedQuery = extractQuery(messages);
  }

  if (!resolvedQuery) {
    // No query available - return empty results
    return VectorSearch({
      results: [],
      formatResults,
      priority,
      ...(id && { id }),
    });
  }

  const searchOptions: VectorSearchOptions = {
    limit,
    ...(threshold !== undefined && { threshold }),
  };

  const results = await store.search(resolvedQuery, searchOptions);

  return VectorSearch({
    results,
    formatResults,
    priority,
    ...(id && { id }),
  });
}
