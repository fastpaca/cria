import { expect, test } from "vitest";
import {
  Message,
  Reasoning,
  Region,
  ToolCall,
  ToolResult,
} from "../components";
import { render } from "../render";
import { chatCompletions, responses } from "./index";

const tokenizer = (text: string): number => Math.ceil(text.length / 4);

test("chatCompletions: renders system message", async () => {
  const prompt = (
    <Region priority={0}>
      <Message messageRole="system">You are a helpful assistant.</Message>
    </Region>
  );

  const messages = await render(prompt, {
    tokenizer,
    budget: 10_000,
    renderer: chatCompletions,
  });

  expect(messages).toHaveLength(1);
  expect(messages[0]).toEqual({
    role: "system",
    content: "You are a helpful assistant.",
  });
});

test("chatCompletions: renders user and assistant messages", async () => {
  const prompt = (
    <Region priority={0}>
      <Message messageRole="user">Hello!</Message>
      <Message messageRole="assistant">Hi there! How can I help?</Message>
    </Region>
  );

  const messages = await render(prompt, {
    tokenizer,
    budget: 10_000,
    renderer: chatCompletions,
  });

  expect(messages).toHaveLength(2);
  expect(messages[0]).toEqual({ role: "user", content: "Hello!" });
  expect(messages[1]).toEqual({
    role: "assistant",
    content: "Hi there! How can I help?",
  });
});

test("chatCompletions: renders tool calls on assistant message", async () => {
  const prompt = (
    <Region priority={0}>
      <Message messageRole="assistant">
        Let me check the weather.
        <ToolCall
          input={{ city: "Paris" }}
          priority={1}
          toolCallId="call_123"
          toolName="getWeather"
        />
      </Message>
    </Region>
  );

  const messages = await render(prompt, {
    tokenizer,
    budget: 10_000,
    renderer: chatCompletions,
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
  const prompt = (
    <Region priority={0}>
      <Message messageRole="assistant">
        <ToolCall
          input={{ city: "Paris" }}
          priority={1}
          toolCallId="call_123"
          toolName="getWeather"
        />
        <ToolResult
          output={{ temperature: 20 }}
          priority={1}
          toolCallId="call_123"
          toolName="getWeather"
        />
      </Message>
    </Region>
  );

  const messages = await render(prompt, {
    tokenizer,
    budget: 10_000,
    renderer: chatCompletions,
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
  const prompt = (
    <Region priority={0}>
      <Message messageRole="system">You are a weather assistant.</Message>
      <Message messageRole="user">What's the weather in Paris?</Message>
      <Message messageRole="assistant">
        <ToolCall
          input={{ city: "Paris" }}
          priority={1}
          toolCallId="call_1"
          toolName="getWeather"
        />
        <ToolResult
          output={{ temp: 18, condition: "sunny" }}
          priority={1}
          toolCallId="call_1"
          toolName="getWeather"
        />
      </Message>
      <Message messageRole="assistant">
        The weather in Paris is sunny with a temperature of 18°C.
      </Message>
    </Region>
  );

  const messages = await render(prompt, {
    tokenizer,
    budget: 10_000,
    renderer: chatCompletions,
  });

  expect(messages).toHaveLength(5);
  expect(messages[0]?.role).toBe("system");
  expect(messages[1]?.role).toBe("user");
  expect(messages[2]?.role).toBe("assistant");
  expect(messages[3]?.role).toBe("tool");
  expect(messages[4]?.role).toBe("assistant");
});

// ============================================================================
// Responses API Tests
// ============================================================================

test("responses: renders messages as EasyInputMessage", async () => {
  const prompt = (
    <Region priority={0}>
      <Message messageRole="system">You are a helpful assistant.</Message>
      <Message messageRole="user">Hello!</Message>
    </Region>
  );

  const input = await render(prompt, {
    tokenizer,
    budget: 10_000,
    renderer: responses,
  });

  expect(input).toHaveLength(2);
  expect(input[0]).toMatchObject({
    role: "system",
    content: "You are a helpful assistant.",
  });
  expect(input[1]).toMatchObject({
    role: "user",
    content: "Hello!",
  });
});

test("responses: renders tool calls as function_call items", async () => {
  const prompt = (
    <Region priority={0}>
      <Message messageRole="assistant">
        <ToolCall
          input={{ city: "Paris" }}
          priority={1}
          toolCallId="call_123"
          toolName="getWeather"
        />
      </Message>
    </Region>
  );

  const input = await render(prompt, {
    tokenizer,
    budget: 10_000,
    renderer: responses,
  });

  expect(input).toHaveLength(1);
  expect(input[0]).toMatchObject({
    type: "function_call",
    call_id: "call_123",
    name: "getWeather",
    arguments: '{"city":"Paris"}',
  });
});

test("responses: renders tool results as function_call_output items", async () => {
  const prompt = (
    <Region priority={0}>
      <ToolResult
        output={{ temperature: 20 }}
        priority={1}
        toolCallId="call_123"
        toolName="getWeather"
      />
    </Region>
  );

  const input = await render(prompt, {
    tokenizer,
    budget: 10_000,
    renderer: responses,
  });

  expect(input).toHaveLength(1);
  expect(input[0]).toMatchObject({
    type: "function_call_output",
    call_id: "call_123",
    output: '{"temperature":20}',
  });
});

test("responses: renders reasoning as native reasoning item", async () => {
  const prompt = (
    <Region priority={0}>
      <Reasoning priority={1} text="Let me think about this..." />
    </Region>
  );

  const input = await render(prompt, {
    tokenizer,
    budget: 10_000,
    renderer: responses,
  });

  expect(input).toHaveLength(1);
  expect(input[0]).toMatchObject({
    type: "reasoning",
    summary: [{ type: "summary_text", text: "Let me think about this..." }],
  });
});

test("responses: preserves reasoning inside messages and keeps ordering", async () => {
  const prompt = (
    <Region priority={0}>
      <Message messageRole="assistant">
        {[
          "Before",
          <Reasoning priority={1} text="thinking..." />,
          <ToolCall
            input={{ city: "Paris" }}
            priority={1}
            toolCallId="call_123"
            toolName="getWeather"
          />,
          "After",
        ]}
      </Message>
    </Region>
  );

  const input = await render(prompt, {
    tokenizer,
    budget: 10_000,
    renderer: responses,
  });

  expect(input).toHaveLength(4);
  expect(input[0]).toMatchObject({
    role: "assistant",
    content: "Before",
  });
  expect(input[1]).toMatchObject({
    type: "reasoning",
    summary: [{ type: "summary_text", text: "thinking..." }],
  });
  expect(input[2]).toMatchObject({
    type: "function_call",
    call_id: "call_123",
    name: "getWeather",
  });
  expect(input[3]).toMatchObject({
    role: "assistant",
    content: "After",
  });
});

test("responses: full conversation with reasoning", async () => {
  const prompt = (
    <Region priority={0}>
      <Message messageRole="system">You are a helpful assistant.</Message>
      <Message messageRole="user">What is 2+2?</Message>
      <Reasoning priority={1} text="This is basic arithmetic." />
      <Message messageRole="assistant">The answer is 4.</Message>
    </Region>
  );

  const input = await render(prompt, {
    tokenizer,
    budget: 10_000,
    renderer: responses,
  });

  expect(input).toHaveLength(4);
  expect(input[0]).toMatchObject({ role: "system" });
  expect(input[1]).toMatchObject({ role: "user" });
  expect(input[2]).toMatchObject({ type: "reasoning" });
  expect(input[3]).toMatchObject({ role: "assistant" });
});
