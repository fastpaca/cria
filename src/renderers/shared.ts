import { getEncoding } from "js-tiktoken";

// Shared tiktoken encoder - only instantiated once
const encoder = getEncoding("cl100k_base");

/**
 * Count tokens in a string using cl100k_base encoding.
 */
export const countText = (text: string): number => encoder.encode(text).length;

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
