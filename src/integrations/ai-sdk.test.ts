import { expect, test } from "vitest";
import { Message, Region, ToolCall, ToolResult } from "../components";
import { render } from "../render";
import { renderer } from "./ai-sdk";

const tokenizer = (text: string): number => Math.ceil(text.length / 4);

test("renderer: renders semantic IR to ModelMessage[] (tool call + tool result split)", async () => {
  const prompt = Region({
    priority: 0,
    children: [
      Message({
        messageRole: "user",
        children: ["hi"],
      }),
      Message({
        messageRole: "assistant",
        children: [
          "checking weather",
          ToolCall({
            toolCallId: "w1",
            toolName: "getWeather",
            input: { city: "Paris" },
          }),
          ToolResult({
            toolCallId: "w1",
            toolName: "getWeather",
            output: { type: "json", value: { tempC: 10 } },
          }),
        ],
      }),
    ],
  });

  const modelMessages = await render(prompt, {
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
