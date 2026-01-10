import type { PromptChildren, PromptElement } from "../types";

/**
 * Semantic representation of prompt content parts.
 * Used by renderers to convert prompt trees into provider-specific formats.
 */
export type SemanticPart =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "tool-call"; toolCallId: string; toolName: string; input: unknown }
  | {
      type: "tool-result";
      toolCallId: string;
      toolName: string;
      output: unknown;
    };

export type ToolCallPart = Extract<SemanticPart, { type: "tool-call" }>;
export type ToolResultPart = Extract<SemanticPart, { type: "tool-result" }>;
export type TextPart = Extract<SemanticPart, { type: "text" }>;
export type ReasoningPart = Extract<SemanticPart, { type: "reasoning" }>;

export type MessageElement = Extract<PromptElement, { kind: "message" }>;

/**
 * Collect all message nodes from the prompt tree.
 */
export function collectMessageNodes(
  element: PromptElement,
  acc: MessageElement[] = []
): MessageElement[] {
  if (element.kind === "message") {
    acc.push(element);
    return acc;
  }

  for (const child of element.children) {
    if (typeof child !== "string") {
      collectMessageNodes(child, acc);
    }
  }

  return acc;
}

/**
 * Extract semantic parts from prompt children.
 */
export function collectSemanticParts(children: PromptChildren): SemanticPart[] {
  const parts: SemanticPart[] = [];

  for (const child of children) {
    if (typeof child === "string") {
      if (child.length > 0) {
        parts.push({ type: "text", text: child });
      }
      continue;
    }

    parts.push(...semanticPartsFromElement(child));
  }

  return parts;
}

/**
 * Extract semantic parts from a single prompt element.
 */
export function semanticPartsFromElement(
  element: PromptElement
): SemanticPart[] {
  switch (element.kind) {
    case "tool-call":
      return [
        {
          type: "tool-call",
          toolCallId: element.toolCallId,
          toolName: element.toolName,
          input: element.input,
        },
      ];
    case "tool-result":
      return [
        {
          type: "tool-result",
          toolCallId: element.toolCallId,
          toolName: element.toolName,
          output: element.output,
        },
      ];
    case "reasoning":
      return element.text.length === 0
        ? []
        : [{ type: "reasoning", text: element.text }];
    case "message":
      // Nested messages are ambiguous - skip
      return [];
    default:
      return collectSemanticParts(element.children);
  }
}

/**
 * Coalesce adjacent text parts into single parts.
 */
export function coalesceTextParts(
  parts: readonly SemanticPart[]
): SemanticPart[] {
  const result: SemanticPart[] = [];
  let buffer = "";

  for (const part of parts) {
    if (part.type === "text") {
      buffer += part.text;
      continue;
    }

    if (buffer.length > 0) {
      result.push({ type: "text", text: buffer });
      buffer = "";
    }

    result.push(part);
  }

  if (buffer.length > 0) {
    result.push({ type: "text", text: buffer });
  }

  return result;
}

/**
 * Safely stringify a value to JSON string.
 * Returns string values directly, handles undefined, and catches JSON errors.
 *
 * @param value - The value to stringify
 * @param pretty - If true, format with 2-space indentation (default: false)
 */
export function safeStringify(value: unknown, pretty = false): string {
  if (typeof value === "string") {
    return value;
  }
  if (value === undefined) {
    return "null";
  }

  try {
    return (
      (pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value)) ??
      "null"
    );
  } catch {
    return String(value);
  }
}

/**
 * Categorized parts from a semantic parts list.
 */
export interface CategorizedParts {
  textParts: TextPart[];
  toolCallParts: ToolCallPart[];
  toolResultParts: ToolResultPart[];
  reasoningParts: ReasoningPart[];
}

/**
 * Categorize semantic parts by type for easier processing.
 */
export function categorizeParts(
  parts: readonly SemanticPart[]
): CategorizedParts {
  const textParts: TextPart[] = [];
  const toolCallParts: ToolCallPart[] = [];
  const toolResultParts: ToolResultPart[] = [];
  const reasoningParts: ReasoningPart[] = [];

  for (const part of parts) {
    switch (part.type) {
      case "text":
        textParts.push(part);
        break;
      case "tool-call":
        toolCallParts.push(part);
        break;
      case "tool-result":
        toolResultParts.push(part);
        break;
      case "reasoning":
        reasoningParts.push(part);
        break;
      default:
        // Exhaustive check - TypeScript will error if a case is missing
        break;
    }
  }

  return { textParts, toolCallParts, toolResultParts, reasoningParts };
}

/**
 * Extract text content from semantic parts.
 * Optionally wraps reasoning parts in thinking tags.
 */
export function partsToText(
  parts: readonly SemanticPart[],
  options: { wrapReasoning?: boolean } = {}
): string {
  const { wrapReasoning = false } = options;
  let result = "";

  for (const part of parts) {
    if (part.type === "text") {
      result += part.text;
    } else if (part.type === "reasoning" && wrapReasoning) {
      result += `<thinking>\n${part.text}\n</thinking>\n`;
    }
  }

  return result;
}
