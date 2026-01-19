import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";
import type { ModelMessage } from "ai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { describe, expect, test } from "vitest";
import { AiSdkRenderer } from "./ai-sdk";
import { AnthropicRenderer, type AnthropicRenderResult } from "./anthropic";
import { OpenAIChatRenderer } from "./openai";

describe("Prompt history parsing", () => {
  test("AiSdkRenderer parses assistant parts and tool results", () => {
    const renderer = new AiSdkRenderer();

    const messages = [
      { role: "system", content: "System" },
      { role: "user", content: "User" },
      {
        role: "assistant",
        content: [
          { type: "text", text: "Hello" },
          { type: "reasoning", text: "Because" },
          {
            type: "tool-call",
            toolCallId: "call_1",
            toolName: "calc",
            input: { a: 1 },
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call_1",
            toolName: "calc",
            output: { type: "json", value: { result: 2 } },
          },
        ],
      },
    ] satisfies ModelMessage[];

    const layout = renderer.historyToLayout(messages);

    expect(layout).toEqual([
      { role: "system", text: "System" },
      { role: "user", text: "User" },
      {
        role: "assistant",
        text: "Hello",
        reasoning: "Because",
        toolCalls: [
          {
            type: "tool-call",
            toolCallId: "call_1",
            toolName: "calc",
            input: { a: 1 },
          },
        ],
      },
      {
        role: "tool",
        toolCallId: "call_1",
        toolName: "calc",
        output: { type: "json", value: { result: 2 } },
      },
    ]);
  });

  test("AnthropicRenderer parses tool use and tool results", () => {
    const renderer = new AnthropicRenderer();

    const messages = [
      { role: "user", content: "Hello" },
      {
        role: "assistant",
        content: [
          { type: "text", text: "Calling tool" },
          { type: "tool_use", id: "call_1", name: "calc", input: { a: 1 } },
        ],
      },
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "call_1", content: "OK" },
          { type: "text", text: "Thanks" },
        ],
      },
    ] satisfies MessageParam[];

    const history: AnthropicRenderResult = {
      system: "System",
      messages,
    };

    const layout = renderer.historyToLayout(history);

    expect(layout).toEqual([
      { role: "system", text: "System" },
      { role: "user", text: "Hello" },
      {
        role: "assistant",
        text: "Calling tool",
        toolCalls: [
          {
            type: "tool-call",
            toolCallId: "call_1",
            toolName: "calc",
            input: { a: 1 },
          },
        ],
      },
      {
        role: "tool",
        toolCallId: "call_1",
        toolName: "calc",
        output: "OK",
      },
      { role: "user", text: "Thanks" },
    ]);
  });

  test("OpenAIChatRenderer maps tool calls and tool outputs", () => {
    const renderer = new OpenAIChatRenderer();

    const messages = [
      { role: "developer", content: [{ type: "text", text: "System" }] },
      { role: "user", content: [{ type: "text", text: "Hi" }] },
      {
        role: "assistant",
        content: "Let me check",
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: { name: "calc", arguments: '{"a":1}' },
          },
        ],
      },
      { role: "tool", tool_call_id: "call_1", content: '{"result":2}' },
    ] satisfies ChatCompletionMessageParam[];

    const layout = renderer.historyToLayout(messages);

    expect(layout).toEqual([
      { role: "system", text: "System" },
      { role: "user", text: "Hi" },
      {
        role: "assistant",
        text: "Let me check",
        toolCalls: [
          {
            type: "tool-call",
            toolCallId: "call_1",
            toolName: "calc",
            input: { a: 1 },
          },
        ],
      },
      {
        role: "tool",
        toolCallId: "call_1",
        toolName: "calc",
        output: { result: 2 },
      },
    ]);
  });
});
