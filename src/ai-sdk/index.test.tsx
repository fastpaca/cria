import type { UIMessage } from "ai";
import { expect, test } from "vitest";
import { render } from "../render";
import { AiSdkMessages, aiSdkRenderer } from "./index";

const tokenizer = (text: string): number => Math.ceil(text.length / 4);

test("AiSdkMessages: renders text + dynamic-tool output as tool-call/tool-result", async () => {
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

  const prompt = await render(<AiSdkMessages messages={messages} />, {
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

test("AiSdkMessages: includeReasoning controls reasoning rendering", async () => {
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

  const withoutReasoning = await render(<AiSdkMessages messages={messages} />, {
    tokenizer,
    budget: 10_000,
  });
  expect(withoutReasoning).not.toContain("secret reasoning");
  expect(withoutReasoning).toContain("public answer");

  const withReasoning = await render(
    <AiSdkMessages includeReasoning messages={messages} />,
    { tokenizer, budget: 10_000 }
  );
  expect(withReasoning).toContain("<thinking>");
  expect(withReasoning).toContain("secret reasoning");
  expect(withReasoning).toContain("public answer");
});

test("aiSdkRenderer: renders semantic IR to ModelMessage[] (tool call + tool result split)", async () => {
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

  const modelMessages = await render(<AiSdkMessages messages={messages} />, {
    tokenizer,
    budget: 10_000,
    renderer: aiSdkRenderer,
  });

  expect(modelMessages).toHaveLength(3);
  expect(modelMessages[0]?.role).toBe("user");
  expect(modelMessages[1]?.role).toBe("assistant");
  expect(modelMessages[2]?.role).toBe("tool");
});
