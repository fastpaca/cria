/**
 * Fluent DSL for building prompts.
 *
 * @example
 * ```typescript
 * import { cria } from "@fastpaca/cria";
 *
 * const prompt = await cria
 *   .prompt(provider)
 *   .system("You are a helpful assistant.")
 *   .user("What is the capital of France?")
 *   .render({ budget: 4000 });
 * ```
 *
 * @packageDocumentation
 */

// Re-export types
export type {
  BuilderChild,
  Prompt,
  PromptPlugin,
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
  SummarizerComponent,
  SummarizerConfig,
  SummarizerContext,
  SummarizerLoadOptions,
  SummarizerPluginOptions,
  SummarizerUseOptions,
  SummarizerWriteOptions,
} from "./summary";
export { summarizer } from "./summary";
export { c, type TextInput } from "./templating";
export type {
  VectorDBComponent,
  VectorDBConfig,
  VectorDBEntry,
  VectorDBFormatter,
  VectorDBLoadOptions,
  VectorDBSearchOptions,
  VectorDBUseOptions,
} from "./vector-db";
export { vectordb } from "./vector-db";

import type { InputLayout, ModelProvider, PromptInput } from "../provider";
import type {
  PromptLayout,
  PromptMessageNode,
  PromptRole,
  PromptScope,
  ProviderToolIO,
  ScopeChildren,
} from "../types";
import { PromptBuilder } from "./builder";
import { createMessage, createScope } from "./strategies";
import { summarizer } from "./summary";
// Import for namespace
import {
  normalizeTextInput,
  type TextInput,
  c as templateC,
} from "./templating";
import { vectordb } from "./vector-db";

/** Create a standalone message node */
function message<TToolIO extends ProviderToolIO>(
  role: PromptRole,
  content: TextInput<TToolIO>
): PromptMessageNode<TToolIO> {
  return createMessage(role, normalizeTextInput<TToolIO>(content));
}

/** Create a standalone scope node */
function scope<TToolIO extends ProviderToolIO>(
  children: ScopeChildren<TToolIO>,
  opts?: { priority?: number; id?: string }
): PromptScope<TToolIO> {
  return createScope(children, opts);
}

function input<TRendered>(value: TRendered): PromptInput<TRendered> {
  return { kind: "input", value };
}

function inputLayout<TToolIO extends ProviderToolIO>(
  value: PromptLayout<TToolIO>
): InputLayout<TToolIO> {
  return { kind: "input-layout", value };
}

function createPrompt(): PromptBuilder<unknown, "unpinned">;
function createPrompt<TProvider extends ModelProvider<unknown, ProviderToolIO>>(
  provider: TProvider
): PromptBuilder<TProvider, "unpinned">;
function createPrompt(provider?: ModelProvider<unknown, ProviderToolIO>) {
  if (provider === undefined) {
    return PromptBuilder.create();
  }
  return PromptBuilder.create(provider);
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
  prompt: createPrompt,
  c: templateC,
  merge: (...builders: PromptBuilder<unknown, "unpinned" | "pinned">[]) => {
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
  developer: (content: TextInput) => message("developer", content),
  assistant: (content: TextInput) => message("assistant", content),
  input,
  inputLayout,
  summarizer,
  vectordb,
} as const;

/**
 * Standalone function to create a new prompt builder.
 */
export const prompt = createPrompt;

/**
 * Merge multiple builders into one (zod-like merge).
 */
export const merge = (
  ...builders: PromptBuilder<unknown, "unpinned" | "pinned">[]
): PromptBuilder<unknown, "unpinned" | "pinned"> => cria.merge(...builders);

export { input, inputLayout };
