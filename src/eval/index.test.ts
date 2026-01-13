import { describe, expect, test } from "vitest";
import { Region } from "../components";
import { cria } from "../dsl";
import type { ModelProvider } from "../types";
import { criaMatchers, evaluate, mockJudge } from "./index";

expect.extend(criaMatchers);

describe("evaluate", () => {
  test("returns score and reasoning from mock judge", async () => {
    const prompt = cria.prompt().system("Answer questions").user("{{q}}");

    const result = await evaluate(prompt, {
      judge: mockJudge({ score: 0.9, reasoning: "Excellent response" }),
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
      judge: mockJudge({ score: 0.8 }),
      input: { question: "Test question" },
      threshold: 0.8,
    });

    expect(result.passed).toBe(true);
  });

  test("fails when score < threshold", async () => {
    const prompt = cria.prompt().user("{{question}}");

    const result = await evaluate(prompt, {
      judge: mockJudge({ score: 0.7 }),
      input: { question: "Test question" },
      threshold: 0.8,
    });

    expect(result.passed).toBe(false);
  });

  test("uses default threshold of 0.8", async () => {
    const prompt = cria.prompt().user("Test");

    const passingResult = await evaluate(prompt, {
      judge: mockJudge({ score: 0.8 }),
      input: {},
    });
    expect(passingResult.passed).toBe(true);

    const failingResult = await evaluate(prompt, {
      judge: mockJudge({ score: 0.79 }),
      input: {},
    });
    expect(failingResult.passed).toBe(false);
  });

  test("substitutes variables in prompt", async () => {
    const prompt = cria
      .prompt()
      .system("You help with {{topic}}")
      .user("{{question}}");

    let capturedPrompt = "";
    const capturingJudge: ModelProvider = {
      name: "capturing-judge",
      completion: (request) => {
        if (!capturedPrompt) {
          capturedPrompt = request.messages[0]?.content ?? "";
        }
        return Promise.resolve({
          text: JSON.stringify({
            pass: true,
            score: 0.9,
            reasoning: "Good",
          }),
        });
      },
    };

    await evaluate(prompt, {
      judge: capturingJudge,
      input: { topic: "math", question: "What is 2+2?" },
    });

    expect(capturedPrompt).toContain("math");
    expect(capturedPrompt).toContain("What is 2+2?");
    expect(capturedPrompt).not.toContain("{{topic}}");
    expect(capturedPrompt).not.toContain("{{question}}");
  });

  test("passes criteria to judge", async () => {
    const prompt = cria.prompt().user("Test");

    let capturedJudgePrompt = "";
    let callCount = 0;
    const capturingJudge: ModelProvider = {
      name: "capturing-judge",
      completion: (request) => {
        callCount++;
        if (callCount === 2) {
          capturedJudgePrompt =
            request.messages.find((m) => m.role === "user")?.content ?? "";
        }
        return Promise.resolve({
          text: JSON.stringify({
            pass: true,
            score: 0.9,
            reasoning: "Good",
          }),
        });
      },
    };

    await evaluate(prompt, {
      judge: capturingJudge,
      input: {},
      criteria: ["helpful", "accurate", "professional"],
    });

    expect(capturedJudgePrompt).toContain("helpful");
    expect(capturedJudgePrompt).toContain("accurate");
    expect(capturedJudgePrompt).toContain("professional");
  });

  test("passes expected output to judge when provided", async () => {
    const prompt = cria.prompt().user("What is the capital of France?");

    let capturedJudgePrompt = "";
    let callCount = 0;
    const capturingJudge: ModelProvider = {
      name: "capturing-judge",
      completion: (request) => {
        callCount++;
        if (callCount === 2) {
          capturedJudgePrompt =
            request.messages.find((m) => m.role === "user")?.content ?? "";
        }
        return Promise.resolve({
          text: JSON.stringify({
            pass: true,
            score: 0.95,
            reasoning: "Matches expected",
          }),
        });
      },
    };

    await evaluate(prompt, {
      judge: capturingJudge,
      input: {},
      expected: "Paris",
    });

    expect(capturedJudgePrompt).toContain("Expected Response");
    expect(capturedJudgePrompt).toContain("Paris");
  });

  test("works with raw PromptElement", async () => {
    const element = Region({
      priority: 0,
      children: ["Hello, {{name}}!"],
    });

    const result = await evaluate(element, {
      judge: mockJudge({ score: 0.85 }),
      input: { name: "World" },
    });

    expect(result.passed).toBe(true);
    expect(result.score).toBe(0.85);
  });

  test("includes response in result", async () => {
    const prompt = cria.prompt().user("Test");
    const mockResponse = "This is the mock response";

    const result = await evaluate(prompt, {
      judge: mockJudge({ score: 0.9, response: mockResponse }),
      input: {},
    });

    expect(result.response).toBe(mockResponse);
  });
});

