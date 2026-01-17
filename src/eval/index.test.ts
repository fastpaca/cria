import { describe, expect, test } from "vitest";
import { markdownRenderer } from "../renderers/markdown";
import type { ModelProvider } from "../types";
import { cria, judge } from "./index";

function createCapturingProvider(responseText: string): {
  provider: ModelProvider<string>;
  getCaptured: () => string;
} {
  let captured = "";
  const provider: ModelProvider<string> = {
    name: "capturing-provider",
    renderer: markdownRenderer,
    completion: (rendered) => {
      captured = rendered;
      return Promise.resolve({ text: responseText });
    },
  };

  return {
    provider,
    getCaptured: () => captured,
  };
}

describe("judge", () => {
  test("evaluate returns score, reasoning, and response", async () => {
    const { provider: target } = createCapturingProvider("Target response");
    const { provider: evaluator, getCaptured } = createCapturingProvider(
      JSON.stringify({ score: 0.9, reasoning: "Solid" })
    );

    const prompt = cria.prompt().user("Question?");
    const criterion = cria
      .prompt()
      .system("Evaluate helpfulness. Return JSON: { score, reasoning }.");

    const run = judge({ target, evaluator });
    const result = await run(prompt).evaluate(criterion);

    expect(result.score).toBe(0.9);
    expect(result.reasoning).toBe("Solid");
    expect(result.passed).toBe(true);
    expect(result.response).toBe("Target response");
    expect(getCaptured()).toContain("Response to evaluate:");
    expect(getCaptured()).toContain("Target response");
  });

  test("toPass throws when score is below threshold", async () => {
    const { provider: target } = createCapturingProvider("Target response");
    const { provider: evaluator } = createCapturingProvider(
      JSON.stringify({ score: 0.2, reasoning: "Not great" })
    );

    const prompt = cria.prompt().user("Question?");
    const criterion = cria
      .prompt()
      .system("Return JSON: { score, reasoning }.");

    const run = judge({ target, evaluator, threshold: 0.8 });

    await expect(run(prompt).toPass(criterion)).rejects.toThrow(
      "Expected prompt to pass criterion."
    );
  });

  test("toPassAll evaluates once and reuses the response", async () => {
    let calls = 0;
    const target: ModelProvider<string> = {
      name: "target",
      renderer: markdownRenderer,
      completion: () => {
        calls += 1;
        return Promise.resolve({ text: "Target response" });
      },
    };
    const evaluator: ModelProvider<string> = {
      name: "evaluator",
      renderer: markdownRenderer,
      completion: () =>
        Promise.resolve({
          text: JSON.stringify({ score: 0.9, reasoning: "Good" }),
        }),
    };

    const prompt = cria.prompt().user("Question?");
    const criteria = [
      cria.prompt().system("Criterion A. Return JSON."),
      cria.prompt().system("Criterion B. Return JSON."),
    ];

    const run = judge({ target, evaluator });
    await run(prompt).toPassAll(criteria);

    expect(calls).toBe(1);
  });

  test("toPassWeighted uses weighted scores", async () => {
    const target: ModelProvider<string> = {
      name: "target",
      renderer: markdownRenderer,
      completion: () => Promise.resolve({ text: "Target response" }),
    };
    const evaluator: ModelProvider<string> = {
      name: "evaluator",
      renderer: markdownRenderer,
      completion: (rendered) => {
        const score = rendered.includes("criterion-a") ? 0.2 : 0.9;
        return Promise.resolve({
          text: JSON.stringify({ score, reasoning: "ok" }),
        });
      },
    };

    const prompt = cria.prompt().user("Question?");
    const criteria = [
      { criterion: cria.prompt().system("criterion-a"), weight: 0.7 },
      { criterion: cria.prompt().system("criterion-b"), weight: 0.3 },
    ];

    const run = judge({ target, evaluator, threshold: 0.8 });

    await expect(run(prompt).toPassWeighted(criteria)).rejects.toThrow(
      "Expected prompt to pass weighted criteria."
    );
  });

  test("rejects invalid evaluator JSON", async () => {
    const target: ModelProvider<string> = {
      name: "target",
      renderer: markdownRenderer,
      completion: () => Promise.resolve({ text: "Target response" }),
    };
    const evaluator: ModelProvider<string> = {
      name: "evaluator",
      renderer: markdownRenderer,
      completion: () => Promise.resolve({ text: "not json" }),
    };

    const prompt = cria.prompt().user("Question?");
    const criterion = cria.prompt().system("Return JSON.");

    const run = judge({ target, evaluator });

    await expect(run(prompt).evaluate(criterion)).rejects.toThrow(
      "Evaluator response must be valid JSON."
    );
  });
});
