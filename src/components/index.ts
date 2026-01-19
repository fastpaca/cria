import type {
  MessageElement,
  PromptChildren,
  PromptElement,
  PromptRole,
  ReasoningElement,
  Strategy,
  ToolCallElement,
  ToolResultElement,
} from "../types";

interface RegionProps {
  /** Lower number = higher importance. Default: 0 (highest priority) */
  priority?: number;
  /** Optional strategy to apply when this region needs to shrink */
  strategy?: Strategy;
  /** Stable identifier for caching/debugging */
  id?: string;
  /** Content of this region */
  children?: PromptChildren;
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
    children,
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
  children?: PromptChildren;
}

export function Message({
  messageRole,
  priority = 0,
  strategy,
  id,
  children = [],
}: MessageProps): MessageElement {
  return {
    kind: "message",
    role: messageRole,
    priority,
    children,
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
}: ReasoningProps): ReasoningElement {
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
}: ToolCallProps): ToolCallElement {
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
}: ToolResultProps): ToolResultElement {
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
  /** Heuristic scale for how many components to drop per iteration */
  budget: number;
  /** Which end to truncate from. Default: "start" */
  from?: "start" | "end";
  /** Lower number = higher importance. Default: 0 */
  priority?: number;
  /** Stable identifier for caching/debugging */
  id?: string;
  /** Content to truncate */
  children?: PromptChildren;
}

/**
 * A region that truncates by dropping child components from one end.
 *
 * When the overall prompt exceeds budget, Truncate regions progressively
 * remove components from the specified direction until the prompt fits.
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
    const { children: currentChildren } = input.target;
    if (currentChildren.length === 0) {
      return null;
    }

    // Heuristic: drop more components when totalTokens is far above the scale.
    const dropCount = Math.max(1, Math.floor(input.totalTokens / budget));
    const nextChildren =
      from === "start"
        ? currentChildren.slice(dropCount)
        : currentChildren.slice(
            0,
            Math.max(0, currentChildren.length - dropCount)
          );

    if (nextChildren.length === 0) {
      return null;
    }

    return { ...input.target, children: nextChildren };
  };

  return {
    priority,
    children,
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
  children?: PromptChildren;
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
    children,
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
  children?: PromptChildren;
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
  const lastN = children.slice(-N);

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
  children?: PromptChildren;
}

export function Separator({
  value = "\n",
  priority = 0,
  id,
  children = [],
}: SeparatorProps): PromptElement {
  return {
    priority,
    children: intersperse(children, value),
    ...(id && { id }),
  };
}

interface ExamplesProps {
  title?: string;
  separator?: string;
  priority?: number;
  id?: string;
  children?: PromptChildren;
}

export function Examples({
  title = "Examples:",
  separator = "\n\n",
  priority = 2,
  id,
  children = [],
}: ExamplesProps): PromptElement {
  const withSeparators = intersperse(children, separator);

  const prefixed: PromptChildren = title
    ? [`${title}\n`, ...withSeparators]
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