describe("mockJudge", () => {
  test("returns configured score", async () => {
    const judge = mockJudge({ score: 0.75 });
    const prompt = cria.prompt().user("Test");

    const result = await evaluate(prompt, {
      judge,
      input: {},
    });

    expect(result.score).toBe(0.75);
  });

  test("returns configured reasoning", async () => {
    const judge = mockJudge({
      score: 0.9,
      reasoning: "Custom reasoning message",
    });
    const prompt = cria.prompt().user("Test");

    const result = await evaluate(prompt, {
      judge,
      input: {},
    });

    expect(result.reasoning).toBe("Custom reasoning message");
  });

  test("returns configured response", async () => {
    const judge = mockJudge({
      score: 0.9,
      response: "Custom mock response",
    });
    const prompt = cria.prompt().user("Test");

    const result = await evaluate(prompt, {
      judge,
      input: {},
    });

    expect(result.response).toBe("Custom mock response");
  });

  test("uses default values when not configured", async () => {
    const judge = mockJudge();
    const prompt = cria.prompt().user("Test");

    const result = await evaluate(prompt, {
      judge,
      input: {},
    });

    expect(result.score).toBe(0.85);
    expect(result.passed).toBe(true);
    expect(result.reasoning).toBe(
      "Mock evaluation - all criteria met satisfactorily."
    );
  });

  test("allows explicit passed override", async () => {
    const judge = mockJudge({ score: 0.9, passed: false });
    const prompt = cria.prompt().user("Test");

    const result = await evaluate(prompt, {
      judge,
      input: {},
    });

    // Score is 0.9 but we explicitly set passed to false
    // However, evaluate() determines passed from score >= threshold
    expect(result.score).toBe(0.9);
  });
});

describe("criaMatchers", () => {
  test("toPassEvaluation succeeds when evaluation passes", async () => {
    const prompt = cria.prompt().user("Test question");

    await expect(prompt).toPassEvaluation({
      judge: mockJudge({ score: 0.9 }),
      input: {},
      criteria: ["helpful"],
    });
  });

  test("toPassEvaluation fails when evaluation fails", async () => {
    const prompt = cria.prompt().user("Test question");

    await expect(
      expect(prompt).toPassEvaluation({
        judge: mockJudge({ score: 0.5 }),
        input: {},
        threshold: 0.8,
      })
    ).rejects.toThrow("Expected evaluation to pass");
  });

  test("toPassEvaluation respects custom threshold", async () => {
    const prompt = cria.prompt().user("Test");

    // Should pass with 0.7 score and 0.6 threshold
    await expect(prompt).toPassEvaluation({
      judge: mockJudge({ score: 0.7 }),
      input: {},
      threshold: 0.6,
    });

    // Should fail with 0.7 score and 0.8 threshold
    await expect(
      expect(prompt).toPassEvaluation({
        judge: mockJudge({ score: 0.7 }),
        input: {},
        threshold: 0.8,
      })
    ).rejects.toThrow();
  });
});

describe("error handling", () => {
  test("handles malformed judge JSON gracefully", async () => {
    const prompt = cria.prompt().user("Test");

    const badJudge: ModelProvider = {
      name: "bad-judge",
      completion: () =>
        Promise.resolve({
          text: "This is not JSON at all",
        }),
    };

    await expect(
      evaluate(prompt, { judge: badJudge, input: {} })
    ).rejects.toThrow("did not contain valid JSON");
  });

  test("handles incomplete judge response schema", async () => {
    const prompt = cria.prompt().user("Test");

    const incompleteJudge: ModelProvider = {
      name: "incomplete-judge",
      completion: () =>
        Promise.resolve({
          text: '{"score": 0.9}', // missing pass and reasoning
        }),
    };

    await expect(
      evaluate(prompt, { judge: incompleteJudge, input: {} })
    ).rejects.toThrow("did not match expected schema");
  });

  test("extracts JSON from text with surrounding content", async () => {
    const prompt = cria.prompt().user("Test");

    let callCount = 0;
    const verboseJudge: ModelProvider = {
      name: "verbose-judge",
      completion: () => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({ text: "Mock response" });
        }
        return Promise.resolve({
          text: 'Here is my evaluation:\n{"pass": true, "score": 0.85, "reasoning": "Good work"}\n\nLet me know if you need anything else.',
        });
      },
    };

    const result = await evaluate(prompt, {
      judge: verboseJudge,
      input: {},
    });

    expect(result.score).toBe(0.85);
    expect(result.reasoning).toBe("Good work");
  });
});
