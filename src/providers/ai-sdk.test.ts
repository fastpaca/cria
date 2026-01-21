import { expect, test } from "vitest";
import { cria } from "../dsl";
import type { MessageCodec } from "../message-codec";
import { render } from "../render";
import type { PromptMessageNode } from "../types";
import { ModelProvider } from "../types";
import { AiSdkCodec, type AiSdkToolIO } from "./ai-sdk";

class RenderOnlyProvider<T> extends ModelProvider<T, AiSdkToolIO> {
  readonly codec: MessageCodec<T, AiSdkToolIO>;

  constructor(codec: MessageCodec<T, AiSdkToolIO>) {
    super();
    this.codec = codec;
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

const provider = new RenderOnlyProvider(new AiSdkCodec());

/**
 * Creates a message node with arbitrary PromptPart children.
 * Used for testing codec behavior with specific part types.
 */
function messageWithParts(
  role: "user" | "assistant" | "system" | "tool",
  children: PromptMessageNode<AiSdkToolIO>["children"]
): PromptMessageNode<AiSdkToolIO> {
  return { kind: "message", role, children };
}

test("codec: renders prompt layout to ModelMessage[] (tool call + tool result)", async () => {
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
