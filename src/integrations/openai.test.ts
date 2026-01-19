import { expect, test } from "vitest";
import { render } from "../render";
import type {
  PromptMessageNode,
  PromptPart,
  PromptRenderer,
  PromptScope,
} from "../types";
import { ModelProvider } from "../types";
import { OpenAIChatRenderer, OpenAIResponsesRenderer } from "./openai";

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

const chatProvider = new RenderOnlyProvider(new OpenAIChatRenderer());

const responsesProvider = new RenderOnlyProvider(new OpenAIResponsesRenderer());

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

test("chatCompletions: renders system message", async () => {
  const prompt = rootScope(
    message("system", [text("You are a helpful assistant.")])
  );

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
  const prompt = rootScope(
    message("user", [text("Hello!")]),
    message("assistant", [text("Hi there! How can I help?")])
  );

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
  const prompt = rootScope(
    message("assistant", [
      text("Let me check the weather."),
      {
        type: "tool-call",
        input: { city: "Paris" },
        toolCallId: "call_123",
        toolName: "getWeather",
      },
    ])
  );

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
  const prompt = rootScope(
    message("assistant", [
      {
        type: "tool-call",
        input: { city: "Paris" },
        toolCallId: "call_123",
        toolName: "getWeather",
      },
    ]),
    message("tool", [
      {
        type: "tool-result",
        output: { temperature: 20 },
        toolCallId: "call_123",
        toolName: "getWeather",
      },
    ])
  );

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
  const prompt = rootScope(
    message("system", [text("You are a weather assistant.")]),
    message("user", [text("What's the weather in Paris?")]),
    message("assistant", [
      {
        type: "tool-call",
        input: { city: "Paris" },
        toolCallId: "call_1",
        toolName: "getWeather",
      },
    ]),
    message("tool", [
      {
        type: "tool-result",
        output: { temp: 18, condition: "sunny" },
        toolCallId: "call_1",
        toolName: "getWeather",
      },
    ]),
    message("assistant", [
      text("The weather in Paris is sunny with a temperature of 18°C."),
    ])
  );

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

test("responses: renders messages as EasyInputMessage", async () => {
  const prompt = rootScope(
    message("system", [text("You are a helpful assistant.")]),
    message("user", [text("Hello!")])
  );

  const input = await render(prompt, {
    provider: responsesProvider,
  });

  expect(input).toEqual([
    { role: "system", content: "You are a helpful assistant." },
    { role: "user", content: "Hello!" },
  ]);
});

test("responses: renders tool calls as function_call items", async () => {
  const prompt = rootScope(
    message("assistant", [
      {
        type: "tool-call",
        input: { city: "Paris" },
        toolCallId: "call_123",
        toolName: "getWeather",
      },
    ])
  );

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
  const prompt = rootScope(
    message("tool", [
      {
        type: "tool-result",
        output: { temperature: 20 },
        toolCallId: "call_123",
        toolName: "getWeather",
      },
    ])
  );

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
  const prompt = rootScope(
    message("assistant", [
      { type: "reasoning", text: "Let me think about this..." },
    ])
  );

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
  const prompt = rootScope(
    message("assistant", [
      text("Before"),
      { type: "reasoning", text: "thinking..." },
      {
        type: "tool-call",
        input: { city: "Paris" },
        toolCallId: "call_123",
        toolName: "getWeather",
      },
      text("After"),
    ])
  );

  const input = await render(prompt, {
    provider: responsesProvider,
  });

  expect(input).toEqual([
    { role: "assistant", content: "BeforeAfter" },
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
  const prompt = rootScope(
    message("system", [text("You are a helpful assistant.")]),
    message("user", [text("What is 2+2?")]),
    message("assistant", [
      { type: "reasoning", text: "This is basic arithmetic." },
    ]),
    message("assistant", [text("The answer is 4.")])
  );

  const input = await render(prompt, {
    provider: responsesProvider,
  });

  expect(input).toEqual([
    { role: "system", content: "You are a helpful assistant." },
    { role: "user", content: "What is 2+2?" },
    {
      id: "reasoning_0",
      type: "reasoning",
      summary: [{ type: "summary_text", text: "This is basic arithmetic." }],
    },
    { role: "assistant", content: "The answer is 4." },
  ]);
});
