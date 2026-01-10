import type { Child } from "../jsx-runtime";
import type {
  PromptChildren,
  PromptElement,
  PromptRole,
  Strategy,
} from "../types";

interface RegionProps {
  /** Lower number = higher importance. Default: 0 (highest priority) */
  priority?: number;
  /** Optional strategy to apply when this region needs to shrink */
  strategy?: Strategy;
  /** Stable identifier for caching/debugging */
  id?: string;
  /** Content of this region */
  children?: Child;
}

/**
 * The fundamental building block of Cria prompts—think of it as `<div>`.
 *
 * Regions define sections of your prompt with a priority level. During fitting,
 * regions with higher priority numbers (less important) are reduced first.
 *
 * @example
 * ```tsx
 * <Region priority={0}>You are a helpful assistant.</Region>
 * <Region priority={2}>{documents}</Region>
 * <Region priority={1}>{userMessage}</Region>
 * ```
 */
export function Region({
  priority = 0,
  strategy,
  id,
  children = [],
}: RegionProps): PromptElement {
  return {
    priority,
    children: children as PromptChildren,
    ...(strategy && { strategy }),
    ...(id && { id }),
  };
}

interface SemanticRegionProps {
  /** Lower number = higher importance. Default: 0 (highest priority) */
  priority?: number;
  /** Optional strategy to apply when this region needs to shrink */
  strategy?: Strategy;
  /** Stable identifier for caching/debugging */
  id?: string;
}

interface MessageProps extends SemanticRegionProps {
  /** The message role (user, assistant, system, etc.) */
  messageRole: PromptRole;
  children?: Child;
}

export function Message({
  messageRole,
  priority = 0,
  strategy,
  id,
  children = [],
}: MessageProps): PromptElement {
  return {
    kind: "message",
    role: messageRole,
    priority,
    children: children as PromptChildren,
    ...(strategy && { strategy }),
    ...(id && { id }),
  };
}

interface ReasoningProps extends SemanticRegionProps {
  text: string;
}

export function Reasoning({
  text,
  priority = 0,
  strategy,
  id,
}: ReasoningProps): PromptElement {
  return {
    kind: "reasoning",
    text,
    priority,
    children: [],
    ...(strategy && { strategy }),
    ...(id && { id }),
  };
}

interface ToolCallProps extends SemanticRegionProps {
  toolCallId: string;
  toolName: string;
  input: unknown;
}

export function ToolCall({
  toolCallId,
  toolName,
  input,
  priority = 0,
  strategy,
  id,
}: ToolCallProps): PromptElement {
  return {
    kind: "tool-call",
    toolCallId,
    toolName,
    input,
    priority,
    children: [],
    ...(strategy && { strategy }),
    ...(id && { id }),
  };
}

interface ToolResultProps extends SemanticRegionProps {
  toolCallId: string;
  toolName: string;
  output: unknown;
}

export function ToolResult({
  toolCallId,
  toolName,
  output,
  priority = 0,
  strategy,
  id,
}: ToolResultProps): PromptElement {
  return {
    kind: "tool-result",
    toolCallId,
    toolName,
    output,
    priority,
    children: [],
    ...(strategy && { strategy }),
    ...(id && { id }),
  };
}

interface TruncateProps {
  /** Maximum token count for this region's content */
  budget: number;
  /** Which end to truncate from. Default: "start" */
  from?: "start" | "end";
  /** Lower number = higher importance. Default: 0 */
  priority?: number;
  /** Stable identifier for caching/debugging */
  id?: string;
  /** Content to truncate */
  children?: Child;
}

/**
 * A region that truncates its content to fit within a token budget.
 *
 * When the overall prompt exceeds budget, Truncate regions progressively
 * remove content from the specified direction until they meet their budget.
 *
 * @example
 * ```tsx
 * <Truncate budget={20000} priority={2}>
 *   {conversationHistory}
 * </Truncate>
 * ```
 */
