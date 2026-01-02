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

interface MessagePropsBase extends SemanticRegionProps {
  children?: Child;
}

type MessageProps =
  | (MessagePropsBase & { messageRole: PromptRole; role?: never })
  | (MessagePropsBase & { role: PromptRole; messageRole?: never });

export function Message(props: MessageProps): PromptElement {
  const { priority = 0, strategy, id, children = [] } = props;
  const messageRole = "messageRole" in props ? props.messageRole : props.role;

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

export type {
  StoredSummary,
  Summarizer,
  SummarizerContext,
  SummaryStore,
} from "./summary";
export { memoryStore, Summary } from "./summary";
