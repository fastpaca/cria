import { expect, test } from "vitest";
import { render } from "../render";
import type {
  PromptMessageNode,
  PromptPart,
  PromptRenderer,
  PromptScope,
} from "../types";
import { ModelProvider } from "../types";
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

const text = (value: string): PromptPart => ({ type: "text", text: value });

function rootScope(
  ...children: (PromptMessageNode | PromptScope)[]
): PromptScope {
  return {
    kind: "scope",
    priority: 0,
    children,
  };
}

function message(
  role: "user" | "assistant" | "system" | "tool",
  children: PromptPart[]
): PromptMessageNode {
  return {
    kind: "message",
    role,
    children,
  };
}

test("renderer: renders prompt layout to ModelMessage[] (tool call + tool result)", async () => {
  const prompt = rootScope(
    message("user", [text("hi")]),
    message("assistant", [
      text("checking weather"),
      {
        type: "tool-call",
        toolCallId: "w1",
        toolName: "getWeather",
        input: { city: "Paris" },
      },
    ]),
    message("tool", [
      {
        type: "tool-result",
        toolCallId: "w1",
        toolName: "getWeather",
        output: { type: "json", value: { tempC: 10 } },
      },
    ])
  );

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
