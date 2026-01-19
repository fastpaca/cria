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

// biome-ignore lint/performance/noBarrelFile: dsl/index.ts is the primary DSL module entry point, not a barrel file
export { c, type TextInput } from "../templating";
// Re-export types
export type {
  BuilderChild,
  Prompt,
  ScopeContent,
} from "./builder";
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

// Re-export vector search types
export type { ResultFormatter } from "./vector-search";

// Import for namespace
import { c as templateC } from "../templating";
import { PromptBuilder } from "./builder";

/**
 * Namespace for building prompts as code.
 *
 * @example
 * ```typescript
 * import { cria } from "@fastpaca/cria";
 *
 * const prompt = cria
 *   .prompt()
 *   .system("You are helpful.")
 *   .user("Hello!")
 *   .build();
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
