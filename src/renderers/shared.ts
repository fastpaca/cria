import type { PromptPart } from "../types";

/**
 * Coalesce adjacent text parts into single parts.
 */
export function coalesceTextParts(parts: readonly PromptPart[]): PromptPart[] {
  const result: PromptPart[] = [];
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
 */
export function safeStringify(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value === undefined) {
    return "null";
  }

  try {
    return JSON.stringify(value) ?? "null";
  } catch {
    return String(value);
  }
}

/**
 * Extract text content from prompt parts.
 * Optionally wraps reasoning parts in thinking tags.
 */
export function partsToText(
  parts: readonly PromptPart[],
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
