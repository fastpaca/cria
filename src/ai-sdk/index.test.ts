import type { UIMessage } from "ai";
import { generateText } from "ai";
import { afterEach, describe, expect, test, vi } from "vitest";
import { render } from "../render";
import { Evaluator, Messages, renderer } from "./index";

vi.mock("ai", async () => {
  const actual = await vi.importActual<typeof import("ai")>("ai");
  return {
    ...actual,
    generateText: vi.fn(),
  };
});

const tokenizer = (text: string): number => Math.ceil(text.length / 4);
const mockedGenerateText = vi.mocked(generateText);

afterEach(() => {
  mockedGenerateText.mockReset();
});

test("Messages: renders text + dynamic-tool output as tool-call/tool-result", async () => {
  const messages: readonly UIMessage[] = [
    { id: "u1", role: "user", parts: [{ type: "text", text: "hi" }] },
    {
      id: "a1",
      role: "assistant",
      parts: [
        { type: "text", text: "checking weather" },
        {
          type: "dynamic-tool",
          toolName: "getWeather",
          toolCallId: "w1",
          state: "output-available",
          input: { city: "Paris" },
          output: { type: "json", value: { tempC: 10 } },
        },
      ],
    },
  ];

  const prompt = await render(Messages({ messages }), {
    tokenizer,
    budget: 10_000,
  });

  const expected = [
    "User: hi",
    "",
    'Assistant: checking weather<tool_call name="getWeather">',
    "{",
    '  "city": "Paris"',
    "}",
    "</tool_call>",
    '<tool_result name="getWeather">',
    "{",
    '  "type": "json",',
    '  "value": {',
    '    "tempC": 10',
    "  }",
    "}",
    "</tool_result>",
    "",
    "",
  ].join("\n");

  expect(prompt).toBe(expected);
});

test("Messages: includeReasoning controls reasoning rendering", async () => {
  const messages: readonly UIMessage[] = [
    {
      id: "a1",
      role: "assistant",
      parts: [
        { type: "reasoning", text: "secret reasoning" },
        { type: "text", text: "public answer" },
      ],
    },
  ];

  const withoutReasoning = await render(Messages({ messages }), {
    tokenizer,
    budget: 10_000,
  });
  expect(withoutReasoning).toBe("Assistant: public answer\n\n");

  const withReasoning = await render(
    Messages({ includeReasoning: true, messages }),
    { tokenizer, budget: 10_000 }
  );
  expect(withReasoning).toBe(
    "Assistant: <thinking>\nsecret reasoning\n</thinking>\npublic answer\n\n"
  );
});

test("renderer: renders semantic IR to ModelMessage[] (tool call + tool result split)", async () => {
  const messages: readonly UIMessage[] = [
    { id: "u1", role: "user", parts: [{ type: "text", text: "hi" }] },
    {
      id: "a1",
      role: "assistant",
      parts: [
        { type: "text", text: "checking weather" },
        {
          type: "dynamic-tool",
          toolName: "getWeather",
          toolCallId: "w1",
          state: "output-available",
          input: { city: "Paris" },
          output: { type: "json", value: { tempC: 10 } },
        },
      ],
    },
  ];

  const modelMessages = await render(Messages({ messages }), {
    tokenizer,
    budget: 10_000,
    renderer,
  });

  expect(modelMessages).toEqual([
    { role: "user", content: "hi" },
    {
      role: "assistant",
      content: [
        { type: "text", text: "checking weather" },
        {
          type: "tool-call",
          toolCallId: "w1",
          toolName: "getWeather",
          input: { city: "Paris" },
        },
      ],
    },
    {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "w1",
          toolName: "getWeather",
          output: { type: "json", value: { tempC: 10 } },
        },
      ],
    },
  ]);
});

describe("Evaluator", () => {
  test("uses default name and tokenizer fallback", () => {
    const evaluator = new Evaluator("mock-model");

    expect(evaluator.name).toBe("ai-sdk-evaluator");
    expect(typeof evaluator.tokenizer).toBe("function");
  });

  test("uses custom name and tokenizer", () => {
    const customTokenizer = (text: string): number => text.length;
    const evaluator = new Evaluator("mock-model", {
      name: "custom",
      tokenizer: customTokenizer,
    });

    expect(evaluator.name).toBe("custom");
    expect(evaluator.tokenizer).toBe(customTokenizer);
  });

  test("evaluate returns structured output", async () => {
    const output = { score: 0.72, reasoning: "Solid" };
    mockedGenerateText.mockResolvedValue({ output });

    const evaluator = new Evaluator("mock-model");
    const result = await evaluator.evaluate({
      messages: [{ role: "user", content: "Judge this" }],
      input: {},
      response: "ok",
    });

    expect(result).toEqual(output);
    expect(mockedGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [{ role: "user", content: "Judge this" }],
      })
    );
  });
});
