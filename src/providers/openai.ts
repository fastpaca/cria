import type OpenAI from "openai";
import type {
  ChatCompletionAssistantMessageParam,
  ChatCompletionMessageParam,
} from "openai/resources/chat/completions";
import type { ResponseInputItem } from "openai/resources/responses/responses";
import type { z } from "zod";
import { countText, safeStringify } from "../renderers/shared";
import type { PromptLayout, PromptMessage, ToolCallPart } from "../types";
import { ModelProvider, PromptRenderer } from "../types";

export class OpenAIChatRenderer extends PromptRenderer<
  ChatCompletionMessageParam[]
> {
  override render(layout: PromptLayout): ChatCompletionMessageParam[] {
    return layout.map((m): ChatCompletionMessageParam => {
      if (m.role === "system") {
        return { role: "system", content: m.text };
      }
      if (m.role === "user") {
        return { role: "user", content: m.text };
      }
      if (m.role === "assistant") {
        const result: ChatCompletionAssistantMessageParam = {
          role: "assistant",
        };
        if (m.text) {
          result.content = m.text;
        }
        if (m.toolCalls && m.toolCalls.length > 0) {
          result.tool_calls = m.toolCalls.map((tc) => ({
            id: tc.toolCallId,
            type: "function",
            function: { name: tc.toolName, arguments: safeStringify(tc.input) },
          }));
        }
        return result;
      }
      return {
        role: "tool",
        tool_call_id: m.toolCallId,
        content: safeStringify(m.output),
      };
    });
  }

  override historyToLayout(
    messages: ChatCompletionMessageParam[]
  ): PromptLayout {
    return parseChatHistory(messages);
  }
}

export class OpenAIResponsesRenderer extends PromptRenderer<
  ResponseInputItem[]
> {
  override render(layout: PromptLayout): ResponseInputItem[] {
    let idx = 0;
    return layout.flatMap((m) => {
      if (m.role === "tool") {
        return [
          {
            type: "function_call_output" as const,
            call_id: m.toolCallId,
            output: safeStringify(m.output),
          },
        ];
      }

      const role = m.role as "system" | "user" | "assistant";
      const items: ResponseInputItem[] = [];

      if (m.text) {
        items.push({ role, content: m.text } as ResponseInputItem);
      }

      if (m.role === "assistant" && m.reasoning) {
        items.push({
          id: `reasoning_${idx++}`,
          type: "reasoning",
          summary: [{ type: "summary_text", text: m.reasoning }],
        });
      }

      if (m.role === "assistant" && m.toolCalls) {
        for (const tc of m.toolCalls) {
          items.push({
            type: "function_call",
            call_id: tc.toolCallId,
            name: tc.toolName,
            arguments: safeStringify(tc.input),
          });
        }
      }

      return items;
    });
  }

  override historyToLayout(items: ResponseInputItem[]): PromptLayout {
    return parseResponsesHistory(items);
  }
}

function countChatMessageTokens(msg: ChatCompletionMessageParam): number {
  let n = 0;
  if ("content" in msg && typeof msg.content === "string") {
    n += countText(msg.content);
  }
  if ("tool_calls" in msg && msg.tool_calls) {
    for (const c of msg.tool_calls) {
      n += countText(c.function.name + c.function.arguments);
    }
  }
  return n;
}

function countResponseItemTokens(item: ResponseInputItem): number {
  if ("content" in item && typeof item.content === "string") {
    return countText(item.content);
  }
  if (item.type === "message" && Array.isArray(item.content)) {
    return (item.content as { text?: string }[]).reduce(
      (n, c) => n + (c.text ? countText(c.text) : 0),
      0
    );
  }
  if (item.type === "reasoning") {
    return item.summary.reduce((n, s) => n + countText(s.text), 0);
  }
  if (item.type === "function_call") {
    return countText(item.name + item.arguments);
  }
  if (item.type === "function_call_output") {
    return countText(item.output);
  }
  return 0;
}

function parseJsonOrString(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function extractText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (!Array.isArray(value)) {
    return "";
  }
  return value
    .map((part) => {
      if (typeof part === "string") {
        return part;
      }
      if (typeof part !== "object" || part === null) {
        return "";
      }
      if (!("text" in part)) {
        return "";
      }
      const text = part.text;
      if (typeof text === "string") {
        return text;
      }
      return "";
    })
    .join("");
}

function parseChatHistory(
  messages: ChatCompletionMessageParam[]
): PromptLayout {
  const toolNameById = new Map<string, string>();
  return messages.flatMap((message) => parseChatMessage(message, toolNameById));
}

function parseChatMessage(
  message: ChatCompletionMessageParam,
  toolNameById: Map<string, string>
): PromptMessage[] {
  if (message.role === "system" || message.role === "developer") {
    return [{ role: "system", text: extractText(message.content) }];
  }
  if (message.role === "user") {
    return [{ role: "user", text: extractText(message.content) }];
  }
  if (message.role === "assistant") {
    return [parseChatAssistantMessage(message, toolNameById)];
  }
  if (message.role === "tool") {
    return [parseChatToolMessage(message, toolNameById)];
  }
  if (message.role === "function") {
    return [parseChatFunctionMessage(message)];
  }
  return [];
}

function parseChatAssistantMessage(
  message: Extract<ChatCompletionMessageParam, { role: "assistant" }>,
  toolNameById: Map<string, string>
): PromptMessage {
  const toolCalls = extractChatToolCalls(message, toolNameById);
  const assistant: Extract<PromptMessage, { role: "assistant" }> = {
    role: "assistant",
    text: extractText(message.content),
  };
  if (toolCalls.length > 0) {
    assistant.toolCalls = toolCalls;
  }
  return assistant;
}

