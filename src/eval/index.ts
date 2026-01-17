/**
 * Prompt evaluation utilities for testing Cria prompts with LLM-as-a-judge.
 *
 * @example
 * ```typescript
 * import { cria } from "@fastpaca/cria";
 * import { Provider } from "@fastpaca/cria/ai-sdk";
 * import { judge } from "@fastpaca/cria/eval";
 * import { openai } from "@ai-sdk/openai";
 *
 * // Define evaluation criteria as Cria prompts
 * const Helpful = () => cria
 *   .prompt()
 *   .system("Evaluate helpfulness. Return JSON: { score: 0-1, reasoning: string }.");
 *
 * // Create a configured judge
 * const check = judge({
 *   target: new Provider(openai("gpt-4o")),
 *   evaluator: new Provider(openai("gpt-4o-mini")),
 * });
 *
 * // Build prompts with composition, not templates
 * const support = (question: string) => cria
 *   .prompt()
 *   .system("You are a helpful customer support agent.")
 *   .user(question);
 *
 * // Assert in tests
 * await check(support("How do I update my payment method?")).toPass(Helpful());
 * ```
 *
 * @packageDocumentation
 */

import { cria as baseCria } from "../dsl";
import { judge } from "./judge";

export type {
  EvalResult,
  JudgeConfig,
  Judgment,
  PromptInput,
  WeightedCriterion,
} from "./judge";
// biome-ignore lint/performance/noBarrelFile: Intentional package entrypoint
export { DEFAULT_THRESHOLD, judge } from "./judge";

export const cria = { ...baseCria, judge } as const;
