import { cria } from "@fastpaca/cria/dsl";
import type { ChatCompletionsInput } from "@fastpaca/cria/protocols/chat-completions";
import { ChatCompletionsProtocol } from "@fastpaca/cria/protocols/chat-completions";
import type { ResponsesInput } from "@fastpaca/cria/protocols/responses";
import { ResponsesProtocol } from "@fastpaca/cria/protocols/responses";
import { ProtocolProvider } from "@fastpaca/cria/provider";
import {
  OpenAIChatAdapter,
  type OpenAIResponses,
  OpenAIResponsesAdapter,
  type OpenAiToolIO,
} from "@fastpaca/cria/providers/openai";
import { render } from "@fastpaca/cria/render";
import type { PromptMessageNode } from "@fastpaca/cria/types";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { expect, test } from "vitest";

class RenderOnlyChatProvider extends ProtocolProvider<
  ChatCompletionMessageParam[],
  ChatCompletionsInput<OpenAiToolIO>,
  OpenAiToolIO
> {
  constructor() {
    super(new ChatCompletionsProtocol<OpenAiToolIO>(), new OpenAIChatAdapter());
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

class RenderOnlyResponsesProvider extends ProtocolProvider<
  OpenAIResponses,
  ResponsesInput,
  OpenAiToolIO
> {
  constructor() {
    super(new ResponsesProtocol(), new OpenAIResponsesAdapter());
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

const chatProvider = new RenderOnlyChatProvider();

const responsesProvider = new RenderOnlyResponsesProvider();

/**
 * Creates a message node with arbitrary PromptPart children.
 * Used for testing codec behavior with specific part types.
 */
function messageWithParts(
  role: "user" | "assistant" | "system" | "tool",
  children: PromptMessageNode<OpenAiToolIO>["children"]
): PromptMessageNode<OpenAiToolIO> {
  return { kind: "message", role, children };
}

test("chatCompletions: renders system message", async () => {
  const prompt = cria.scope([cria.system("You are a helpful assistant.")]);

  const messages = await render(prompt, {
    provider: chatProvider,
  });

  expect(messages).toHaveLength(1);
  expect(messages[0]).toEqual({
    role: "system",
    content: "You are a helpful assistant.",
  });
});

test("chatCompletions: renders user and assistant messages", async () => {
  const prompt = cria.scope([
    cria.user("Hello!"),
    cria.assistant("Hi there! How can I help?"),
  ]);

  const messages = await render(prompt, {
    provider: chatProvider,
  });

  expect(messages).toHaveLength(2);
  expect(messages[0]).toEqual({ role: "user", content: "Hello!" });
  expect(messages[1]).toEqual({
    role: "assistant",
    content: "Hi there! How can I help?",
  });
});

test("chatCompletions: renders tool calls on assistant message", async () => {
  const prompt = cria.scope([
    messageWithParts("assistant", [
      { type: "text", text: "Let me check the weather." },
      {
        type: "tool-call",
        input: '{"city":"Paris"}',
        toolCallId: "call_123",
        toolName: "getWeather",
      },
    ]),
  ]);

  const messages = await render(prompt, {
    provider: chatProvider,
  });

  expect(messages).toHaveLength(1);
  expect(messages[0]).toEqual({
    role: "assistant",
    content: "Let me check the weather.",
    tool_calls: [
      {
        id: "call_123",
        type: "function",
        function: {
          name: "getWeather",
          arguments: '{"city":"Paris"}',
        },
      },
    ],
  });
});

test("chatCompletions: renders tool results as separate tool messages", async () => {
  const prompt = cria.scope([
    messageWithParts("assistant", [
      {
        type: "tool-call",
        input: '{"city":"Paris"}',
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

  const messages = await render(prompt, {
    provider: chatProvider,
  });

  expect(messages).toHaveLength(2);
  expect(messages[0]).toEqual({
    role: "assistant",
    tool_calls: [
      {
        id: "call_123",
        type: "function",
        function: {
          name: "getWeather",
          arguments: '{"city":"Paris"}',
        },
      },
    ],
  });
  expect(messages[1]).toEqual({
    role: "tool",
    tool_call_id: "call_123",
    content: '{"temperature":20}',
  });
});

test("chatCompletions: full conversation flow", async () => {
  const prompt = cria.scope([
    cria.system("You are a weather assistant."),
    cria.user("What's the weather in Paris?"),
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
        output: '{"temp":18,"condition":"sunny"}',
        toolCallId: "call_1",
        toolName: "getWeather",
      },
    ]),
    cria.assistant("The weather in Paris is sunny with a temperature of 18°C."),
  ]);

  const messages = await render(prompt, {
    provider: chatProvider,
  });

  expect(messages).toEqual([
    {
      role: "system",
      content: "You are a weather assistant.",
    },
    {
      role: "user",
      content: "What's the weather in Paris?",
    },
    {
      role: "assistant",
      tool_calls: [
        {
          id: "call_1",
          type: "function",
          function: {
            name: "getWeather",
            arguments: '{"city":"Paris"}',
          },
        },
      ],
    },
    {
      role: "tool",
      tool_call_id: "call_1",
      content: '{"temp":18,"condition":"sunny"}',
    },
    {
      role: "assistant",
      content: "The weather in Paris is sunny with a temperature of 18°C.",
    },
  ]);
});

test("responses: renders messages as message items", async () => {
  const prompt = cria.scope([
    cria.system("You are a helpful assistant."),
    cria.user("Hello!"),
  ]);

  const input = await render(prompt, {
    provider: responsesProvider,
  });

  expect(input).toEqual([
    {
      type: "message",
      role: "system",
      content: "You are a helpful assistant.",
    },
    { type: "message", role: "user", content: "Hello!" },
  ]);
});

test("responses: renders tool calls as function_call items", async () => {
  const prompt = cria.scope([
    messageWithParts("assistant", [
      {
        type: "tool-call",
        input: '{"city":"Paris"}',
        toolCallId: "call_123",
        toolName: "getWeather",
      },
    ]),
  ]);

  const input = await render(prompt, {
    provider: responsesProvider,
  });

  expect(input).toEqual([
    {
      type: "function_call",
      call_id: "call_123",
      name: "getWeather",
      arguments: '{"city":"Paris"}',
    },
  ]);
});

test("responses: renders tool results as function_call_output items", async () => {
  const prompt = cria.scope([
    messageWithParts("tool", [
      {
        type: "tool-result",
        output: '{"temperature":20}',
        toolCallId: "call_123",
        toolName: "getWeather",
      },
    ]),
  ]);

  const input = await render(prompt, {
    provider: responsesProvider,
  });

  expect(input).toEqual([
    {
      type: "function_call_output",
      call_id: "call_123",
      output: '{"temperature":20}',
    },
  ]);
});

test("responses: renders reasoning as native reasoning item", async () => {
  const prompt = cria.scope([
    messageWithParts("assistant", [
      { type: "reasoning", text: "Let me think about this..." },
    ]),
  ]);

  const input = await render(prompt, {
    provider: responsesProvider,
  });

  expect(input).toEqual([
    {
      id: "reasoning_0",
      type: "reasoning",
      summary: [{ type: "summary_text", text: "Let me think about this..." }],
    },
  ]);
});

test("responses: emits text before reasoning and tool calls", async () => {
  const prompt = cria.scope([
    messageWithParts("assistant", [
      { type: "text", text: "Before" },
      { type: "reasoning", text: "thinking..." },
      {
        type: "tool-call",
        input: '{"city":"Paris"}',
        toolCallId: "call_123",
        toolName: "getWeather",
      },
      { type: "text", text: "After" },
    ]),
  ]);

  const input = await render(prompt, {
    provider: responsesProvider,
  });

  expect(input).toEqual([
    { type: "message", role: "assistant", content: "BeforeAfter" },
    {
      id: "reasoning_0",
      type: "reasoning",
      summary: [{ type: "summary_text", text: "thinking..." }],
    },
    {
      type: "function_call",
      call_id: "call_123",
      name: "getWeather",
      arguments: '{"city":"Paris"}',
    },
  ]);
});

test("responses: full conversation with reasoning", async () => {
  const prompt = cria.scope([
    cria.system("You are a helpful assistant."),
    cria.user("What is 2+2?"),
    messageWithParts("assistant", [
      { type: "reasoning", text: "This is basic arithmetic." },
    ]),
    cria.assistant("The answer is 4."),
  ]);

  const input = await render(prompt, {
    provider: responsesProvider,
  });

  expect(input).toEqual([
    {
      type: "message",
      role: "system",
      content: "You are a helpful assistant.",
    },
    { type: "message", role: "user", content: "What is 2+2?" },
    {
      id: "reasoning_0",
      type: "reasoning",
      summary: [{ type: "summary_text", text: "This is basic arithmetic." }],
    },
    { type: "message", role: "assistant", content: "The answer is 4." },
  ]);
});

test("chatCompletions: round-trips messages", () => {
  const input: ChatCompletionMessageParam[] = [
    { role: "system", content: "You are a helpful assistant." },
    { role: "user", content: "Hello!" },
    {
      role: "assistant",
      content: "Let me check.",
      tool_calls: [
        {
          id: "call_1",
          type: "function",
          function: {
            name: "getWeather",
            arguments: '{"city":"Paris"}',
          },
        },
      ],
    },
    {
      role: "tool",
      tool_call_id: "call_1",
      content: '{"temp":18}',
    },
  ];

  const layout = chatProvider.codec.parse(input);
  const output = chatProvider.codec.render(layout);

  expect(output).toEqual(input);
});

test("responses: round-trips items", () => {
  const input: OpenAIResponses = [
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

  const layout = responsesProvider.codec.parse(input);
  const output = responsesProvider.codec.render(layout);

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
