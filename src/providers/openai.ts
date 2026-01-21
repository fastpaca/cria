import { getEncoding } from "js-tiktoken";
import type OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { ResponseInputItem } from "openai/resources/responses/responses";
import type { z } from "zod";
import { MessageCodec } from "../message-codec";
import type { PromptLayout, PromptMessage } from "../types";
import { ModelProvider } from "../types";

const encoder = getEncoding("cl100k_base");
const countText = (text: string): number => encoder.encode(text).length;

export interface OpenAiToolIO {
  callInput: string;
  resultOutput: string;
}

export class OpenAIChatCodec extends MessageCodec<
  ChatCompletionMessageParam[],
  OpenAiToolIO
> {
  override render(
    layout: PromptLayout<OpenAiToolIO>
  ): ChatCompletionMessageParam[] {
    return layout.map((m): ChatCompletionMessageParam => {
      switch (m.role) {
        case "assistant": {
          const toolCalls = m.toolCalls?.map((tc) => ({
            id: tc.toolCallId,
            type: "function" as const,
            function: { name: tc.toolName, arguments: tc.input },
          }));
          return {
            role: "assistant",
            ...(m.text ? { content: m.text } : {}),
            ...(toolCalls?.length ? { tool_calls: toolCalls } : {}),
          };
        }
        case "tool":
          return {
            role: "tool",
            tool_call_id: m.toolCallId,
            content: m.output,
          };
        default:
          return { role: m.role, content: m.text };
      }
    });
  }

  override parse(
    rendered: ChatCompletionMessageParam[]
  ): PromptLayout<OpenAiToolIO> {
    const toolNameById = new Map<string, string>();
    return rendered.map((message): PromptMessage<OpenAiToolIO> => {
      switch (message.role) {
        case "assistant": {
          const toolCalls = message.tool_calls?.map((tc) => {
            toolNameById.set(tc.id, tc.function.name);
            return {
              type: "tool-call" as const,
              toolCallId: tc.id,
              toolName: tc.function.name,
              input: tc.function.arguments,
            };
          });
          return {
            role: "assistant",
            text: chatText(message.content),
            ...(toolCalls?.length ? { toolCalls } : {}),
          };
        }
        case "tool":
          return {
            role: "tool",
            toolCallId: message.tool_call_id,
            toolName: toolNameById.get(message.tool_call_id) ?? "",
            output: chatText(message.content),
          };
        default:
          return { role: message.role, text: chatText(message.content) };
      }
    });
  }
}

export class OpenAIResponsesCodec extends MessageCodec<
  ResponseInputItem[],
  OpenAiToolIO
> {
  override render(layout: PromptLayout<OpenAiToolIO>): ResponseInputItem[] {
    let reasoningIndex = 0;
    return layout.flatMap((m) => {
      switch (m.role) {
        case "tool":
          return [
            {
              type: "function_call_output" as const,
              call_id: m.toolCallId,
              output: m.output,
            },
          ];
        case "assistant": {
          const items: ResponseInputItem[] = [];
          if (m.text) {
            items.push({ role: "assistant", content: m.text });
          }
          if (m.reasoning) {
            items.push({
              id: `reasoning_${reasoningIndex++}`,
              type: "reasoning",
              summary: [{ type: "summary_text", text: m.reasoning }],
            });
          }
          if (m.toolCalls?.length) {
            items.push(
              ...m.toolCalls.map((tc) => ({
                type: "function_call" as const,
                call_id: tc.toolCallId,
                name: tc.toolName,
                arguments: tc.input,
              }))
            );
          }
          return items;
        }
        default:
          return m.text ? [{ role: m.role, content: m.text }] : [];
      }
    });
  }

  override parse(rendered: ResponseInputItem[]): PromptLayout<OpenAiToolIO> {
    return parseResponseItems(rendered);
  }
}

function parseResponseItems(
  items: ResponseInputItem[]
): PromptLayout<OpenAiToolIO> {
  const layout: PromptMessage<OpenAiToolIO>[] = [];
  const toolNameById = new Map<string, string>();
  let lastAssistant: Extract<
    PromptMessage<OpenAiToolIO>,
    { role: "assistant" }
  > | null = null;

  const ensureAssistant = (): Extract<
    PromptMessage<OpenAiToolIO>,
    { role: "assistant" }
  > => {
    if (!lastAssistant) {
      lastAssistant = { role: "assistant", text: "" };
      layout.push(lastAssistant);
    }
    return lastAssistant;
  };

  for (const item of items) {
    if ("role" in item) {
      lastAssistant = pushResponseMessage(item, layout);
      continue;
    }

    switch (item.type) {
      case "reasoning": {
        const assistant = ensureAssistant();
        assistant.reasoning = `${assistant.reasoning ?? ""}${reasoningText(item)}`;
        break;
      }
      case "function_call": {
        const assistant = ensureAssistant();
        toolNameById.set(item.call_id, item.name);
        const toolCall = {
          type: "tool-call" as const,
          toolCallId: item.call_id,
          toolName: item.name,
          input: item.arguments,
        };
        assistant.toolCalls = assistant.toolCalls
          ? [...assistant.toolCalls, toolCall]
          : [toolCall];
        break;
      }
      case "function_call_output": {
        layout.push({
          role: "tool",
          toolCallId: item.call_id,
          toolName: toolNameById.get(item.call_id) ?? "",
          output: item.output,
        });
        lastAssistant = null;
        break;
      }
      default:
        break;
    }
  }

  return layout;
}

function pushResponseMessage(
  item: ResponseMessageItem,
  layout: PromptMessage<OpenAiToolIO>[]
): Extract<PromptMessage<OpenAiToolIO>, { role: "assistant" }> | null {
  const text = responseText(item.content);
  if (item.role === "assistant") {
    const assistant: PromptMessage<OpenAiToolIO> = { role: "assistant", text };
    layout.push(assistant);
    return assistant;
  }
  if (item.role === "system" || item.role === "user") {
    layout.push({ role: item.role, text });
  }
  return null;
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

function chatText(content: ChatCompletionMessageParam["content"]): string {
  if (content === null || content === undefined) {
    return "";
  }
  if (typeof content === "string") {
    return content;
  }
  let text = "";
  for (const part of content) {
    if (typeof part === "string") {
      text += part;
    } else if (part.type === "text") {
      text += part.text;
    }
  }
  return text;
}

type ResponseMessageItem = Extract<ResponseInputItem, { role: string }>;

function responseText(content: ResponseMessageItem["content"]): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    let text = "";
    for (const part of content) {
      if (typeof part === "string") {
        text += part;
      } else if (part.type === "input_text") {
        text += part.text;
      }
    }
    return text;
  }
  return "";
}

function reasoningText(
  item: Extract<ResponseInputItem, { type: "reasoning" }>
): string {
  return item.summary.map((entry) => entry.text).join("");
}

export class OpenAIChatProvider extends ModelProvider<
  ChatCompletionMessageParam[],
  OpenAiToolIO
> {
  readonly codec = new OpenAIChatCodec();
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
  ResponseInputItem[],
  OpenAiToolIO
> {
  readonly codec = new OpenAIResponsesCodec();
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
