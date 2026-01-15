import type { ModelMessage } from "ai";
import { describe, expect, test, vi } from "vitest";
import { renderer as aiSdkRenderer } from "../ai-sdk";
import { Region, ToolCall, ToolResult } from "../components";
import { cria } from "../dsl";
import { markdownRenderer } from "../renderers/markdown";
import type { ModelProvider } from "../types";
import {
  criaMatchers,
  EvalEvaluatorError,
  EvalSchemaError,
  EvalTargetError,
  EvalTimeoutError,
  type EvaluatorProvider,
  evaluate,
  mockEvaluator,
  mockTarget,
} from "./index";

expect.extend(criaMatchers);

function createCapturingTarget(response = "Mock response"): {
  target: ModelProvider<string>;
  getCapturedPrompt: () => string;
} {
  let capturedPrompt = "";
  const target: ModelProvider<string> = {
    name: "capturing-target",
    renderer: markdownRenderer,
    completion: (rendered) => {
      capturedPrompt = rendered;
      return Promise.resolve({ text: response });
    },
  };

  return {
    target,
    getCapturedPrompt: () => capturedPrompt,
  };
}

describe("evaluate", () => {
  test("returns score and reasoning from mock evaluator", async () => {
    const prompt = cria.prompt().system("Answer questions").user("{{q}}");

    const result = await evaluate(prompt, {
      target: mockTarget(),
      evaluator: mockEvaluator({ score: 0.9, reasoning: "Excellent response" }),
      input: { q: "What is 2+2?" },
      criteria: ["accurate"],
    });

    expect(result.score).toBe(0.9);
    expect(result.passed).toBe(true);
    expect(result.reasoning).toBe("Excellent response");
  });

  test("passes when score >= threshold", async () => {
    const prompt = cria.prompt().user("{{question}}");

    const result = await evaluate(prompt, {
      target: mockTarget(),
      evaluator: mockEvaluator({ score: 0.8 }),
      input: { question: "Test question" },
      threshold: 0.8,
    });

    expect(result.passed).toBe(true);
  });

  test("fails when score < threshold", async () => {
    const prompt = cria.prompt().user("{{question}}");

    const result = await evaluate(prompt, {
      target: mockTarget(),
      evaluator: mockEvaluator({ score: 0.7 }),
      input: { question: "Test question" },
      threshold: 0.8,
    });

    expect(result.passed).toBe(false);
  });

  test("uses default threshold of 0.8", async () => {
    const prompt = cria.prompt().user("Test");

    const passingResult = await evaluate(prompt, {
      target: mockTarget(),
      evaluator: mockEvaluator({ score: 0.8 }),
      input: {},
    });
    expect(passingResult.passed).toBe(true);

    const failingResult = await evaluate(prompt, {
      target: mockTarget(),
      evaluator: mockEvaluator({ score: 0.79 }),
      input: {},
    });
    expect(failingResult.passed).toBe(false);
  });

  test("substitutes variables in prompt", async () => {
    const prompt = cria
      .prompt()
      .system("You help with {{topic}}")
      .user("{{question}}");

    const { target, getCapturedPrompt } = createCapturingTarget();

    await evaluate(prompt, {
      target,
      evaluator: mockEvaluator(),
      input: { topic: "math", question: "What is 2+2?" },
    });

    const capturedPrompt = getCapturedPrompt();
    expect(capturedPrompt).toContain("math");
    expect(capturedPrompt).toContain("What is 2+2?");
    expect(capturedPrompt).not.toContain("{{topic}}");
    expect(capturedPrompt).not.toContain("{{question}}");
  });

  test("leaves unknown placeholders intact", async () => {
    const prompt = cria.prompt().user("Hello {{name}} {{missing}}");

    const { target, getCapturedPrompt } = createCapturingTarget();

    await evaluate(prompt, {
      target,
      evaluator: mockEvaluator(),
      input: { name: "Ada" },
    });

    const capturedPrompt = getCapturedPrompt();
    expect(capturedPrompt).toContain("Hello Ada {{missing}}");
  });

  test("preserves placeholder-like text in input values", async () => {
    const prompt = cria.prompt().user("Question: {{q}}");

    const { target, getCapturedPrompt } = createCapturingTarget();

    await evaluate(prompt, {
      target,
      evaluator: mockEvaluator(),
      input: { q: "Use {{not-a-var}} literally" },
    });

    const capturedPrompt = getCapturedPrompt();
    expect(capturedPrompt).toContain("Question: Use {{not-a-var}} literally");
  });

  test("preserves tool call structure and substitutes structured inputs", async () => {
    const prompt = cria.prompt().assistant((m) =>
      m
        .append(
          ToolCall({
            toolCallId: "call-1",
            toolName: "search",
            input: { query: "{{q}}", limit: "{{limit}}" },
          })
        )
        .append(
          ToolResult({
            toolCallId: "call-1",
            toolName: "search",
            output: { status: "ok", result: "{{answer}}" },
          })
        )
    );

    let renderedMessages: ModelMessage[] = [];
    const capturingTarget: ModelProvider<ModelMessage[]> = {
      name: "capturing-target",
      renderer: aiSdkRenderer,
      completion: (messages) => {
        renderedMessages = messages;
        return Promise.resolve({ text: "Mock response" });
      },
    };

    await evaluate(prompt, {
      target: capturingTarget,
      evaluator: mockEvaluator(),
      input: { q: "cats", limit: 3, answer: "done" },
    });

    const assistantMessage = renderedMessages.find(
      (message) => message.role === "assistant"
    );
    if (!(assistantMessage && Array.isArray(assistantMessage.content))) {
      throw new Error("Expected structured assistant message content");
    }

    const toolCallPart = assistantMessage.content.find(
      (part) => part.type === "tool-call"
    ) as { toolName: string; input: unknown } | undefined;

    expect(toolCallPart).toMatchObject({
      toolName: "search",
      input: { query: "cats", limit: 3 },
    });

    const toolMessage = renderedMessages.find(
      (message) => message.role === "tool"
    );
    if (!(toolMessage && Array.isArray(toolMessage.content))) {
      throw new Error("Expected tool message content");
    }

    expect(toolMessage.content[0]).toMatchObject({
      type: "tool-result",
      toolName: "search",
      output: {
        type: "json",
        value: { status: "ok", result: "done" },
      },
    });
  });

  test("passes criteria to evaluator", async () => {
    const prompt = cria.prompt().user("Test");

    let capturedEvaluatorText = "";
    const capturingEvaluator: EvaluatorProvider = {
      name: "capturing-evaluator",
      evaluate: (request) => {
        capturedEvaluatorText = request.messages
          .map((message) => message.content)
          .join("\n");
        return { score: 0.9, reasoning: "Good" };
      },
    };

    await evaluate(prompt, {
      target: mockTarget(),
      evaluator: capturingEvaluator,
      input: {},
      criteria: ["helpful", "accurate", "professional"],
    });

    expect(capturedEvaluatorText).toContain("helpful");
    expect(capturedEvaluatorText).toContain("accurate");
    expect(capturedEvaluatorText).toContain("professional");
  });

  test("uses default criteria when criteria array is empty", async () => {
    const prompt = cria.prompt().user("Test");

    let capturedEvaluatorText = "";
    const capturingEvaluator: EvaluatorProvider = {
      name: "capturing-evaluator",
      evaluate: (request) => {
        capturedEvaluatorText = request.messages
          .map((message) => message.content)
          .join("\n");
        return { score: 0.9, reasoning: "Good" };
      },
    };

    await evaluate(prompt, {
      target: mockTarget(),
      evaluator: capturingEvaluator,
      input: {},
      criteria: [],
    });

    expect(capturedEvaluatorText).toContain("Overall quality and correctness");
  });

  test("passes expected output to evaluator when provided", async () => {
    const prompt = cria.prompt().user("What is the capital of France?");

    let capturedEvaluatorText = "";
    const capturingEvaluator: EvaluatorProvider = {
      name: "capturing-evaluator",
      evaluate: (request) => {
        capturedEvaluatorText = request.messages
          .map((message) => message.content)
          .join("\n");
        return { score: 0.95, reasoning: "Matches expected" };
      },
    };

    await evaluate(prompt, {
      target: mockTarget(),
      evaluator: capturingEvaluator,
      input: {},
      expected: "Paris",
    });

    expect(capturedEvaluatorText).toContain("Expected Response");
    expect(capturedEvaluatorText).toContain("Paris");
  });

  test("omits expected section when expected is empty", async () => {
    const prompt = cria.prompt().user("Test");

    let capturedEvaluatorText = "";
    const capturingEvaluator: EvaluatorProvider = {
      name: "capturing-evaluator",
      evaluate: (request) => {
        capturedEvaluatorText = request.messages
          .map((message) => message.content)
          .join("\n");
        return { score: 0.9, reasoning: "Good" };
      },
    };

    await evaluate(prompt, {
      target: mockTarget(),
      evaluator: capturingEvaluator,
      input: {},
      expected: "",
    });

    expect(capturedEvaluatorText).not.toContain("Expected Response");
  });

  test("passes very long expected output through to evaluator", async () => {
    const prompt = cria.prompt().user("Test");
    const expected = "Expected output ".repeat(400);

    let capturedEvaluatorText = "";
    const capturingEvaluator: EvaluatorProvider = {
      name: "capturing-evaluator",
      evaluate: (request) => {
        capturedEvaluatorText = request.messages
          .map((message) => message.content)
          .join("\n");
        return { score: 0.9, reasoning: "Good" };
      },
    };

    await evaluate(prompt, {
      target: mockTarget(),
      evaluator: capturingEvaluator,
      input: {},
      expected,
    });

    expect(capturedEvaluatorText).toContain(expected.slice(0, 120));
  });

  test("works with raw PromptElement", async () => {
    const element = Region({
      priority: 0,
      children: ["Hello, {{name}}!"],
    });

    const result = await evaluate(element, {
      target: mockTarget(),
      evaluator: mockEvaluator({ score: 0.85 }),
      input: { name: "World" },
    });

    expect(result.passed).toBe(true);
    expect(result.score).toBe(0.85);
  });

  test("includes response in result", async () => {
    const prompt = cria.prompt().user("Test");
    const mockResponse = "This is the mock response";

    const result = await evaluate(prompt, {
      target: mockTarget({ response: mockResponse }),
      evaluator: mockEvaluator({ score: 0.9 }),
      input: {},
    });

    expect(result.response).toBe(mockResponse);
  });

  test("handles empty response from target", async () => {
    const prompt = cria.prompt().user("Test");

    const result = await evaluate(prompt, {
      target: mockTarget({ response: "" }),
      evaluator: mockEvaluator({ score: 0.9 }),
      input: {},
    });

    expect(result.response).toBe("");
  });
});

