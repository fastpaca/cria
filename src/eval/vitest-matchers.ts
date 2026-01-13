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
 *     judge,
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
import type { EvalOptions } from "./index";

/**
 * Vitest custom matchers for Cria evaluation.
 *
 * Use `expect.extend(criaMatchers)` to add these matchers to your test suite.
 */
export const criaMatchers = {
  /**
   * Assert that a prompt passes evaluation with an LLM judge.
   *
   * @example
   * ```typescript
   * await expect(myPrompt).toPassEvaluation({
   *   judge: openaiProvider,
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
    // Dynamic import to avoid circular dependency
    const { evaluate } = await import("./index");
    const result = await evaluate(received, options);

    const threshold = options.threshold ?? 0.8;

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
 * TypeScript declaration for the custom matchers.
 *
 * When using these matchers, you may need to add the following to your
 * vitest setup file or test file:
 *
 * ```typescript
 * import type { EvalOptions } from "@fastpaca/cria/eval";
 *
 * declare module "vitest" {
 *   interface Assertion<T = unknown> {
 *     toPassEvaluation(options: EvalOptions): Promise<void>;
 *   }
 *   interface AsymmetricMatchersContaining {
 *     toPassEvaluation(options: EvalOptions): void;
 *   }
 * }
 * ```
 */
