import type {
  MessageChildren,
  MessageElement,
  PromptPart,
  PromptRole,
  PromptScope,
  ScopeChildren,
  Strategy,
} from "../types";

interface ScopeProps {
  /** Lower number = higher importance. Default: 0 (highest priority) */
  priority?: number;
  /** Optional strategy to apply when this scope needs to shrink */
  strategy?: Strategy;
  /** Stable identifier for caching/debugging */
  id?: string;
  /** Content of this scope */
  children?: ScopeChildren;
}

/**
 * The fundamental building block of Cria prompts—think of it as `<div>`.
 *
 * Scopes define sections of your prompt with a priority level. During fitting,
 * scopes with higher priority numbers (less important) are reduced first.
 */
export function Scope({
  priority = 0,
  strategy,
  id,
  children = [],
}: ScopeProps): PromptScope {
  return {
    kind: "scope",
    priority,
    children,
    ...(strategy && { strategy }),
    ...(id && { id }),
  };
}

interface MessageProps {
  /** The message role (user, assistant, system, etc.) */
  messageRole: PromptRole;
  children?: MessageChildren;
  /** Stable identifier for caching/debugging */
  id?: string;
}

export function Message({
  messageRole,
  id,
  children = [],
}: MessageProps): MessageElement {
  return {
    kind: "message",
    role: messageRole,
    children,
    ...(id && { id }),
  };
}

interface ReasoningProps {
  text: string;
}

export function Reasoning({ text }: ReasoningProps): PromptPart {
  return { type: "reasoning", text };
}

interface ToolCallProps {
  toolCallId: string;
  toolName: string;
  input: unknown;
}

export function ToolCall({
  toolCallId,
  toolName,
  input,
}: ToolCallProps): PromptPart {
  return {
    type: "tool-call",
    toolCallId,
    toolName,
    input,
  };
}

interface ToolResultProps {
  toolCallId: string;
  toolName: string;
  output: unknown;
}

export function ToolResult({
  toolCallId,
  toolName,
  output,
}: ToolResultProps): PromptPart {
  return {
    type: "tool-result",
    toolCallId,
    toolName,
    output,
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
  children?: ScopeChildren;
}

/**
 * A scope that truncates by dropping child components from one end.
 */
export function Truncate({
  budget,
  from = "start",
  priority = 0,
  id,
  children = [],
}: TruncateProps): PromptScope {
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
    kind: "scope",
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
  children?: ScopeChildren;
}

/**
 * A scope that is entirely removed when the prompt needs to shrink.
 */
export function Omit({
  priority = 0,
  id,
  children = [],
}: OmitProps): PromptScope {
  const strategy: Strategy = () => null;

  return {
    kind: "scope",
    priority,
    children,
    strategy,
    ...(id && { id }),
  };
}

interface LastProps {
  /** Number of children to keep */
  N: number;
  /** Priority for this scope. Default: 0 */
  priority?: number;
  /** Children to filter */
  children?: ScopeChildren;
}

/**
 * Keeps only the last N children.
 */
export function Last({
  N,
  priority = 0,
  children = [],
}: LastProps): PromptScope {
  const lastN = children.slice(-N);

  return {
    kind: "scope",
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
function intersperse(items: readonly string[], separator: string): string {
  if (items.length === 0) {
    return "";
  }
  return items
    .map((item, i) => (i === 0 ? item : `${separator}${item}`))
    .join("");
}

interface SeparatorProps {
  value?: string;
  children?: string[];
}

export function Separator({
  value = "\n",
  children = [],
}: SeparatorProps): PromptPart {
  return {
    type: "text",
    text: intersperse(children, value),
  };
}

interface ExamplesProps {
  title?: string;
  separator?: string;
  id?: string;
  children?: string[];
}

export function Examples({
  title = "Examples:",
  separator = "\n\n",
  children = [],
}: ExamplesProps): PromptPart {
  const body = intersperse(children, separator);
  const text = title ? `${title}\n${body}` : body;
  return { type: "text", text };
}

interface CodeBlockProps {
  code: string;
  language?: string;
  id?: string;
}

export function CodeBlock({ code, language }: CodeBlockProps): PromptPart {
  const fenced = `\`\`\`${language ?? ""}\n${code}\n\`\`\`\n`;
  return {
    type: "text",
    text: fenced,
  };
}
