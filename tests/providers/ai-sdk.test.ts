import { cria } from "@fastpaca/cria/dsl";
import type { ChatCompletionsInput } from "@fastpaca/cria/protocols/chat-completions";
import { ChatCompletionsProtocol } from "@fastpaca/cria/protocols/chat-completions";
import { ProtocolProvider } from "@fastpaca/cria/provider";
import {
  AiSdkAdapter,
  type AiSdkToolIO,
} from "@fastpaca/cria/providers/ai-sdk";
import { render } from "@fastpaca/cria/render";
import type { PromptMessage, PromptMessageNode } from "@fastpaca/cria/types";
import type { ModelMessage } from "ai";
import { expect, test } from "vitest";

class RenderOnlyProvider extends ProtocolProvider<
  ModelMessage[],
  ChatCompletionsInput<AiSdkToolIO>,
  AiSdkToolIO
> {
  constructor() {
    super(new ChatCompletionsProtocol<AiSdkToolIO>(), new AiSdkAdapter());
  }

  countMessageTokens(_message: PromptMessage<AiSdkToolIO>): number {
    return 0;
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

const provider = new RenderOnlyProvider();

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

test("ai-sdk: round-trips model messages", () => {
  const input: ModelMessage[] = [
    { role: "system", content: "System" },
    { role: "user", content: "Hello" },
    {
      role: "assistant",
      content: [
        { type: "text", text: "Checking weather." },
        { type: "reasoning", text: "Need to call a tool." },
        {
          type: "tool-call",
          toolCallId: "call_1",
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
          toolCallId: "call_1",
          toolName: "getWeather",
          output: { tempC: 18 },
        },
      ],
    },
  ];

  const layout = provider.codec.parse(input);
  const output = provider.codec.render(layout);

  expect(output).toEqual(input);
});
