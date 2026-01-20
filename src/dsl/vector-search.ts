/**
 * VectorSearch async component for RAG-style retrieval.
 */

import type {
  VectorMemory,
  VectorSearchOptions,
  VectorSearchResult,
} from "../memory";
import type {
  PromptPart,
  PromptRole,
  PromptScope,
  ProviderToolIO,
} from "../types";
import { PromptBuilder } from "./builder";

/** Simple message shape for query extraction. */
interface Message {
  role: string;
  content: string;
}

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

type QueryExtractor = (messages: Message[]) => string | null | undefined;

interface VectorSearchProps<
  T = unknown,
  TToolIO extends ProviderToolIO = ProviderToolIO,
> {
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
  messages?: Message[];
  /** Custom query extractor (overrides the default last-user-message behavior). */
  extractQuery?: QueryExtractor;
  /** Maximum number of results to return. Default: 5 */
  limit?: number;
  /** Minimum similarity threshold (0-1). Results below this are excluded. */
  threshold?: number;
  /** Custom formatter for search results. Default: numbered list format */
  formatResults?: ResultFormatter<T>;
  /** Priority for this scope (higher number = reduced first). Default: 0 */
  priority?: number;
  /** Stable identifier for caching/debugging */
  id?: string;
  /** Role for the emitted message. Default: "user" */
  role?: PromptRole;
  /** Query text provided as children (preferred over `query` when present). */
  children?: readonly PromptPart<TToolIO>[];
}

function queryFromChildren<TToolIO extends ProviderToolIO>(
  children?: readonly PromptPart<TToolIO>[]
): string | null {
  if (!children || children.length === 0) {
    return null;
  }

  let buffer = "";
  for (const child of children) {
    if (child.type !== "text") {
      throw new Error(
        "VectorSearch children must be text parts. Use a formatter to build complex queries."
      );
    }
    buffer += child.text;
  }

  const trimmed = buffer.trim();
  return trimmed === "" ? null : trimmed;
}

function defaultExtractQuery(messages: Message[]): string | null {
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const content = lastUser?.content.trim() ?? "";
  return content === "" ? null : content;
}

interface QuerySources {
  query?: string | undefined;
  messages?: Message[] | undefined;
  extractQuery?: QueryExtractor | undefined;
  children?: readonly PromptPart[] | undefined;
}

function deriveQuery(props: QuerySources): string | null | undefined {
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
 * Renders vector search results into a scoped message.
 */
export async function VectorSearch<
  T = unknown,
  TToolIO extends ProviderToolIO = ProviderToolIO,
>({
  store,
  query,
  messages,
  extractQuery,
  limit = 5,
  threshold,
  formatResults = defaultFormatter,
  priority = 0,
  id,
  role = "user",
  children,
}: VectorSearchProps<T, TToolIO>): Promise<PromptScope<TToolIO>> {
  const finalQuery = deriveQuery({
    query,
    messages,
    extractQuery,
    children,
  });

  if (!finalQuery) {
    throw new Error(
      "VectorSearch: no query provided. Pass a query via children, the query prop, or messages."
    );
  }

  const searchOptions: VectorSearchOptions = {
    limit,
    ...(threshold !== undefined && { threshold }),
  };

  const results = await store.search(finalQuery, searchOptions);
  const content = formatResults(results);

  // Use the DSL to build the result scope
  const tree = await PromptBuilder.create().message(role, content).build();

  return {
    ...tree,
    priority,
    ...(id && { id }),
  };
}
