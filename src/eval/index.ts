/**
 * Prompt evaluation module for testing Cria prompts with LLM-as-a-judge.
 *
 * @example
 * ```typescript
 * import { cria } from "@fastpaca/cria";
 * import { evaluate } from "@fastpaca/cria/eval";
 * import { Provider } from "@fastpaca/cria/openai";
 *
 * const prompt = cria
 *   .prompt()
 *   .system("You are a helpful customer support agent.")
 *   .user("{{question}}");
 *
 * const result = await evaluate(prompt, {
 *   judge: new Provider(openai, "gpt-4o-mini"),
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

import { z } from "zod";
import { cria, type PromptBuilder } from "../dsl";
import { markdownRenderer } from "../renderers/markdown";
import type { ModelProvider, PromptElement, Tokenizer } from "../types";

const DEFAULT_THRESHOLD = 0.8;

// Regex for extracting JSON from judge response (moved to top level for performance)
const JSON_EXTRACT_REGEX = /\{[\s\S]*\}/;

/**
 * Options for evaluating a prompt.
 */
export interface EvalOptions {
  /** Model provider to use as the judge (recommend: gpt-4o-mini for cost/quality balance) */
  judge: ModelProvider;
  /** Input variables to substitute into the prompt template */
  input: Record<string, unknown>;
  /** Criteria to evaluate against (e.g. ["helpful", "accurate"]) */
  criteria?: string[];
  /** Expected output for comparison (optional) */
  expected?: string;
  /** Minimum score to pass (default: 0.8) */
  threshold?: number;
  /** Tokenizer for rendering the prompt (optional, uses judge's tokenizer if available) */
  tokenizer?: Tokenizer;
  /** Token budget for rendering (optional, defaults to 100000) */
  budget?: number;
}

/**
 * Result from evaluating a prompt.
 */
export interface EvalResult {
  /** Whether the evaluation passed (score >= threshold) */
  passed: boolean;
  /** Numeric score from 0 to 1 */
  score: number;
  /** Judge's reasoning for the score */
  reasoning: string;
  /** The actual response from the prompt being evaluated */
  response: string;
}

/**
 * Options for creating a mock judge for testing.
 */
export interface MockJudgeOptions {
  /** Fixed score to return (0-1) */
  score?: number;
  /** Fixed pass/fail to return */
  passed?: boolean;
  /** Fixed reasoning to return */
  reasoning?: string;
  /** Fixed response to return from prompt execution */
  response?: string;
}

const JudgeResponseSchema = z.object({
  pass: z.boolean(),
  score: z.number().min(0).max(1),
  reasoning: z.string(),
});

/**
 * Build the judge prompt using Cria (dogfooding!).
 *
 * Uses chain-of-thought prompting for more reliable evaluations.
 */
function buildJudgePrompt(options: {
  input: Record<string, unknown>;
  response: string;
  criteria?: string[];
  expected?: string;
}): PromptBuilder {
  const criteriaList =
    options.criteria && options.criteria.length > 0
      ? options.criteria.map((c) => `- ${c}`).join("\n")
      : "- Overall quality and correctness";

  const expectedSection = options.expected
    ? `

## Expected Response (for comparison)
${options.expected}`
    : "";

  return cria
    .prompt()
    .system(
      `You are an expert evaluator for LLM outputs. Assess response quality using chain-of-thought reasoning.

IMPORTANT: Respond with valid JSON only:
{"pass": boolean, "score": 0.0-1.0, "reasoning": "explanation"}

Scoring guide:
- 1.0: Exceptional, exceeds all criteria
- 0.8-0.9: Good, meets criteria with minor issues
- 0.6-0.7: Acceptable, meets most criteria
- 0.4-0.5: Below expectations, significant gaps
- 0.0-0.3: Poor, fails to meet criteria`
    )
    .user(
      `## Input
${JSON.stringify(options.input, null, 2)}

## Response to Evaluate
${options.response}

## Evaluation Criteria
${criteriaList}${expectedSection}

Think step by step, then provide your JSON assessment.`
    );
}

function substituteVariables(
  text: string,
  input: Record<string, unknown>
): string {
  let result = text;
  for (const [key, value] of Object.entries(input)) {
    const placeholder = `{{${key}}}`;
    const stringValue =
      typeof value === "string" ? value : JSON.stringify(value);
    result = result.split(placeholder).join(stringValue);
  }
  return result;
}

async function renderPromptToString(
  prompt: PromptBuilder | PromptElement,
  options: {
    tokenizer?: Tokenizer;
    budget?: number;
    input: Record<string, unknown>;
  }
): Promise<string> {
  const { render } = await import("../render");

  const tokenizer = options.tokenizer ?? ((text: string) => text.length);
  const budget = options.budget ?? 100_000;

  let element: PromptElement;
  if ("build" in prompt && typeof prompt.build === "function") {
    element = await prompt.build();
  } else {
    element = prompt as PromptElement;
  }

  const rendered = await render(element, {
    tokenizer,
    budget,
    renderer: markdownRenderer,
  });

  return substituteVariables(rendered, options.input);
}

