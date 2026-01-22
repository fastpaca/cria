import { z } from "zod";
import type { TextInput } from "../dsl";
import { cria } from "../dsl";
import { normalizeTextInput } from "../dsl/templating";
import type { ModelProvider } from "../provider";
import { render } from "../render";
import type { PromptTree, ProviderToolIO } from "../types";

export const DEFAULT_THRESHOLD = 0.8;

export interface JudgeConfig {
  target: ModelProvider<unknown, ProviderToolIO>;
  evaluator: ModelProvider<unknown, ProviderToolIO>;
  threshold?: number;
}

export interface EvalResult {
  score: number;
  reasoning: string;
  passed: boolean;
  response: string;
}

export interface Judgment {
  toPass(criterion: TextInput): Promise<void>;
}

export type Judge = (prompt: PromptTree) => Judgment;

const EvalResultSchema = z.object({
  score: z.number().min(0).max(1),
  reasoning: z.string(),
});

const formatCriterion = (criterion: TextInput): string => {
  const parts = normalizeTextInput<ProviderToolIO>(criterion);
  let text = "";
  for (const part of parts) {
    if (part.type === "tool-call" || part.type === "tool-result") {
      throw new Error("Judge criteria cannot include tool calls or results.");
    }
    text += part.text;
  }
  return text;
};

export function createJudge(config: JudgeConfig): Judge {
  const { target, evaluator, threshold = DEFAULT_THRESHOLD } = config;

  return (prompt: PromptTree): Judgment => {
    const evaluate = async (criterion: TextInput): Promise<EvalResult> => {
      const response = await target.completion(
        await render(prompt, { provider: target })
      );
      const criteriaText = formatCriterion(criterion);
      const evalPrompt = await cria
        .prompt()
        .system(`You are an evaluator. 
          Score the response from 0 to 1 based on ALL criteria below.

          Criteria: ${criteriaText}

          Return JSON: { "score": <0-1>, "reasoning": "<brief explanation>" }
        `)
        .user(response)
        .build();

      const result = await evaluator.object(
        await render(evalPrompt, { provider: evaluator }),
        EvalResultSchema
      );

      return {
        response,
        score: result.score,
        reasoning: result.reasoning,
        passed: result.score >= threshold,
      };
    };

    return {
      async toPass(criterion) {
        const result = await evaluate(criterion);
        if (!result.passed) {
          throw new Error(
            "Expected prompt to pass criterion.\n\n" +
              `Score: ${result.score} (threshold: ${threshold})\n` +
              `Reasoning: ${result.reasoning}\n\n` +
              `Response:\n${result.response}`
          );
        }
      },
    };
  };
}
