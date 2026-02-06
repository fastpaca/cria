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
export { c, type TextInput } from "./templating";

import type { InputLayout, ModelProvider } from "../provider";
import type { PromptLayout, ProviderToolIO } from "../types";
import { PromptBuilder } from "./builder";

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
 * Standalone function to create a new prompt builder.
 */
export const prompt = createPrompt;

/**
 * Merge multiple builders into one (zod-like merge).
 */
export const merge = (
  ...builders: PromptBuilder<unknown, "unpinned" | "pinned">[]
): PromptBuilder<unknown, "unpinned" | "pinned"> => {
  const [first, ...rest] = builders;
  if (!first) {
    return PromptBuilder.create();
  }
  return first.merge(...rest);
};

export { inputLayout };