function parseJudgeResponse(responseText: string): {
  pass: boolean;
  score: number;
  reasoning: string;
} {
  const trimmed = responseText.trim();

  // Try to extract JSON from the response
  const jsonMatch = trimmed.match(JSON_EXTRACT_REGEX);
  if (!jsonMatch) {
    throw new Error(
      `Judge response did not contain valid JSON: ${trimmed.slice(0, 200)}`
    );
  }

  const parsed = JSON.parse(jsonMatch[0]);
  const result = JudgeResponseSchema.safeParse(parsed);

  if (!result.success) {
    throw new Error(
      `Judge response did not match expected schema: ${result.error.message}`
    );
  }

  return result.data;
}

/**
 * Evaluate a prompt using an LLM judge.
 *
 * The evaluation process:
 * 1. Render the prompt with the given input variables
 * 2. Execute the prompt against a model (using the judge provider)
 * 3. Have the judge evaluate the response against the criteria
 * 4. Return structured results with score, pass/fail, and reasoning
 *
 * @example
 * ```typescript
 * const result = await evaluate(myPrompt, {
 *   judge: openaiProvider,
 *   input: { question: "What is 2+2?" },
 *   criteria: ["accurate", "concise"],
 *   threshold: 0.8,
 * });
 *
 * expect(result.passed).toBe(true);
 * expect(result.score).toBeGreaterThan(0.8);
 * ```
 */
export async function evaluate(
  prompt: PromptBuilder | PromptElement,
  options: EvalOptions
): Promise<EvalResult> {
  const {
    judge,
    input,
    criteria,
    expected,
    threshold = DEFAULT_THRESHOLD,
  } = options;

  // Step 1: Render the prompt to a string with variables substituted
  const renderTokenizer = options.tokenizer ?? judge.tokenizer;
  const renderedPrompt = await renderPromptToString(prompt, {
    ...(renderTokenizer && { tokenizer: renderTokenizer }),
    ...(options.budget !== undefined && { budget: options.budget }),
    input,
  });

  // Step 2: Execute the prompt to get a response
  const promptResponse = await judge.completion({
    messages: [{ role: "user", content: renderedPrompt }],
  });

  const response = promptResponse.text;

  // Step 3: Build and render the judge prompt using Cria (dogfooding!)
  const judgePrompt = buildJudgePrompt({
    input,
    response,
    ...(criteria && { criteria }),
    ...(expected && { expected }),
  });

  const judgeRendered = await renderPromptToString(judgePrompt, {
    ...(renderTokenizer && { tokenizer: renderTokenizer }),
    input: {}, // Judge prompt has no variables
  });

  // Step 4: Execute the judge prompt
  const judgeResponse = await judge.completion({
    messages: [{ role: "user", content: judgeRendered }],
  });

  // Step 5: Parse and return the evaluation result
  const evaluation = parseJudgeResponse(judgeResponse.text);

  return {
    passed: evaluation.score >= threshold,
    score: evaluation.score,
    reasoning: evaluation.reasoning,
    response,
  };
}

/**
 * Create a mock judge for testing evaluations without making LLM calls.
 *
 * @example
 * ```typescript
 * import { evaluate, mockJudge } from "@fastpaca/cria/eval";
 *
 * const result = await evaluate(myPrompt, {
 *   judge: mockJudge({ score: 0.9 }),
 *   input: { question: "Test question" },
 *   criteria: ["accurate"],
 * });
 *
 * expect(result.score).toBe(0.9);
 * expect(result.passed).toBe(true);
 * ```
 */
export function mockJudge(options: MockJudgeOptions = {}): ModelProvider {
  const {
    score = 0.85,
    reasoning = "Mock evaluation - all criteria met satisfactorily.",
    response = "Mock response from the prompt under evaluation.",
  } = options;

  const passed = options.passed ?? score >= DEFAULT_THRESHOLD;

  let callCount = 0;

  return {
    name: "mock-judge",
    completion: () => {
      callCount += 1;

      // First call is the prompt execution, second is the judge evaluation
      if (callCount === 1) {
        return Promise.resolve({ text: response });
      }

      // Return judge evaluation as JSON
      return Promise.resolve({
        text: JSON.stringify({
          pass: passed,
          score,
          reasoning,
        }),
      });
    },
  };
}

// Re-export the Vitest matchers for convenience
// Users can import: import { criaMatchers, evaluate } from "@fastpaca/cria/eval";
// biome-ignore lint/performance/noBarrelFile: Intentional re-export for ergonomic API
export { criaMatchers } from "./vitest-matchers";
