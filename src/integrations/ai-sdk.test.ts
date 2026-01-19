import { expect, test } from "vitest";
import { Message, Scope, ToolCall, ToolResult } from "../components";
import { render } from "../render";
import { ModelProvider, type PromptRenderer } from "../types";
import { AiSdkRenderer } from "./ai-sdk";

class RenderOnlyProvider<T> extends ModelProvider<T> {
  readonly renderer: PromptRenderer<T>;

  constructor(renderer: PromptRenderer<T>) {
    super();
    this.renderer = renderer;
  }

  countTokens(): number {
    return 0;
  }

  completion(): string {
    return "";
  }

  object(): never {
    throw new Error("Not implemented");
  }
}

const provider = new RenderOnlyProvider(new AiSdkRenderer());

const text = (value: string) => ({ type: "text", text: value }) as const;

test("renderer: renders prompt layout to ModelMessage[] (tool call + tool result)", async () => {
  const prompt = Scope({
    priority: 0,
    children: [
      Message({
        messageRole: "user",
        children: [text("hi")],
      }),
      Message({
        messageRole: "assistant",
        children: [
          text("checking weather"),
          ToolCall({
            toolCallId: "w1",
            toolName: "getWeather",
            input: { city: "Paris" },
          }),
        ],
      }),
      Message({
        messageRole: "tool",
        children: [
          ToolResult({
            toolCallId: "w1",
            toolName: "getWeather",
            output: { type: "json", value: { tempC: 10 } },
          }),
        ],
      }),
    ],
  });

  const modelMessages = await render(prompt, { provider });

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
