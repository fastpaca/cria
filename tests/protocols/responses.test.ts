import { cria } from "@fastpaca/cria/dsl";
import {
  ResponsesProtocol,
  type ResponsesToolIO,
} from "@fastpaca/cria/protocols/responses";
import { type MessageCodec, ModelProvider } from "@fastpaca/cria/provider";
import { render } from "@fastpaca/cria/render";
import type { PromptMessage, PromptMessageNode } from "@fastpaca/cria/types";
import { expect, test } from "vitest";

class RenderOnlyProvider<T> extends ModelProvider<T, ResponsesToolIO> {
  readonly codec: MessageCodec<T, ResponsesToolIO>;

  constructor(codec: MessageCodec<T, ResponsesToolIO>) {
    super();
    this.codec = codec;
  }

  countMessageTokens(_message: PromptMessage<ResponsesToolIO>): number {
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

const protocolProvider = new RenderOnlyProvider(new ResponsesProtocol());

function messageWithParts(
  role: "user" | "assistant" | "system" | "developer" | "tool",
  children: PromptMessageNode<ResponsesToolIO>["children"]
): PromptMessageNode<ResponsesToolIO> {
  return { kind: "message", role, children };
}

test("responses: renders message items", async () => {
  const prompt = cria.scope([
    cria.system("System"),
    cria.developer("Developer"),
    cria.user("Hello"),
  ]);

  const input = await render(prompt, { provider: protocolProvider });

  expect(input).toEqual([
    { type: "message", role: "system", content: "System" },
    { type: "message", role: "developer", content: "Developer" },
    { type: "message", role: "user", content: "Hello" },
  ]);
});

test("responses: renders tool calls and tool outputs", async () => {
  const prompt = cria.scope([
    messageWithParts("assistant", [
      {
        type: "tool-call",
        input: '{"city":"Paris"}',
        toolCallId: "call_1",
        toolName: "getWeather",
      },
    ]),
    messageWithParts("tool", [
      {
        type: "tool-result",
        output: '{"temp":18}',
        toolCallId: "call_1",
        toolName: "getWeather",
      },
    ]),
  ]);

  const input = await render(prompt, { provider: protocolProvider });

  expect(input).toEqual([
    {
      type: "function_call",
      call_id: "call_1",
      name: "getWeather",
      arguments: '{"city":"Paris"}',
    },
    {
      type: "function_call_output",
      call_id: "call_1",
      output: '{"temp":18}',
    },
  ]);
});

test("responses: renders reasoning as reasoning item", async () => {
  const prompt = cria.scope([
    messageWithParts("assistant", [
      { type: "reasoning", text: "Let me think." },
    ]),
  ]);

  const input = await render(prompt, { provider: protocolProvider });

  expect(input).toEqual([
    {
      id: "reasoning_0",
      type: "reasoning",
      summary: [{ type: "summary_text", text: "Let me think." }],
    },
  ]);
});

test("responses: round-trips items", () => {
  const input = [
    { type: "message", role: "user", content: "Hello" },
    { type: "message", role: "assistant", content: "Let me check." },
    {
      type: "reasoning",
      summary: [{ type: "summary_text", text: "Thinking." }],
      id: "reasoning_custom",
    },
    {
      type: "function_call",
      call_id: "call_1",
      name: "getWeather",
      arguments: '{"city":"Paris"}',
    },
    {
      type: "function_call_output",
      call_id: "call_1",
      output: '{"temp":18}',
    },
  ];

  const layout = protocolProvider.codec.parse(input);
  const output = protocolProvider.codec.render(layout);

  expect(output).toEqual([
    { type: "message", role: "user", content: "Hello" },
    { type: "message", role: "assistant", content: "Let me check." },
    {
      type: "reasoning",
      summary: [{ type: "summary_text", text: "Thinking." }],
      id: "reasoning_0",
    },
    {
      type: "function_call",
      call_id: "call_1",
      name: "getWeather",
      arguments: '{"city":"Paris"}',
    },
    {
      type: "function_call_output",
      call_id: "call_1",
      output: '{"temp":18}',
    },
  ]);
});
