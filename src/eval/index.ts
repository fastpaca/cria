/**
 * Prompt evaluation module for testing Cria prompts with LLM-as-an-evaluator.
 *
 * @example
 * ```typescript
 * import { cria } from "@fastpaca/cria";
 * import { evaluate } from "@fastpaca/cria/eval";
 * import { Evaluator, Provider } from "@fastpaca/cria/ai-sdk";
 * import { openai } from "@ai-sdk/openai";
 *
 * const prompt = cria
 *   .prompt()
 *   .system("You are a helpful customer support agent.")
 *   .user("{{question}}");
 *
 * const result = await evaluate(prompt, {
 *   target: new Provider(openai("gpt-4o")),
 *   evaluator: new Evaluator(openai("gpt-4o-mini")),
 *   input: { question: "How do I update my payment method?" },
 *   criteria: ["helpful", "accurate", "professional"],
 * });
 *
 * console.log(result.score);     // 0.92
 * console.log(result.passed);    // true
 * console.log(result.reasoning); // "Response directly addresses..."
 * ```
 *
 * @packageDocumentation
 */

export type {
  EvaluatorOutput,
  EvaluatorProvider,
  EvaluatorRequest,
} from "../types";
// biome-ignore lint/performance/noBarrelFile: Intentional re-export for package entrypoint.
export { EvaluatorOutputSchema } from "../types";
export * from "./core";

// Re-export the Vitest matchers for convenience
// Users can import: import { criaMatchers, evaluate } from "@fastpaca/cria/eval";
export { criaMatchers } from "./vitest-matchers";
