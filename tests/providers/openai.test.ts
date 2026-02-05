import { cria } from "@fastpaca/cria";
import type { ChatCompletionsInput } from "@fastpaca/cria/protocols/chat-completions";
import { ChatCompletionsProtocol } from "@fastpaca/cria/protocols/chat-completions";
import type { ResponsesInput } from "@fastpaca/cria/protocols/responses";
import { ResponsesProtocol } from "@fastpaca/cria/protocols/responses";
import {
  ProtocolProvider,
  type ProviderRenderContext,
} from "@fastpaca/cria/provider";
import {
  OpenAIChatAdapter,
  OpenAIChatProvider,
  type OpenAIChatRenderOutput,
  type OpenAIResponses,
  OpenAIResponsesAdapter,
  type OpenAIResponsesRenderOutput,
  type OpenAiToolIO,
} from "@fastpaca/cria/providers/openai";
import { render } from "@fastpaca/cria/render";
import type { PromptMessageNode } from "@fastpaca/cria/types";
import OpenAI from "openai";
import type {
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionMessageParam,
} from "openai/resources/chat/completions";
import { expect, test } from "vitest";
import type { ZodType } from "zod";

const MODEL = "gpt-4o-mini";

class RenderOnlyChatProvider extends ProtocolProvider<
  OpenAIChatRenderOutput,
  ChatCompletionsInput<OpenAiToolIO>,
  OpenAiToolIO
> {
  constructor() {
    super(
      new ChatCompletionsProtocol<OpenAiToolIO>(),
      new OpenAIChatAdapter(MODEL)
    );
  }

  countTokens(_rendered: OpenAIChatRenderOutput): number {
    return 0;
  }

  completion(
    _rendered: OpenAIChatRenderOutput,
    _context?: ProviderRenderContext
  ): string {
    return "";
  }

  object<TOut>(
    _rendered: OpenAIChatRenderOutput,
    _schema: ZodType<TOut>,
    _context?: ProviderRenderContext
  ): never {
    throw new Error("Not implemented");
  }
}

class RenderOnlyResponsesProvider extends ProtocolProvider<
  OpenAIResponsesRenderOutput,
  ResponsesInput,
  OpenAiToolIO
> {
  constructor() {
    super(new ResponsesProtocol(), new OpenAIResponsesAdapter(MODEL));
  }

  countTokens(_rendered: OpenAIResponsesRenderOutput): number {
    return 0;
  }

  completion(
    _rendered: OpenAIResponsesRenderOutput,
    _context?: ProviderRenderContext
  ): string {
    return "";
  }

  object<TOut>(
    _rendered: OpenAIResponsesRenderOutput,
    _schema: ZodType<TOut>,
    _context?: ProviderRenderContext
  ): never {
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

  const output = await render(prompt, {
    provider: chatProvider,
  });

  expect(output.messages).toHaveLength(1);
  expect(output.messages[0]).toEqual({
    role: "system",
    content: "You are a helpful assistant.",
  });
});

test("chatCompletions: renders user and assistant messages", async () => {
  const prompt = cria.scope([
    cria.user("Hello!"),
    cria.assistant("Hi there! How can I help?"),
  ]);

  const output = await render(prompt, {
    provider: chatProvider,
  });

  expect(output.messages).toHaveLength(2);
  expect(output.messages[0]).toEqual({ role: "user", content: "Hello!" });
  expect(output.messages[1]).toEqual({
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

  const output = await render(prompt, {
    provider: chatProvider,
  });

  expect(output.messages).toHaveLength(1);
  expect(output.messages[0]).toEqual({
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

  const output = await render(prompt, {
    provider: chatProvider,
  });

  expect(output.messages).toHaveLength(2);
  expect(output.messages[0]).toEqual({
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
  expect(output.messages[1]).toEqual({
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

  const output = await render(prompt, {
    provider: chatProvider,
  });

  expect(output.messages).toEqual([
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

  const output = await render(prompt, {
    provider: responsesProvider,
  });

  expect(output.input).toEqual([
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

  const output = await render(prompt, {
    provider: responsesProvider,
  });

  expect(output.input).toEqual([
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

  const output = await render(prompt, {
    provider: responsesProvider,
  });

  expect(output.input).toEqual([
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

  const output = await render(prompt, {
    provider: responsesProvider,
  });

  expect(output.input).toEqual([
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

  const output = await render(prompt, {
    provider: responsesProvider,
  });

  expect(output.input).toEqual([
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

  const output = await render(prompt, {
    provider: responsesProvider,
  });

  expect(output.input).toEqual([
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

  const layout = chatProvider.codec.parse({ messages: input });
  const output = chatProvider.codec.render(layout);

  expect(output.messages).toEqual(input);
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

  const layout = responsesProvider.codec.parse({ input });
  const output = responsesProvider.codec.render(layout);

  expect(output.input).toEqual([
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

test("openai: derives prompt_cache_key from pinned prefix", async () => {
  let capturedRequest: ChatCompletionCreateParamsNonStreaming | undefined;
  const isChatRequest = (
    value: unknown
  ): value is ChatCompletionCreateParamsNonStreaming =>
    typeof value === "object" &&
    value !== null &&
    "model" in value &&
    "messages" in value;
  const fetch: typeof globalThis.fetch = (_input, init) => {
    if (!init?.body || typeof init.body !== "string") {
      throw new Error("Expected OpenAI request body to be a JSON string.");
    }
    const parsed = JSON.parse(init.body);
    if (!isChatRequest(parsed)) {
      throw new Error("Expected OpenAI request body to be a chat request.");
    }
    capturedRequest = parsed;
    const responseBody = {
      id: "chatcmpl_test",
      object: "chat.completion",
      created: 0,
      model: MODEL,
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "ok" },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    };
    return Promise.resolve(
      new Response(JSON.stringify(responseBody), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
  };
  const client = new OpenAI({
    apiKey: "test",
    baseURL: "http://localhost",
    fetch,
  });
  const provider = new OpenAIChatProvider(client, MODEL);

  const pinnedSystem = cria.prompt().system("Stable rules").pin({
    id: "rules",
    version: "v1",
    scopeKey: "tenant:acme",
    ttlSeconds: 123,
  });

  const output = await cria
    .prompt(provider)
    .prefix(pinnedSystem)
    .user("Hi")
    .render();

  await provider.completion(output);
  expect(output.cache_id).toBe(`cria:${MODEL}:tenant:acme:ttl:123:rules:v1`);

  if (!capturedRequest) {
    throw new Error("Expected OpenAI request to be captured.");
  }

  expect(capturedRequest.prompt_cache_key).toBeUndefined();
});
