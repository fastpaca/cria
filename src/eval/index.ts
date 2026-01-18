/**
 * Prompt evaluation utilities for testing Cria prompts with LLM-as-a-judge.
 *
 * @example
 * ```typescript
 * import { c, cria } from "@fastpaca/cria";
 * import { createProvider } from "@fastpaca/cria/ai-sdk";
 * import { createJudge } from "@fastpaca/cria/eval";
 * import { openai } from "@ai-sdk/openai";
 *
 * // Create a configured judge
 * const judge = createJudge({
 *   target: createProvider(openai("gpt-4o")),
 *   evaluator: createProvider(openai("gpt-4o-mini")),
 * });
 *
 * // Build the prompt to test
 * const prompt = await cria.prompt()
 *   .system("You are a helpful customer support agent.")
 *   .user("How do I update my payment method?")
 *   .build();
 *
 * // Assert with simple criterion description
 * await judge(prompt).toPass(c`Helpfulness in addressing the user's question`);
 * ```
 *
 * @packageDocumentation
 */

import { cria as baseCria } from "../dsl";
import { createJudge } from "./judge";

export type { EvalResult, Judge, JudgeConfig, Judgment } from "./judge";
// biome-ignore lint/performance/noBarrelFile: Intentional package entrypoint
export { createJudge } from "./judge";

export const cria = { ...baseCria, judge: createJudge } as const;
