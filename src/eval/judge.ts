import { PromptBuilder } from "../dsl";
import { render } from "../render";
import type { ModelProvider, PromptElement } from "../types";

export const DEFAULT_THRESHOLD = 0.8;

export type PromptInput = PromptBuilder | PromptElement;

export interface JudgeConfig {
  target: ModelProvider<unknown>;
  evaluator: ModelProvider<unknown>;
  threshold?: number;
  timeout?: number;
}

export interface EvalResult {
  score: number;
  reasoning: string;
  passed: boolean;
  response: string;
}

export interface WeightedCriterion {
  criterion: PromptInput;
  weight: number;
}

export interface Judgment {
  evaluate(criterion: PromptInput): Promise<EvalResult>;
  toPass(criterion: PromptInput): Promise<void>;
  toPassAll(criteria: readonly PromptInput[]): Promise<void>;
  toPassWeighted(criteria: readonly WeightedCriterion[]): Promise<void>;
}

const RESPONSE_HEADER = "Response to evaluate:";

export function judge(config: JudgeConfig): (prompt: PromptInput) => Judgment {
  const { target, evaluator, threshold = DEFAULT_THRESHOLD, timeout } = config;

  return (prompt: PromptInput): Judgment => {
    const getResponse = async () => executePrompt(prompt, target, timeout);

    const evaluateCriterion = async (
      response: string,
      criterion: PromptInput
    ) => {
      const evaluationPrompt = buildCriterionPrompt(criterion, response);
      const evaluationText = await executePrompt(
        evaluationPrompt,
        evaluator,
        timeout
      );
      const evaluation = parseEvaluatorOutput(evaluationText);

      return {
        response,
        score: evaluation.score,
        reasoning: evaluation.reasoning,
        passed: evaluation.score >= threshold,
      };
    };

    return {
      evaluate: async (criterion) => {
        const response = await getResponse();
        return evaluateCriterion(response, criterion);
      },
      toPass: async (criterion) => {
        const response = await getResponse();
        const result = await evaluateCriterion(response, criterion);
        if (!result.passed) {
          throw new Error(
            "Expected prompt to pass criterion.\n\n" +
              `Score: ${result.score} (threshold: ${threshold})\n` +
              `Reasoning: ${result.reasoning}\n\n` +
              `Response:\n${result.response}`
          );
        }
      },
      toPassAll: async (criteria) => {
        if (criteria.length === 0) {
          throw new Error("toPassAll requires at least one criterion.");
        }
        const response = await getResponse();
        const results = await Promise.all(
          criteria.map((criterion) => evaluateCriterion(response, criterion))
        );
        const failures = results.filter((result) => !result.passed);
        if (failures.length > 0) {
          throw new Error(
            "Expected prompt to pass all criteria.\n\n" +
              `Failures:\n${failures
                .map(
                  (failure) =>
                    `  - Score: ${failure.score} (threshold: ${threshold}) Reasoning: ${failure.reasoning}`
                )
                .join("\n")}\n\n` +
              `Response:\n${failures[0]?.response ?? ""}`
          );
        }
      },
      toPassWeighted: async (criteria) => {
        if (criteria.length === 0) {
          throw new Error("toPassWeighted requires at least one criterion.");
        }
        const response = await getResponse();
        const results = await Promise.all(
          criteria.map(async ({ criterion, weight }) => ({
            ...(await evaluateCriterion(response, criterion)),
            weight,
          }))
        );

        const totalWeight = results.reduce(
          (sum, result) => sum + result.weight,
          0
        );
        if (totalWeight <= 0) {
          throw new Error(
            "Weighted criteria must have a positive total weight."
          );
        }

        const weightedScore =
          results.reduce(
            (sum, result) => sum + result.score * result.weight,
            0
          ) / totalWeight;

        if (weightedScore < threshold) {
          throw new Error(
            "Expected prompt to pass weighted criteria.\n\n" +
              `Weighted Score: ${weightedScore.toFixed(
                2
              )} (threshold: ${threshold})\n` +
              `Individual:\n${results
                .map(
                  (result) =>
                    `  - Score: ${result.score} (weight: ${result.weight}) Reasoning: ${result.reasoning}`
                )
                .join("\n")}\n\n` +
              `Response:\n${results[0]?.response ?? ""}`
          );
        }
      },
    };
  };
}

async function executePrompt(
  prompt: PromptInput,
  provider: ModelProvider<unknown>,
  timeout?: number
): Promise<string> {
  const element = await resolvePromptElement(prompt);
  const rendered = await render(element, { renderer: provider.renderer });
  const result = await withTimeout(
    Promise.resolve(provider.completion(rendered)),
    timeout
  );
  return result.text;
}

function buildCriterionPrompt(
  criterion: PromptInput,
  response: string
): PromptBuilder {
  const base = PromptBuilder.create();
  const builder = isPromptBuilder(criterion)
    ? base.merge(criterion)
    : base.raw(criterion);

  return builder.user(`${RESPONSE_HEADER}\n\n${response}`);
}

async function resolvePromptElement(
  prompt: PromptInput
): Promise<PromptElement> {
  if (isPromptBuilder(prompt)) {
    return await prompt.build();
  }
  return prompt;
}

function isPromptBuilder(value: PromptInput): value is PromptBuilder {
  return "build" in value && typeof value.build === "function";
}

interface EvaluatorOutput {
  score: number;
  reasoning: string;
}

function parseEvaluatorOutput(raw: string): EvaluatorOutput {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Evaluator response must be valid JSON.");
  }

  if (!isPlainObject(parsed)) {
    throw new Error("Evaluator response must be an object.");
  }

  const score = parsed.score;
  const reasoning = parsed.reasoning;

  if (typeof score !== "number" || Number.isNaN(score)) {
    throw new Error("Evaluator score must be a number.");
  }
  if (score < 0 || score > 1) {
    throw new Error("Evaluator score must be between 0 and 1.");
  }
  if (typeof reasoning !== "string") {
    throw new Error("Evaluator reasoning must be a string.");
  }

  return { score, reasoning };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeout?: number
): Promise<T> {
  if (timeout === undefined || timeout <= 0) {
    return promise;
  }

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Evaluation request timed out after ${timeout}ms.`));
    }, timeout);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}
