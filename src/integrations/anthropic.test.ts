import { expect, test } from "vitest";
import {
  Message,
  Reasoning,
  Region,
  ToolCall,
  ToolResult,
} from "../components";
import { render } from "../render";
import { ModelProvider, type PromptRenderer } from "../types";
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

test("anthropic: extracts system message separately", async () => {
  const prompt = Region({
    priority: 0,
    children: [
      Message({
        messageRole: "system",
        children: ["You are a helpful assistant."],
      }),
      Message({ messageRole: "user", children: ["Hello!"] }),
    ],
  });

  const result = await render(prompt, { provider });

  expect(result).toEqual({
    system: "You are a helpful assistant.",
    messages: [{ role: "user", content: [{ type: "text", text: "Hello!" }] }],
  });
});

test("anthropic: renders user and assistant messages", async () => {
  const prompt = Region({
    priority: 0,
    children: [
      Message({ messageRole: "user", children: ["Hello!"] }),
      Message({ messageRole: "assistant", children: ["Hi there!"] }),
    ],
  });

  const result = await render(prompt, { provider });

  expect(result).toEqual({
    messages: [
      { role: "user", content: [{ type: "text", text: "Hello!" }] },
      { role: "assistant", content: [{ type: "text", text: "Hi there!" }] },
    ],
  });
});

test("anthropic: renders tool calls as tool_use blocks", async () => {
  const prompt = Region({
    priority: 0,
    children: [
      Message({
        messageRole: "assistant",
        children: [
          ToolCall({
            input: { city: "Paris" },
            priority: 1,
            toolCallId: "call_123",
            toolName: "getWeather",
          }),
        ],
      }),
    ],
  });

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
  const prompt = Region({
    priority: 0,
    children: [
      Message({
        messageRole: "assistant",
        children: [
          ToolCall({
            input: { city: "Paris" },
            priority: 1,
            toolCallId: "call_123",
            toolName: "getWeather",
          }),
        ],
      }),
      Message({
        messageRole: "tool",
        children: [
          ToolResult({
            output: { temperature: 20 },
            priority: 1,
            toolCallId: "call_123",
            toolName: "getWeather",
          }),
        ],
      }),
    ],
  });

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
  const prompt = Region({
    priority: 0,
    children: [
      Message({
        messageRole: "system",
        children: ["You are a weather assistant."],
      }),
      Message({
        messageRole: "user",
        children: ["What's the weather in Paris?"],
      }),
      Message({
        messageRole: "assistant",
        children: [
          "Let me check.",
          ToolCall({
            input: { city: "Paris" },
            priority: 1,
            toolCallId: "call_1",
            toolName: "getWeather",
          }),
        ],
      }),
      Message({
        messageRole: "tool",
        children: [
          ToolResult({
            output: { temp: 18 },
            priority: 1,
            toolCallId: "call_1",
            toolName: "getWeather",
          }),
        ],
      }),
      Message({
        messageRole: "assistant",
        children: ["The temperature in Paris is 18°C."],
      }),
    ],
  });

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
  const prompt = Region({
    priority: 0,
    children: [
      Message({
        messageRole: "assistant",
        children: [
          Reasoning({ priority: 1, text: "Let me think about this..." }),
          "The answer is 4.",
        ],
      }),
    ],
  });

  const result = await render(prompt, { provider });

  expect(result).toEqual({
    messages: [
      {
        role: "assistant",
        content: [
          {
            type: "text",
            text: "<thinking>\nLet me think about this...\n</thinking>The answer is 4.",
          },
        ],
      },
    ],
  });
});
