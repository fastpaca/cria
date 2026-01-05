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

type QueryExtractor = (
  messages: CompletionMessage[]
) => string | null | undefined;

interface VectorSearchProps<T = unknown> {
  /** Vector memory store to search */
  store: VectorMemory<T>;
  /**
   * Query string. If omitted, the component will try to derive the query from
   * children, then from `messages` (defaulting to the last user message).
   */
  query?: string | undefined;
  /**
   * Optional messages to derive a query from (uses last user message by default).
   */
  messages?: CompletionMessage[];
  /** Custom query extractor (overrides the default last-user-message behavior). */
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
  /** Query text provided as children (preferred over `query` when present). */
  children?: PromptChildren;
}

function queryFromChildren(children?: PromptChildren): string | null {
  if (!children || children.length === 0) {
    return null;
  }

  let buffer = "";
  for (const child of children) {
    if (typeof child !== "string") {
      throw new Error(
        "VectorSearch children must be plain text. Wrap complex content in a formatter before passing it as a query."
      );
    }
    buffer += child;
  }

  const trimmed = buffer.trim();
  return trimmed === "" ? null : trimmed;
}

function defaultExtractQuery(messages: CompletionMessage[]): string | null {
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const content = lastUser?.content.trim() ?? "";
  return content === "" ? null : content;
}

interface QuerySources<T> {
  query?: string | undefined;
  messages?: CompletionMessage[] | undefined;
  extractQuery?: QueryExtractor | undefined;
  children?: PromptChildren | undefined;
}

function deriveQuery<T>(props: QuerySources<T>): string | null | undefined {
  const childQuery = queryFromChildren(props.children);
  if (childQuery) {
    return childQuery;
  }

  const directQuery = props.query?.trim();
  if (directQuery) {
    return directQuery;
  }

  if (props.messages && props.messages.length > 0) {
    const extracted = props.extractQuery
      ? props.extractQuery(props.messages)
      : defaultExtractQuery(props.messages);
    const trimmed = extracted?.trim() ?? "";
    if (trimmed) {
      return trimmed;
    }
  }

  return null;
}

/**
 * Renders vector search results into the prompt.
 *
 * The query is resolved at render time—no pre-fetching needed. Query sources, in
 * order of precedence:
 * 1) Children text: `<VectorSearch store={store}>find docs about RAG</VectorSearch>`
 * 2) `query` prop: `<VectorSearch store={store} query="find docs about RAG" />`
 * 3) Messages: `<VectorSearch store={store} messages={messages} />`
 *    - Defaults to the last user message, or use `extractQuery` to customize.
 *
 * @example
 * ```tsx
 * <VectorSearch store={store} limit={5}>
 *   my query: {topic}
 * </VectorSearch>
 * ```
 *
 * @example Using messages as the query source
 * ```tsx
 * <VectorSearch store={store} messages={messages} />
 * ```
 *
 * @example Custom extractor
 * ```tsx
 * <VectorSearch
 *   store={store}
 *   messages={messages}
 *   extractQuery={(msgs) => msgs.at(-1)?.content}
 * />
 * ```
 */
export async function VectorSearch<T = unknown>({
  store,
  query,
  messages,
  extractQuery,
  limit = 5,
  threshold,
  formatResults = defaultFormatter,
  priority = 0,
  id,
  children,
}: VectorSearchProps<T>): Promise<PromptElement> {
  const finalQuery = deriveQuery<T>({
    query,
    messages,
    extractQuery,
    children,
  });

  if (!finalQuery) {
    return {
      priority,
      children: ["[VectorSearch: no query provided]"],
      ...(id && { id }),
    };
  }

  const searchOptions: VectorSearchOptions = {
    limit,
    ...(threshold !== undefined && { threshold }),
  };

  let results: VectorSearchResult<T>[] | undefined;
  try {
    results = await store.search(finalQuery, searchOptions);
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : JSON.stringify(error);
    return {
      priority,
      children: [`[VectorSearch error: ${reason}]`],
      ...(id && { id }),
    };
  }

  const content = formatResults(results ?? []);

  return {
    priority,
    children: [content] as PromptChildren,
    ...(id && { id }),
  };
}
