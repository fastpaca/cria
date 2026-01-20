import type OpenAI from "openai";
import type {
  ChatCompletionAssistantMessageParam,
  ChatCompletionMessageParam,
} from "openai/resources/chat/completions";
import type { ResponseInputItem } from "openai/resources/responses/responses";
import type { z } from "zod";
import { countText } from "../renderers/shared";
import type { PromptLayout } from "../types";
import { ModelProvider, PromptRenderer } from "../types";

export interface OpenAiToolIO {
  callInput: string;
  resultOutput: string;
}

export class OpenAIChatRenderer extends PromptRenderer<
  ChatCompletionMessageParam[],
  OpenAiToolIO
> {
  override render(
    layout: PromptLayout<OpenAiToolIO>
  ): ChatCompletionMessageParam[] {
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
            function: { name: tc.toolName, arguments: tc.input },
          }));
        }
        return result;
      }
      return {
        role: "tool",
        tool_call_id: m.toolCallId,
        content: m.output,
      };
    });
  }
}

export class OpenAIResponsesRenderer extends PromptRenderer<
  ResponseInputItem[],
  OpenAiToolIO
> {
  override render(layout: PromptLayout<OpenAiToolIO>): ResponseInputItem[] {
    let idx = 0;
    return layout.flatMap((m) => {
      if (m.role === "tool") {
        return [
          {
            type: "function_call_output" as const,
            call_id: m.toolCallId,
            output: m.output,
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
            arguments: tc.input,
          });
        }
      }

      return items;
    });
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

export class OpenAIChatProvider extends ModelProvider<
  ChatCompletionMessageParam[],
  OpenAiToolIO
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
  ResponseInputItem[],
  OpenAiToolIO
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
