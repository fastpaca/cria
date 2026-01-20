/**
 * Template literal utilities for building prompt content.
 *
 * @packageDocumentation
 */

import type { PromptPart, ProviderToolIO } from "../types";

/**
 * Text input types for message builders.
 * These accept raw text and pre-built PromptParts, so tool parts can pass through
 * without conversion while keeping provider-bound tool IO types intact.
 */
export type TextValue<TToolIO extends ProviderToolIO = ProviderToolIO> =
  | PromptPart<TToolIO>
  | boolean
  | number
  | string
  | null
  | undefined;
export type TextInput<TToolIO extends ProviderToolIO = ProviderToolIO> =
  | TextValue<TToolIO>
  | readonly TextInput<TToolIO>[];

const TEMPLATE_INDENT_RE = /^[ \t]*/;

/**
 * Tagged template literal function for building prompt children with automatic indentation normalization.
 *
 * Interpolates values into template strings and normalizes indentation by stripping
 * common leading whitespace. Useful for writing multi-line prompt content with clean formatting.
 *
 * @param strings - Template string segments
 * @param values - Interpolated values (strings, numbers, booleans, PromptParts, arrays, etc.)
 * @returns Array of message parts
 *
 * This function allows you to use prompt parts naturally inside template strings.
 */
export function c(
  strings: TemplateStringsArray,
  ...values: readonly TextInput[]
): readonly PromptPart[];
export function c<TToolIO extends ProviderToolIO>(
  strings: TemplateStringsArray,
  ...values: readonly TextInput<TToolIO>[]
): readonly PromptPart<TToolIO>[];
export function c<TToolIO extends ProviderToolIO>(
  strings: TemplateStringsArray,
  ...values: readonly TextInput<TToolIO>[]
): readonly PromptPart<TToolIO>[] {
  const normalizedStrings = normalizeTemplateStrings(strings);
  const children: PromptPart<TToolIO>[] = [];

  for (let index = 0; index < normalizedStrings.length; index += 1) {
    const segment = normalizedStrings[index];
    if (segment !== undefined && segment.length > 0) {
      children.push({ type: "text", text: segment });
    }

    if (index < values.length) {
      const normalized = normalizeTextInput<TToolIO>(values[index]);
      if (normalized.length > 0) {
        children.push(...normalized);
      }
    }
  }

  return children;
}

export function textPart<TToolIO extends ProviderToolIO = ProviderToolIO>(
  value: string
): PromptPart<TToolIO> {
  return { type: "text", text: value };
}

export function isPromptPart<TToolIO extends ProviderToolIO = ProviderToolIO>(
  value: unknown
): value is PromptPart<TToolIO> {
  return typeof value === "object" && value !== null && "type" in value;
}

// Normalize text-like inputs into prompt parts while preserving existing parts.
export function normalizeTextInput<TToolIO extends ProviderToolIO>(
  content?: TextInput<TToolIO>
): PromptPart<TToolIO>[] {
  if (content === null || content === undefined) {
    return [];
  }

  if (Array.isArray(content)) {
    const flattened: PromptPart<TToolIO>[] = [];
    for (const item of content) {
      flattened.push(...normalizeTextInput<TToolIO>(item));
    }
    return flattened;
  }

  if (typeof content === "string") {
    return [textPart<TToolIO>(content)];
  }

  if (typeof content === "number" || typeof content === "boolean") {
    return [textPart<TToolIO>(String(content))];
  }

  if (isPromptPart(content)) {
    return [content];
  }

  throw new Error("Message content must be text or message parts.");
}

function normalizeTemplateStrings(
  strings: readonly string[]
): readonly string[] {
  if (strings.length === 0) {
    return strings;
  }

  const normalized = [...strings];
  if (normalized[0]?.startsWith("\n")) {
    normalized[0] = normalized[0].slice(1);
  }
  const lastIndex = normalized.length - 1;
  if (normalized[lastIndex]?.endsWith("\n")) {
    normalized[lastIndex] = normalized[lastIndex].slice(0, -1);
  }

  const lines = normalized.flatMap((segment) => segment.split("\n"));
  const indents = lines
    .filter((line) => line.trim().length > 0)
    .map((line) => line.match(TEMPLATE_INDENT_RE)?.[0].length ?? 0);
  const minIndent = indents.length > 0 ? Math.min(...indents) : 0;

  if (minIndent === 0) {
    return normalized;
  }

  return normalized.map((segment) =>
    segment
      .split("\n")
      .map((line) => {
        if (line.trim().length === 0) {
          return "";
        }
        return line.slice(Math.min(minIndent, line.length));
      })
      .join("\n")
  );
}
