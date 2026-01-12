import { expect, test } from "vitest";
import {
  Message,
  Reasoning,
  Region,
  ToolCall,
  ToolResult,
} from "../components";
import { render } from "../render";
import { anthropic } from "./index";

const tokenizer = (text: string): number => Math.ceil(text.length / 4);

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

  const result = await render(prompt, {
    tokenizer,
    budget: 10_000,
    renderer: anthropic,
  });

  expect(result.system).toBe("You are a helpful assistant.");
  expect(result.messages).toHaveLength(1);
  expect(result.messages[0]).toMatchObject({
    role: "user",
    content: [{ type: "text", text: "Hello!" }],
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

  const result = await render(prompt, {
    tokenizer,
    budget: 10_000,
    renderer: anthropic,
  });

  expect(result.system).toBeUndefined();
  expect(result.messages).toHaveLength(2);
  expect(result.messages[0]).toMatchObject({
    role: "user",
    content: [{ type: "text", text: "Hello!" }],
  });
  expect(result.messages[1]).toMatchObject({
    role: "assistant",
    content: [{ type: "text", text: "Hi there!" }],
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

  const result = await render(prompt, {
    tokenizer,
    budget: 10_000,
    renderer: anthropic,
  });

  expect(result.messages).toHaveLength(1);
  expect(result.messages[0]).toMatchObject({
    role: "assistant",
    content: [
      {
        type: "tool_use",
        id: "call_123",
        name: "getWeather",
        input: { city: "Paris" },
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

  const result = await render(prompt, {
    tokenizer,
    budget: 10_000,
    renderer: anthropic,
  });

  // Tool result should be moved to a separate user message
  expect(result.messages).toHaveLength(2);
  expect(result.messages[0]?.role).toBe("assistant");
  expect(result.messages[1]?.role).toBe("user");
  expect(result.messages[1]).toMatchObject({
    role: "user",
    content: [
      {
        type: "tool_result",
        tool_use_id: "call_123",
        content: '{"temperature":20}',
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
        messageRole: "user",
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

  const result = await render(prompt, {
    tokenizer,
    budget: 10_000,
    renderer: anthropic,
  });

  expect(result.system).toBe("You are a weather assistant.");
  expect(result.messages).toHaveLength(4);
  expect(result.messages[0]?.role).toBe("user");
  expect(result.messages[1]?.role).toBe("assistant");
  expect(result.messages[2]?.role).toBe("user");
  expect(result.messages[3]?.role).toBe("assistant");
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

  const result = await render(prompt, {
    tokenizer,
    budget: 10_000,
    renderer: anthropic,
  });

  expect(result.messages).toHaveLength(1);
  const content = result.messages[0]?.content;
  expect(Array.isArray(content)).toBe(true);
  if (Array.isArray(content)) {
    const textBlock = content.find((c) => c.type === "text");
    expect(textBlock).toBeDefined();
    if (textBlock && "text" in textBlock) {
      expect(textBlock.text).toContain("<thinking>");
      expect(textBlock.text).toContain("Let me think about this...");
      expect(textBlock.text).toContain("The answer is 4.");
    }
  }
});
