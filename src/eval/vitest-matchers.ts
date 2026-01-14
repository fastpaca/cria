/**
 * Vitest matchers for prompt evaluation.
 *
 * @example
 * ```typescript
 * import { expect } from "vitest";
 * import { criaMatchers } from "@fastpaca/cria/eval";
 *
 * expect.extend(criaMatchers);
 *
 * test("prompt is helpful", async () => {
 *   await expect(myPrompt).toPassEvaluation({
 *     target,
 *     evaluator,
 *     input: { question: "..." },
 *     criteria: ["helpful"],
 *   });
 * }, 30000);
 * ```
 *
 * @packageDocumentation
 */

import type { PromptBuilder } from "../dsl";
import type { PromptElement } from "../types";
import { DEFAULT_THRESHOLD, type EvalOptions, evaluate } from "./core";

/**
 * Vitest custom matchers for Cria evaluation.
 *
 * Use `expect.extend(criaMatchers)` to add these matchers to your test suite.
 */
export const criaMatchers = {
  /**
   * Assert that a prompt passes evaluation with an LLM evaluator.
   *
   * @example
   * ```typescript
   * await expect(myPrompt).toPassEvaluation({
   *   target: openaiProvider,
   *   evaluator: evaluatorProvider,
   *   input: { question: "How do I reset my password?" },
   *   criteria: ["helpful", "accurate"],
   *   threshold: 0.8,
   * });
   * ```
   */
  async toPassEvaluation(
    received: PromptBuilder | PromptElement,
    options: EvalOptions
  ) {
    const result = await evaluate(received, options);

    const threshold = options.threshold ?? DEFAULT_THRESHOLD;

    if (result.passed) {
      return {
        pass: true,
        message: () =>
          "Expected evaluation to fail, but it passed.\n\n" +
          `Score: ${result.score} (threshold: ${threshold})\n` +
          `Reasoning: ${result.reasoning}\n` +
          `Response: ${result.response.slice(0, 500)}${result.response.length > 500 ? "..." : ""}`,
      };
    }

    return {
      pass: false,
      message: () =>
        "Expected evaluation to pass, but it failed.\n\n" +
        `Score: ${result.score} (threshold: ${threshold})\n` +
        `Reasoning: ${result.reasoning}\n` +
        `Response: ${result.response.slice(0, 500)}${result.response.length > 500 ? "..." : ""}`,
    };
  },
};

/**
 * TypeScript declarations for the custom matchers.
 */
declare module "vitest" {
  interface Assertion<_T = unknown> {
    toPassEvaluation(options: EvalOptions): Promise<void>;
  }
  interface AsymmetricMatchersContaining {
    toPassEvaluation(options: EvalOptions): void;
  }
}
