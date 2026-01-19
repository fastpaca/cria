import { expect, test } from "vitest";
import { cria } from "../dsl";
import { render } from "../render";
import type { PromptMessageNode, PromptRenderer } from "../types";
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

/**
 * Creates a message node with arbitrary PromptPart children.
 * Used for testing renderer behavior with specific part types.
 */
function messageWithParts(
  role: "user" | "assistant" | "system" | "tool",
  children: PromptMessageNode["children"]
): PromptMessageNode {
  return { kind: "message", role, children };
}

test("renderer: renders prompt layout to ModelMessage[] (tool call + tool result)", async () => {
  const prompt = cria.scope([
    cria.user("hi"),
    messageWithParts("assistant", [
      { type: "text", text: "checking weather" },
      {
        type: "tool-call",
        toolCallId: "w1",
        toolName: "getWeather",
        input: { city: "Paris" },
      },
    ]),
    messageWithParts("tool", [
      {
        type: "tool-result",
        toolCallId: "w1",
        toolName: "getWeather",
        output: { type: "json", value: { tempC: 10 } },
      },
    ]),
  ]);

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
