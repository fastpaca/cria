import type { ContentBlockParam } from "@anthropic-ai/sdk/resources/messages";
import { cria } from "@fastpaca/cria";
import type { ChatCompletionsInput } from "@fastpaca/cria/protocols/chat-completions";
import { ChatCompletionsProtocol } from "@fastpaca/cria/protocols/chat-completions";
import {
  ProtocolProvider,
  type ProviderRenderContext,
} from "@fastpaca/cria/provider";
import {
  AnthropicAdapter,
  type AnthropicRenderResult,
  type AnthropicToolIO,
} from "@fastpaca/cria/providers/anthropic";
import { render } from "@fastpaca/cria/render";
import type { PromptMessageNode } from "@fastpaca/cria/types";
import { expect, test } from "vitest";
import type { ZodType } from "zod";

class RenderOnlyProvider extends ProtocolProvider<
  AnthropicRenderResult,
  ChatCompletionsInput<AnthropicToolIO>,
  AnthropicToolIO
> {
  constructor() {
    super(
      new ChatCompletionsProtocol<AnthropicToolIO>(),
      new AnthropicAdapter()
    );
  }

  countTokens(_rendered: AnthropicRenderResult): number {
    return 0;
  }

  completion(
    _rendered: AnthropicRenderResult,
    _context?: ProviderRenderContext
  ): string {
    return "";
  }

  object<TOut>(
    _rendered: AnthropicRenderResult,
    _schema: ZodType<TOut>,
    _context?: ProviderRenderContext
  ): never {
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
  children: PromptMessageNode<AnthropicToolIO>["children"]
): PromptMessageNode<AnthropicToolIO> {
  return { kind: "message", role, children };
}

function hasCacheControl(
  block: ContentBlockParam
): block is ContentBlockParam & {
  cache_control: { type: "ephemeral"; ttl?: string };
} {
  return "cache_control" in block;
}

test("anthropic: extracts system message separately", async () => {
  const prompt = cria.scope([
    cria.system("You are a helpful assistant."),
    cria.user("Hello!"),
  ]);

  const result = await render(prompt, { provider });

  expect(result).toEqual({
    system: "You are a helpful assistant.",
    messages: [{ role: "user", content: [{ type: "text", text: "Hello!" }] }],
  });
});

test("anthropic: pins cache control on the pinned prefix", async () => {
  const pinnedSystem = cria
    .prompt()
    .system("Pinned rules")
    .pin({ id: "rules", version: "v1", ttlSeconds: 3600 });

  const prompt = cria.prompt().prefix(pinnedSystem).user("Hello!");
  const result = await prompt.render({ provider });

  expect(Array.isArray(result.system)).toBe(true);
  if (!Array.isArray(result.system)) {
    throw new Error("Expected system to be rendered as content blocks.");
  }

  const firstBlock = result.system[0];
  expect(firstBlock).toMatchObject({ type: "text", text: "Pinned rules" });
  if (!(firstBlock && hasCacheControl(firstBlock))) {
    throw new Error("Expected cache_control on the pinned system block.");
  }
  expect(firstBlock.cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
});

test("anthropic: renders user and assistant messages", async () => {
  const prompt = cria.scope([cria.user("Hello!"), cria.assistant("Hi there!")]);

  const result = await render(prompt, { provider });

  expect(result).toEqual({
    messages: [
      { role: "user", content: [{ type: "text", text: "Hello!" }] },
      { role: "assistant", content: [{ type: "text", text: "Hi there!" }] },
    ],
  });
});

test("anthropic: renders tool calls as tool_use blocks", async () => {
  const prompt = cria.scope([
    messageWithParts("assistant", [
      {
        type: "tool-call",
        input: { city: "Paris" },
        toolCallId: "call_123",
        toolName: "getWeather",
      },
    ]),
  ]);

  const result = await render(prompt, { provider });

  expect(result).toEqual({
    messages: [
      {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "call_123",
            name: "getWeather",
            input: { city: "Paris" },
          },
        ],
      },
    ],
  });
});

test("anthropic: renders tool results in user messages", async () => {
  const prompt = cria.scope([
    messageWithParts("assistant", [
      {
        type: "tool-call",
        input: { city: "Paris" },
        toolCallId: "call_123",
        toolName: "getWeather",
      },
    ]),
    messageWithParts("tool", [
      {
        type: "tool-result",
        output: '{"temperature":20}',
        toolCallId: "call_123",
        toolName: "getWeather",
      },
    ]),
  ]);

  const result = await render(prompt, { provider });

  expect(result).toEqual({
    messages: [
      {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "call_123",
            name: "getWeather",
            input: { city: "Paris" },
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "call_123",
            content: '{"temperature":20}',
          },
        ],
      },
    ],
  });
});

test("anthropic: full conversation with tool use", async () => {
  const prompt = cria.scope([
    cria.system("You are a weather assistant."),
    cria.user("What's the weather in Paris?"),
    messageWithParts("assistant", [
      { type: "text", text: "Let me check." },
      {
        type: "tool-call",
        input: { city: "Paris" },
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
    cria.assistant("The temperature in Paris is 18°C."),
  ]);

  const result = await render(prompt, { provider });

  expect(result).toEqual({
    system: "You are a weather assistant.",
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: "What's the weather in Paris?" }],
      },
      {
        role: "assistant",
        content: [
          { type: "text", text: "Let me check." },
          {
            type: "tool_use",
            id: "call_1",
            name: "getWeather",
            input: { city: "Paris" },
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "call_1",
            content: '{"temp":18}',
          },
        ],
      },
      {
        role: "assistant",
        content: [
          {
            type: "text",
            text: "The temperature in Paris is 18°C.",
          },
        ],
      },
    ],
  });
});

test("anthropic: includes reasoning as text with thinking tags", async () => {
  const prompt = cria.scope([
    messageWithParts("assistant", [
      { type: "reasoning", text: "Let me think about this..." },
      { type: "text", text: "The answer is 4." },
    ]),
  ]);

  const result = await render(prompt, { provider });

  expect(result).toEqual({
    messages: [
      {
        role: "assistant",
        content: [
          {
            type: "text",
            text: "The answer is 4.<thinking>\nLet me think about this...\n</thinking>",
          },
        ],
      },
    ],
  });
});

test("anthropic: round-trips rendered input", () => {
  const input: AnthropicRenderResult = {
    system: "You are a helpful assistant.",
    messages: [
      { role: "user", content: [{ type: "text", text: "Hello" }] },
      {
        role: "assistant",
        content: [
          { type: "text", text: "Checking weather." },
          {
            type: "tool_use",
            id: "call_1",
            name: "getWeather",
            input: { city: "Paris" },
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "call_1",
            content: '{"temp":18}',
          },
        ],
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "Paris is 18°C." }],
      },
    ],
  };

  const layout = provider.codec.parse(input);
  const output = provider.codec.render(layout);

  expect(output).toEqual(input);
});