describe("mockEvaluator", () => {
  test("returns configured score", async () => {
    const evaluator = mockEvaluator({ score: 0.75 });
    const prompt = cria.prompt().user("Test");

    const result = await evaluate(prompt, {
      target: mockTarget(),
      evaluator,
      input: {},
    });

    expect(result.score).toBe(0.75);
  });

  test("returns configured reasoning", async () => {
    const evaluator = mockEvaluator({
      score: 0.9,
      reasoning: "Custom reasoning message",
    });
    const prompt = cria.prompt().user("Test");

    const result = await evaluate(prompt, {
      target: mockTarget(),
      evaluator,
      input: {},
    });

    expect(result.reasoning).toBe("Custom reasoning message");
  });

  test("uses default values when not configured", async () => {
    const evaluator = mockEvaluator();
    const prompt = cria.prompt().user("Test");

    const result = await evaluate(prompt, {
      target: mockTarget(),
      evaluator,
      input: {},
    });

    expect(result.score).toBe(0.85);
    expect(result.passed).toBe(true);
    expect(result.reasoning).toBe(
      "Mock evaluation - all criteria met satisfactorily."
    );
  });
});

describe("mockTarget", () => {
  test("returns configured response", async () => {
    const prompt = cria.prompt().user("Test");

    const result = await evaluate(prompt, {
      target: mockTarget({ response: "Custom mock response" }),
      evaluator: mockEvaluator({ score: 0.9 }),
      input: {},
    });

    expect(result.response).toBe("Custom mock response");
  });

  test("uses default response when not configured", async () => {
    const prompt = cria.prompt().user("Test");

    const result = await evaluate(prompt, {
      target: mockTarget(),
      evaluator: mockEvaluator({ score: 0.9 }),
      input: {},
    });

    expect(result.response).toBe(
      "Mock response from the prompt under evaluation."
    );
  });
});

