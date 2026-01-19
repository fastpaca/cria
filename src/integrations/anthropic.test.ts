import { expect, test } from "vitest";
import { render } from "../render";
import type {
  PromptMessageNode,
  PromptPart,
  PromptRenderer,
  PromptScope,
} from "../types";
import { ModelProvider } from "../types";
import { AnthropicRenderer } from "./anthropic";

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

const provider = new RenderOnlyProvider(new AnthropicRenderer());

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

test("anthropic: extracts system message separately", async () => {
  const prompt = rootScope(
    message("system", [text("You are a helpful assistant.")]),
    message("user", [text("Hello!")])
  );

  const result = await render(prompt, { provider });

  expect(result).toEqual({
    system: "You are a helpful assistant.",
    messages: [{ role: "user", content: [{ type: "text", text: "Hello!" }] }],
  });
});

test("anthropic: renders user and assistant messages", async () => {
  const prompt = rootScope(
    message("user", [text("Hello!")]),
    message("assistant", [text("Hi there!")])
  );

  const result = await render(prompt, { provider });

  expect(result).toEqual({
    messages: [
      { role: "user", content: [{ type: "text", text: "Hello!" }] },
      { role: "assistant", content: [{ type: "text", text: "Hi there!" }] },
    ],
  });
});

test("anthropic: renders tool calls as tool_use blocks", async () => {
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
  const prompt = rootScope(
    message("system", [text("You are a weather assistant.")]),
    message("user", [text("What's the weather in Paris?")]),
    message("assistant", [
      text("Let me check."),
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
        output: { temp: 18 },
        toolCallId: "call_1",
        toolName: "getWeather",
      },
    ]),
    message("assistant", [text("The temperature in Paris is 18°C.")])
  );

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
  const prompt = rootScope(
    message("assistant", [
      { type: "reasoning", text: "Let me think about this..." },
      text("The answer is 4."),
    ])
  );

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
