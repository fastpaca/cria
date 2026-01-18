import { z } from "zod";
import { c, cria } from "../dsl";
import { render } from "../render";
import type { ModelProvider, PromptChildren, PromptElement } from "../types";

export const DEFAULT_THRESHOLD = 0.8;

export interface JudgeConfig {
  target: ModelProvider<unknown>;
  evaluator: ModelProvider<unknown>;
  threshold?: number;
}

export interface EvalResult {
  score: number;
  reasoning: string;
  passed: boolean;
  response: string;
}

export interface Judgment {
  toPass(criterion: PromptChildren): Promise<void>;
}

export type Judge = (prompt: PromptElement) => Judgment;

const EvalResultSchema = z.object({
  score: z.number().min(0).max(1),
  reasoning: z.string(),
});

export function createJudge(config: JudgeConfig): Judge {
  const { target, evaluator, threshold = DEFAULT_THRESHOLD } = config;

  return (prompt: PromptElement): Judgment => {
    const evaluate = async (criterion: PromptChildren): Promise<EvalResult> => {
      const response = await target.completion(
        await render(prompt, { renderer: target.renderer })
      );
      const evalPrompt = await cria
        .prompt()
        .system(c`You are an evaluator. 
          Score the response from 0 to 1 based on ALL criteria below.

          Criteria: ${criterion}

          Return JSON: { "score": <0-1>, "reasoning": "<brief explanation>" }
        `)
        .user(response)
        .build();

      const result = await evaluator.object(
        await render(evalPrompt, { renderer: evaluator.renderer }),
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