describe("criaMatchers", () => {
  test("toPassEvaluation succeeds when evaluation passes", async () => {
    const prompt = cria.prompt().user("Test question");

    await expect(prompt).toPassEvaluation({
      target: mockTarget(),
      evaluator: mockEvaluator({ score: 0.9 }),
      input: {},
      criteria: ["helpful"],
    });
  });

  test("toPassEvaluation fails when evaluation fails", async () => {
    const prompt = cria.prompt().user("Test question");

    await expect(
      expect(prompt).toPassEvaluation({
        target: mockTarget(),
        evaluator: mockEvaluator({ score: 0.5 }),
        input: {},
        threshold: 0.8,
      })
    ).rejects.toThrow("Expected evaluation to pass");
  });

  test("toPassEvaluation respects custom threshold", async () => {
    const prompt = cria.prompt().user("Test");

    // Should pass with 0.7 score and 0.6 threshold
    await expect(prompt).toPassEvaluation({
      target: mockTarget(),
      evaluator: mockEvaluator({ score: 0.7 }),
      input: {},
      threshold: 0.6,
    });

    // Should fail with 0.7 score and 0.8 threshold
    await expect(
      expect(prompt).toPassEvaluation({
        target: mockTarget(),
        evaluator: mockEvaluator({ score: 0.7 }),
        input: {},
        threshold: 0.8,
      })
    ).rejects.toThrow();
  });
});

