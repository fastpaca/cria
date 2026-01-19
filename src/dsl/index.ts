/**
 * Fluent DSL for building prompts.
 *
 * @example
 * ```typescript
 * import { cria } from "@fastpaca/cria";
 *
 * const prompt = await cria
 *   .prompt()
 *   .system("You are a helpful assistant.")
 *   .user("What is the capital of France?")
 *   .render({ budget: 4000, provider });
 * ```
 *
 * @packageDocumentation
 */

// Re-export types
export type {
  BuilderChild,
  Prompt,
  ScopeContent,
} from "./builder";
// biome-ignore lint/performance/noBarrelFile: dsl/index.ts is the primary DSL module entry point, not a barrel file
export {
  BuilderBase,
  MessageBuilder,
  PromptBuilder,
} from "./builder";
// Re-export summary types
export type {
  StoredSummary,
  Summarizer,
  SummarizerContext,
} from "./summary";
export { c, type TextInput } from "./templating";

// Re-export vector search types
export type { ResultFormatter } from "./vector-search";

import type {
  PromptMessageNode,
  PromptRole,
  PromptScope,
  ScopeChildren,
} from "../types";
import { PromptBuilder } from "./builder";
import { createMessage, createScope } from "./strategies";
// Import for namespace
import {
  normalizeTextInput,
  type TextInput,
  c as templateC,
} from "./templating";

/** Create a standalone message node */
function message(role: PromptRole, content: TextInput): PromptMessageNode {
  return createMessage(role, normalizeTextInput(content));
}

/** Create a standalone scope node */
function scope(
  children: ScopeChildren,
  opts?: { priority?: number; id?: string }
): PromptScope {
  return createScope(children, opts);
}

/**
 * Namespace for building prompts as code.
 *
 * @example
 * ```typescript
 * import { cria } from "@fastpaca/cria";
 *
 * // Full prompt builder
 * const prompt = cria
 *   .prompt()
 *   .system("You are helpful.")
 *   .user("Hello!")
 *   .build();
 *
 * // Standalone nodes
 * const msg = cria.user("Hello!");
 * const root = cria.scope([msg]);
 * ```
 */
export const cria = {
  prompt: () => PromptBuilder.create(),
  c: templateC,
  merge: (...builders: PromptBuilder[]) => {
    const [first, ...rest] = builders;
    if (!first) {
      return PromptBuilder.create();
    }
    return first.merge(...rest);
  },
  // Standalone node creators
  message,
  scope,
  user: (content: TextInput) => message("user", content),
  system: (content: TextInput) => message("system", content),
  assistant: (content: TextInput) => message("assistant", content),
} as const;

/**
 * Standalone function to create a new prompt builder.
 */
export const prompt = () => PromptBuilder.create();

/**
 * Merge multiple builders into one (zod-like merge).
 */
export const merge = (...builders: PromptBuilder[]): PromptBuilder =>
  cria.merge(...builders);
