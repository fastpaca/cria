import { getEncoding } from "js-tiktoken";
import type OpenAI from "openai";
import type {
  ChatCompletionAssistantMessageParam,
  ChatCompletionMessageParam,
} from "openai/resources/chat/completions";
import type { ResponseInputItem } from "openai/resources/responses/responses";
import type { z } from "zod";
import { safeStringify } from "../renderers/shared";
import type { PromptLayout, PromptPart } from "../types";
import { ModelProvider, PromptRenderer } from "../types";

const encoder = getEncoding("cl100k_base");
const countText = (text: string): number => encoder.encode(text).length;

type ToolCall = Extract<PromptPart, { type: "tool-call" }>;
type ToolResult = Extract<PromptPart, { type: "tool-result" }>;

export class OpenAIChatRenderer extends PromptRenderer<
  ChatCompletionMessageParam[]
> {
  render(layout: PromptLayout): ChatCompletionMessageParam[] {
    return layout.messages.map((m) => {
      if (m.role === "system") {
        return { role: "system", content: textFrom(m.parts) };
      }
      if (m.role === "user") {
        return { role: "user", content: textFrom(m.parts) };
      }
      if (m.role === "assistant") {
        const text = textFrom(m.parts);
        const toolCalls = m.parts.filter(
          (p) => p.type === "tool-call"
        ) as ToolCall[];
        const result: ChatCompletionAssistantMessageParam = {
          role: "assistant",
        };
        if (text) result.content = text;
        if (toolCalls.length > 0) {
          result.tool_calls = toolCalls.map((tc) => ({
            id: tc.toolCallId,
            type: "function",
            function: { name: tc.toolName, arguments: safeStringify(tc.input) },
          }));
        }
        return result;
      }
      // tool
      const p = m.parts[0] as ToolResult;
      return {
        role: "tool",
        tool_call_id: p.toolCallId,
        content: safeStringify(p.output),
      };
    });
  }
}

export class OpenAIResponsesRenderer extends PromptRenderer<
  ResponseInputItem[]
> {
  render(layout: PromptLayout): ResponseInputItem[] {
    let idx = 0;
    return layout.messages.flatMap((m) => {
      if (m.role === "tool") {
        const p = m.parts[0] as ToolResult;
        return [
          {
            type: "function_call_output" as const,
            call_id: p.toolCallId,
            output: safeStringify(p.output),
          },
        ];
      }
      const role = m.role as "system" | "user" | "assistant";
      const items: ResponseInputItem[] = [];
      let buf = "";
      const flush = () => {
        if (buf) {
          items.push({ role, content: buf } as ResponseInputItem);
          buf = "";
        }
      };
      for (const p of m.parts) {
        if (p.type === "text") buf += p.text;
        else if (p.type === "reasoning") {
          flush();
          items.push({
            id: `reasoning_${idx++}`,
            type: "reasoning",
            summary: [{ type: "summary_text", text: p.text }],
          });
        } else if (p.type === "tool-call") {
          flush();
          items.push({
            type: "function_call",
            call_id: p.toolCallId,
            name: p.toolName,
            arguments: safeStringify(p.input),
          });
        }
      }
      flush();
      return items;
    });
  }
}

const textFrom = (parts: readonly PromptPart[]) =>
  parts
    .filter((p) => p.type === "text")
    .map((p) => p.text)
    .join("");

function countChatMessageTokens(msg: ChatCompletionMessageParam): number {
  let n = 0;
  if ("content" in msg && typeof msg.content === "string")
    n += countText(msg.content);
  if ("tool_calls" in msg && msg.tool_calls) {
    for (const c of msg.tool_calls)
      n += countText(c.function.name + c.function.arguments);
  }
  return n;
}

function countResponseItemTokens(item: ResponseInputItem): number {
  if ("content" in item && typeof item.content === "string")
    return countText(item.content);
  if (item.type === "message" && Array.isArray(item.content)) {
    return (item.content as { text?: string }[]).reduce(
      (n, c) => n + (c.text ? countText(c.text) : 0),
      0
    );
  }
  if (item.type === "reasoning")
    return item.summary.reduce((n, s) => n + countText(s.text), 0);
  if (item.type === "function_call")
    return countText(item.name + item.arguments);
  if (item.type === "function_call_output") return countText(item.output);
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
