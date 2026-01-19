import { getEncoding } from "js-tiktoken";
import type OpenAI from "openai";
import type {
  ChatCompletionAssistantMessageParam,
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
  ChatCompletionSystemMessageParam,
  ChatCompletionToolMessageParam,
  ChatCompletionUserMessageParam,
} from "openai/resources/chat/completions";
import type { ResponseInputItem } from "openai/resources/responses/responses";
import type { z } from "zod";
import {
  coalesceTextParts,
  partsToText,
  safeStringify,
} from "../renderers/shared";
import type {
  PromptLayout,
  PromptMessage,
  PromptPart,
  ToolResultPart,
} from "../types";
import { ModelProvider, PromptRenderer } from "../types";

const encoder = getEncoding("cl100k_base");
const countText = (text: string): number => encoder.encode(text).length;

export class OpenAIChatRenderer extends PromptRenderer<
  ChatCompletionMessageParam[]
> {
  render(layout: PromptLayout): ChatCompletionMessageParam[] {
    const messages: ChatCompletionMessageParam[] = [];

    for (const message of layout.messages) {
      messages.push(toChatMessage(message));
    }

    return messages;
  }
}

export class OpenAIResponsesRenderer extends PromptRenderer<
  ResponseInputItem[]
> {
  render(layout: PromptLayout): ResponseInputItem[] {
    const items: ResponseInputItem[] = [];
    let reasoningIndex = 0;

    for (const message of layout.messages) {
      const nextItems = toResponseItems(message, () => reasoningIndex++);
      items.push(...nextItems);
    }

    return items;
  }
}

function toChatMessage(message: PromptMessage): ChatCompletionMessageParam {
  const coalesced = coalesceTextParts(message.parts);

  if (message.role === "system") {
    return toSystemMessage(coalesced);
  }

  if (message.role === "user") {
    return toUserMessage(coalesced);
  }

  if (message.role === "assistant") {
    return toAssistantMessage(coalesced);
  }

  if (message.role === "tool") {
    const toolResult = coalesced[0];
    if (!toolResult || toolResult.type !== "tool-result") {
      throw new Error("Tool messages must contain a tool result.");
    }
    return toToolMessage(toolResult);
  }

  throw new Error(`Unsupported role "${message.role}" for OpenAI chat.`);
}

function toSystemMessage(
  parts: readonly PromptPart[]
): ChatCompletionSystemMessageParam {
  return {
    role: "system",
    content: partsToText(parts, { wrapReasoning: true }),
  };
}

function toUserMessage(
  parts: readonly PromptPart[]
): ChatCompletionUserMessageParam {
  return {
    role: "user",
    content: partsToText(parts, { wrapReasoning: true }),
  };
}

function toAssistantMessage(
  parts: readonly PromptPart[]
): ChatCompletionAssistantMessageParam {
  if (parts.some((part) => part.type === "tool-result")) {
    throw new Error("Tool results must be inside tool messages.");
  }
  const textContent = partsToText(parts, { wrapReasoning: true });
  const toolCalls: ChatCompletionMessageToolCall[] = parts
    .filter(
      (part): part is Extract<typeof part, { type: "tool-call" }> =>
        part.type === "tool-call"
    )
    .map((part) => ({
      id: part.toolCallId,
      type: "function" as const,
      function: {
        name: part.toolName,
        arguments: safeStringify(part.input),
      },
    }));

  const result: ChatCompletionAssistantMessageParam = {
    role: "assistant",
  };

  if (textContent.length > 0) {
    result.content = textContent;
  }

  if (toolCalls.length > 0) {
    result.tool_calls = toolCalls;
  }

  return result;
}

function toToolMessage(part: ToolResultPart): ChatCompletionToolMessageParam {
  return {
    role: "tool",
    tool_call_id: part.toolCallId,
    content: safeStringify(part.output),
  };
}

type ResponseRole = "user" | "assistant" | "system" | "developer";

const RESPONSE_ROLE_MAP: Record<string, ResponseRole> = {
  system: "system",
  developer: "developer",
  user: "user",
};

function mapRoleForResponses(role: string): ResponseRole | null {
  if (role === "assistant") {
    return "assistant";
  }
  return RESPONSE_ROLE_MAP[role] ?? null;
}