describe("error handling", () => {
  test("throws EvalSchemaError with raw output", async () => {
    const prompt = cria.prompt().user("Test");

    const badEvaluator: EvaluatorProvider = {
      name: "bad-evaluator",
      evaluate: () => ({ score: 1.5, reasoning: "Too high" }),
    };

    let caught: unknown;
    try {
      await evaluate(prompt, {
        target: mockTarget(),
        evaluator: badEvaluator,
        input: {},
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(EvalSchemaError);
    if (caught instanceof EvalSchemaError) {
      expect(caught.rawOutput).toEqual({ score: 1.5, reasoning: "Too high" });
    }
  });

  test("rejects evaluator output with NaN score", async () => {
    const prompt = cria.prompt().user("Test");

    const badEvaluator: EvaluatorProvider = {
      name: "nan-evaluator",
      evaluate: () => ({ score: Number.NaN, reasoning: "NaN" }),
    };

    await expect(
      evaluate(prompt, {
        target: mockTarget(),
        evaluator: badEvaluator,
        input: {},
      })
    ).rejects.toBeInstanceOf(EvalSchemaError);
  });

  test("rejects evaluator output with negative score", async () => {
    const prompt = cria.prompt().user("Test");

    const badEvaluator: EvaluatorProvider = {
      name: "negative-score",
      evaluate: () => ({ score: -0.1, reasoning: "Negative" }),
    };

    await expect(
      evaluate(prompt, {
        target: mockTarget(),
        evaluator: badEvaluator,
        input: {},
      })
    ).rejects.toBeInstanceOf(EvalSchemaError);
  });

  test("rejects evaluator output missing reasoning", async () => {
    const prompt = cria.prompt().user("Test");

    const badEvaluator: EvaluatorProvider = {
      name: "missing-reasoning",
      // @ts-expect-error - intentional invalid output for schema validation
      evaluate: () => ({ score: 0.9 }),
    };

    await expect(
      evaluate(prompt, {
        target: mockTarget(),
        evaluator: badEvaluator,
        input: {},
      })
    ).rejects.toBeInstanceOf(EvalSchemaError);
  });

  test("wraps target provider errors", async () => {
    const prompt = cria.prompt().user("Test");

    const failingTarget: ModelProvider<string> = {
      name: "failing-target",
      renderer: markdownRenderer,
      completion: () => {
        throw new Error("Target failed");
      },
    };

    await expect(
      evaluate(prompt, {
        target: failingTarget,
        evaluator: mockEvaluator(),
        input: {},
      })
    ).rejects.toBeInstanceOf(EvalTargetError);
  });

  test("wraps evaluator provider errors", async () => {
    const prompt = cria.prompt().user("Test");

    const failingEvaluator: EvaluatorProvider = {
      name: "failing-evaluator",
      evaluate: () => {
        throw new Error("Evaluator failed");
      },
    };

    await expect(
      evaluate(prompt, {
        target: mockTarget(),
        evaluator: failingEvaluator,
        input: {},
      })
    ).rejects.toBeInstanceOf(EvalEvaluatorError);
  });

  test("times out slow providers", async () => {
    vi.useFakeTimers();
    const prompt = cria.prompt().user("Test");

    const slowEvaluator: EvaluatorProvider = {
      name: "slow-evaluator",
      evaluate: () =>
        new Promise(() => {
          // Intentionally unresolved to trigger timeout handling.
        }),
    };

    const evaluation = evaluate(prompt, {
      target: mockTarget(),
      evaluator: slowEvaluator,
      input: {},
      timeoutMs: 10,
    });

    const assertion =
      expect(evaluation).rejects.toBeInstanceOf(EvalTimeoutError);
    await vi.advanceTimersByTimeAsync(10);
    await assertion;
    vi.useRealTimers();
  });
});
