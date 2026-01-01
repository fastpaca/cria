import assert from "node:assert/strict";
import { test } from "node:test";
import type { UIMessage } from "ai";
import { AiSdkMessages, aiSdkRenderer } from "./ai-sdk";
import { render } from "./render";

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

  assert.ok(prompt.includes("### user"));
  assert.ok(prompt.includes("hi"));
  assert.ok(prompt.includes("### assistant"));
  assert.ok(prompt.includes("checking weather"));
  assert.ok(prompt.includes("#### Tool Call"));
  assert.ok(prompt.includes("`getWeather`"));
  assert.ok(prompt.includes("```json"));
  assert.ok(prompt.includes('"city": "Paris"'));
  assert.ok(prompt.includes("#### Tool Result"));
  assert.ok(prompt.includes('"tempC": 10'));
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
  assert.ok(!withoutReasoning.includes("secret reasoning"));
  assert.ok(withoutReasoning.includes("public answer"));

  const withReasoning = await render(
    <AiSdkMessages includeReasoning messages={messages} />,
    { tokenizer, budget: 10_000 }
  );
  assert.ok(withReasoning.includes("#### Reasoning"));
  assert.ok(withReasoning.includes("secret reasoning"));
  assert.ok(withReasoning.includes("public answer"));
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

  assert.strictEqual(modelMessages.length, 3);
  assert.strictEqual(modelMessages[0]?.role, "user");
  assert.strictEqual(modelMessages[1]?.role, "assistant");
  assert.strictEqual(modelMessages[2]?.role, "tool");
});