function extractChatToolCalls(
  message: Extract<ChatCompletionMessageParam, { role: "assistant" }>,
  toolNameById: Map<string, string>
): ToolCallPart[] {
  const calls =
    "tool_calls" in message && Array.isArray(message.tool_calls)
      ? message.tool_calls
      : [];

  return calls.map((call) => {
    toolNameById.set(call.id, call.function.name);
    return {
      type: "tool-call",
      toolCallId: call.id,
      toolName: call.function.name,
      input: parseJsonOrString(call.function.arguments),
    };
  });
}

function parseChatToolMessage(
  message: Extract<ChatCompletionMessageParam, { role: "tool" }>,
  toolNameById: Map<string, string>
): PromptMessage {
  return {
    role: "tool",
    toolCallId: message.tool_call_id,
    toolName: toolNameById.get(message.tool_call_id) ?? "",
    output: parseJsonOrString(extractText(message.content)),
  };
}

function parseChatFunctionMessage(
  message: Extract<ChatCompletionMessageParam, { role: "function" }>
): PromptMessage {
  return {
    role: "tool",
    toolCallId: message.name,
    toolName: message.name,
    output: parseJsonOrString(extractText(message.content)),
  };
}

function parseResponsesHistory(items: ResponseInputItem[]): PromptLayout {
  const toolNameById = new Map<string, string>();
  return items.flatMap((item) => parseResponseItem(item, toolNameById));
}

function parseResponseItem(
  item: ResponseInputItem,
  toolNameById: Map<string, string>
): PromptMessage[] {
  if ("role" in item && typeof item.role === "string") {
    return parseResponseRoleMessage(item);
  }
  if (item.type === "reasoning") {
    return parseResponseReasoningMessage(item);
  }
  if (item.type === "function_call") {
    return [parseResponseToolCall(item, toolNameById)];
  }
  if (item.type === "function_call_output") {
    return [parseResponseToolResult(item, toolNameById)];
  }
  return [];
}

function parseResponseRoleMessage(
  item: Extract<ResponseInputItem, { role: string }>
): PromptMessage[] {
  const role = item.role;
  if (role === "assistant") {
    return [{ role: "assistant", text: extractText(item.content) }];
  }
  if (role === "system" || role === "user") {
    return [{ role, text: extractText(item.content) }];
  }
  return [];
}

function parseResponseReasoningMessage(
  item: Extract<ResponseInputItem, { type: "reasoning" }>
): PromptMessage[] {
  const summary = Array.isArray(item.summary)
    ? item.summary
        .map((s) => (typeof s.text === "string" ? s.text : ""))
        .join("")
    : "";
  if (!summary) {
    return [];
  }
  return [
    {
      role: "assistant",
      text: "",
      reasoning: summary,
    },
  ];
}

function parseResponseToolCall(
  item: Extract<ResponseInputItem, { type: "function_call" }>,
  toolNameById: Map<string, string>
): PromptMessage {
  toolNameById.set(item.call_id, item.name);
  return {
    role: "assistant",
    text: "",
    toolCalls: [
      {
        type: "tool-call",
        toolCallId: item.call_id,
        toolName: item.name,
        input: parseJsonOrString(item.arguments),
      },
    ],
  };
}

function parseResponseToolResult(
  item: Extract<ResponseInputItem, { type: "function_call_output" }>,
  toolNameById: Map<string, string>
): PromptMessage {
  return {
    role: "tool",
    toolCallId: item.call_id,
    toolName: toolNameById.get(item.call_id) ?? "",
    output: parseJsonOrString(item.output),
  };
}

export class OpenAIChatProvider extends ModelProvider<
  ChatCompletionMessageParam[]
> {
  readonly renderer = new OpenAIChatRenderer();
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(client: OpenAI, model: string) {
    super();
    this.client = client;
    this.model = model;
  }

  countTokens(messages: ChatCompletionMessageParam[]): number {
    return messages.reduce((n, m) => n + countChatMessageTokens(m), 0);
  }

  async completion(messages: ChatCompletionMessageParam[]): Promise<string> {
    const res = await this.client.chat.completions.create({
      model: this.model,
      messages,
    });
    return res.choices[0]?.message?.content ?? "";
  }

  async object<T>(
    messages: ChatCompletionMessageParam[],
    schema: z.ZodType<T>
  ): Promise<T> {
    const res = await this.client.chat.completions.create({
      model: this.model,
      messages,
      response_format: { type: "json_object" },
    });
    return schema.parse(JSON.parse(res.choices[0]?.message?.content ?? ""));
  }
}

export class OpenAIResponsesProvider extends ModelProvider<
  ResponseInputItem[]
> {
  readonly renderer = new OpenAIResponsesRenderer();
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(client: OpenAI, model: string) {
    super();
    this.client = client;
    this.model = model;
  }

  countTokens(items: ResponseInputItem[]): number {
    return items.reduce((n, i) => n + countResponseItemTokens(i), 0);
  }

  async completion(items: ResponseInputItem[]): Promise<string> {
    const res = await this.client.responses.create({
      model: this.model,
      input: items,
    });
    return res.output_text ?? "";
  }

  async object<T>(
    items: ResponseInputItem[],
    schema: z.ZodType<T>
  ): Promise<T> {
    return schema.parse(JSON.parse(await this.completion(items)));
  }
}

export function createProvider(
  client: OpenAI,
  model: string
): OpenAIChatProvider {
  return new OpenAIChatProvider(client, model);
}

export function createResponsesProvider(
  client: OpenAI,
  model: string
): OpenAIResponsesProvider {
  return new OpenAIResponsesProvider(client, model);
}