export function Truncate({
  budget,
  from = "start",
  priority = 0,
  id,
  children = [],
}: TruncateProps): PromptElement {
  const strategy: Strategy = (input) => {
    const content = input.tokenString(input.target);
    let tokens = input.tokenizer(content);
    if (tokens <= budget) {
      return input.target;
    }

    let truncated = content;

    while (tokens > budget && truncated.length > 0) {
      const charsToRemove = Math.max(1, Math.floor(truncated.length * 0.1));
      truncated =
        from === "start"
          ? truncated.slice(charsToRemove)
          : truncated.slice(0, -charsToRemove);
      tokens = input.tokenizer(truncated);
    }

    if (truncated.length === 0) {
      return null;
    }

    return { ...input.target, children: [truncated] };
  };

  return {
    priority,
    children: children as PromptChildren,
    strategy,
    ...(id && { id }),
  };
}

interface OmitProps {
  /** Lower number = higher importance. Default: 0 */
  priority?: number;
  /** Stable identifier for caching/debugging */
  id?: string;
  /** Content that may be omitted */
  children?: Child;
}

/**
 * A region that is entirely removed when the prompt needs to shrink.
 *
 * Use Omit for "nice to have" content that can be dropped entirely if needed.
 * When the prompt exceeds budget, Omit regions are removed (lowest priority first).
 *
 * @example
 * ```tsx
 * <Omit priority={3}>
 *   {optionalExamples}
 * </Omit>
 * ```
 */
export function Omit({
  priority = 0,
  id,
  children = [],
}: OmitProps): PromptElement {
  const strategy: Strategy = () => null;

  return {
    priority,
    children: children as PromptChildren,
    strategy,
    ...(id && { id }),
  };
}

interface LastProps {
  /** Number of children to keep */
  N: number;
  /** Priority for this region. Default: 0 */
  priority?: number;
  /** Children to filter */
  children?: Child;
}

/**
 * Keeps only the last N children.
 *
 * @example
 * ```tsx
 * <Last N={50}>{messages}</Last>
 * ```
 */
export function Last({
  N,
  priority = 0,
  children = [],
}: LastProps): PromptElement {
  const normalizedChildren = children as PromptChildren;
  const lastN = normalizedChildren.slice(-N);

  return {
    priority,
    children: lastN,
  };
}

export type { StoredSummary, Summarizer, SummarizerContext } from "./summary";
export { Summary } from "./summary";
export type { ResultFormatter } from "./vector-search";
export { VectorSearch } from "./vector-search";

/**
 * Intersperse a separator between elements of an array.
 */
function intersperse<T>(items: readonly T[], separator: T): T[] {
  if (items.length === 0) {
    return [];
  }
  return items.flatMap((item, i) => (i === 0 ? [item] : [separator, item]));
}

interface SeparatorProps {
  value?: string;
  priority?: number;
  id?: string;
  children?: Child;
}

export function Separator({
  value = "\n",
  priority = 0,
  id,
  children = [],
}: SeparatorProps): PromptElement {
  const normalized = children as PromptChildren;
  return {
    priority,
    children: intersperse(normalized, value),
    ...(id && { id }),
  };
}

interface ExamplesProps {
  title?: string;
  separator?: string;
  priority?: number;
  id?: string;
  children?: Child;
}

export function Examples({
  title = "Examples:",
  separator = "\n\n",
  priority = 2,
  id,
  children = [],
}: ExamplesProps): PromptElement {
  const normalized = children as PromptChildren;
  const withSeparators = intersperse(normalized, separator);

  const prefixed = title
    ? ([`${title}\n`, ...withSeparators] as PromptChildren)
    : withSeparators;

  return {
    priority,
    children: prefixed,
    ...(id && { id }),
  };
}

interface CodeBlockProps {
  code: string;
  language?: string;
  priority?: number;
  id?: string;
}

export function CodeBlock({
  code,
  language,
  priority = 0,
  id,
}: CodeBlockProps): PromptElement {
  const fenced = `\`\`\`${language ?? ""}\n${code}\n\`\`\`\n`;
  return {
    priority,
    children: [fenced],
    ...(id && { id }),
  };
}