function toResponseItems(
  message: PromptMessage,
  nextReasoningIndex: () => number
): ResponseInputItem[] {
  if (message.role === "tool") {
    const toolResult = message.parts[0];
    if (!toolResult || toolResult.type !== "tool-result") {
      throw new Error("Tool messages must contain a tool result.");
    }
    return [
      {
        type: "function_call_output",
        call_id: toolResult.toolCallId,
        output: safeStringify(toolResult.output),
      },
    ];
  }

  const role = mapRoleForResponses(message.role);
  if (!role) {
    throw new Error(`Unsupported role "${message.role}" for OpenAI responses.`);
  }

  return partsToResponseItems(role, message.parts, nextReasoningIndex);
}

function partsToResponseItems(
  role: ResponseRole,
  parts: readonly PromptPart[],
  nextReasoningIndex: () => number
): ResponseInputItem[] {
  const items: ResponseInputItem[] = [];
  const coalesced = coalesceTextParts(parts);
  let textBuffer = "";

  const flushTextBuffer = () => {
    if (textBuffer.length > 0) {
      items.push({ role, content: textBuffer });
      textBuffer = "";
    }
  };

  for (const part of coalesced) {
    switch (part.type) {
      case "text":
        textBuffer += part.text;
        break;
      case "reasoning":
        flushTextBuffer();
        items.push({
          id: `reasoning_${nextReasoningIndex()}`,
          type: "reasoning",
          summary: [{ type: "summary_text", text: part.text }],
        });
        break;
      case "tool-call":
        flushTextBuffer();
        items.push({
          type: "function_call",
          call_id: part.toolCallId,
          name: part.toolName,
          arguments: safeStringify(part.input),
        });
        break;
      case "tool-result":
        throw new Error("Tool results must be inside tool messages.");
      default:
        break;
    }
  }

  flushTextBuffer();
  return items;
}

function countChatMessageTokens(message: ChatCompletionMessageParam): number {
  let tokens = 0;

  if ("content" in message && typeof message.content === "string") {
    tokens += countText(message.content);
  }

  if ("tool_calls" in message && message.tool_calls) {
    for (const call of message.tool_calls) {
      tokens += countText(call.function.name + call.function.arguments);
    }
  }

  return tokens;
}

function countResponseItemTokens(item: ResponseInputItem): number {
  if ("role" in item && typeof item.content === "string") {
    return countText(item.content);
  }

  if (item.type === "reasoning") {
    return item.summary.reduce((sum, entry) => sum + countText(entry.text), 0);
  }

  if (item.type === "function_call") {
    return countText(item.name + item.arguments);
  }

  if (item.type === "function_call_output") {
    return countText(item.output);
  }

  return 0;
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
    let tokens = 0;
    for (const message of messages) {
      tokens += countChatMessageTokens(message);
    }
    return tokens;
  }

  async completion(messages: ChatCompletionMessageParam[]): Promise<string> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages,
    });
    return response.choices[0]?.message?.content ?? "";
  }

  async object<T>(
    messages: ChatCompletionMessageParam[],
    schema: z.ZodType<T>
  ): Promise<T> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages,
      response_format: {
        type: "json_object",
      },
    });
    const text = response.choices[0]?.message?.content ?? "";
    return schema.parse(JSON.parse(text));
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
    let tokens = 0;
    for (const item of items) {
      tokens += countResponseItemTokens(item);
    }
    return tokens;
  }

  async completion(items: ResponseInputItem[]): Promise<string> {
    const response = await this.client.responses.create({
      model: this.model,
      input: items,
    });
    return response.output_text ?? "";
  }

  async object<T>(
    items: ResponseInputItem[],
    schema: z.ZodType<T>
  ): Promise<T> {
    const text = await this.completion(items);
    return schema.parse(JSON.parse(text));
  }
}

/**
 * Create a ModelProvider for the OpenAI Chat Completions API.
 *
 * @example
 * ```typescript
 * import OpenAI from "openai";
 * import { createProvider } from "@fastpaca/cria/openai";
 *
 * const client = new OpenAI();
 * const provider = createProvider(client, "gpt-4o");
 * ```
 */
export function createProvider(
  client: OpenAI,
  model: string
): OpenAIChatProvider {
  return new OpenAIChatProvider(client, model);
}

/**
 * Create a ModelProvider for the OpenAI Responses API.
 */
export function createResponsesProvider(
  client: OpenAI,
  model: string
): OpenAIResponsesProvider {
  return new OpenAIResponsesProvider(client, model);
}
