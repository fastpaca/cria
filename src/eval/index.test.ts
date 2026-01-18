import { describe, expect, test } from "vitest";
import type { z } from "zod";
import { c } from "../dsl";
import { markdownRenderer } from "../renderers/markdown";
import type { ModelProvider } from "../types";
import { createJudge } from "./index";

function createMockProvider(opts: {
  completion?: string;
  object?: unknown;
}): ModelProvider<string> {
  return {
    name: "mock",
    renderer: markdownRenderer,
    completion: () => opts.completion ?? "",
    object: <T>(_: string, schema: z.ZodType<T>) =>
      opts.object ? schema.parse(opts.object) : schema.parse({}),
  };
}

describe("judge", () => {
  test("toPass succeeds when score >= threshold", async () => {
    const target = createMockProvider({ completion: "Hello!" });
    const evaluator = createMockProvider({
      object: { score: 0.9, reasoning: "Great" },
    });

    const prompt = {
      priority: 0,
      children: [
        {
          kind: "message" as const,
          role: "user",
          priority: 0,
          children: ["Hi"],
        },
      ],
    };

    const judge = createJudge({ target, evaluator });
    await expect(judge(prompt).toPass(c`Be friendly`)).resolves.toBeUndefined();
  });

  test("toPass throws when score < threshold", async () => {
    const target = createMockProvider({ completion: "Whatever." });
    const evaluator = createMockProvider({
      object: { score: 0.3, reasoning: "Not helpful" },
    });

    const prompt = {
      priority: 0,
      children: [
        {
          kind: "message" as const,
          role: "user",
          priority: 0,
          children: ["Help me"],
        },
      ],
    };

    const judge = createJudge({ target, evaluator, threshold: 0.8 });
    await expect(judge(prompt).toPass(c`Be helpful`)).rejects.toThrow(
      "Expected prompt to pass criterion"
    );
  });

  test("passes criterion to evaluator", async () => {
    let capturedPrompt = "";
    const target = createMockProvider({ completion: "Response" });
    const evaluator: ModelProvider<string> = {
      name: "evaluator",
      renderer: markdownRenderer,
      completion: () => "",
      object: <T>(rendered: string, schema: z.ZodType<T>) => {
        capturedPrompt = rendered;
        return schema.parse({ score: 1, reasoning: "ok" });
      },
    };

    const prompt = {
      priority: 0,
      children: [
        {
          kind: "message" as const,
          role: "user",
          priority: 0,
          children: ["Test"],
        },
      ],
    };

    const judge = createJudge({ target, evaluator });
    await judge(prompt).toPass(c`Check for politeness`);

    expect(capturedPrompt).toContain("politeness");
    expect(capturedPrompt).toContain("You are an evaluator");
  });
});
