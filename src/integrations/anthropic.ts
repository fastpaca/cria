import type Anthropic from "@anthropic-ai/sdk";
import type {
  ContentBlockParam,
  MessageParam,
  Model,
} from "@anthropic-ai/sdk/resources/messages";
import { getEncoding } from "js-tiktoken";
import type { z } from "zod";
import { safeStringify } from "../renderers/shared";
import type { PromptLayout, PromptPart } from "../types";
import { ModelProvider, PromptRenderer } from "../types";

const encoder = getEncoding("cl100k_base");
const countText = (text: string): number => encoder.encode(text).length;

type ToolCall = Extract<PromptPart, { type: "tool-call" }>;
type ToolResult = Extract<PromptPart, { type: "tool-result" }>;

export interface AnthropicRenderResult {
  system?: string;
  messages: MessageParam[];
}

export class AnthropicRenderer extends PromptRenderer<AnthropicRenderResult> {
  render(layout: PromptLayout): AnthropicRenderResult {
    const messages: MessageParam[] = [];
    let system = "";

    for (const m of layout.messages) {
      if (m.role === "system") {
        const text = textFrom(m.parts);
        if (text) system = system ? `${system}\n\n${text}` : text;
      } else if (m.role === "user") {
        const content = buildContent(m.parts, false);
        if (content.length) messages.push({ role: "user", content });
      } else if (m.role === "assistant") {
        const content = buildContent(m.parts, true);
        if (content.length) messages.push({ role: "assistant", content });
      } else {
        // tool
        const p = m.parts[0] as ToolResult;
        messages.push({
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: p.toolCallId,
              content: safeStringify(p.output),
            },
          ],
        });
      }
    }

    return system ? { system, messages } : { messages };
  }
}

function buildContent(
  parts: readonly PromptPart[],
  includeToolCalls: boolean
): ContentBlockParam[] {
  const content: ContentBlockParam[] = [];
  let buf = "";
  const flush = () => {
    if (buf) {
      content.push({ type: "text", text: buf });
      buf = "";
    }
  };
  for (const p of parts) {
    if (p.type === "text") buf += p.text;
    else if (p.type === "reasoning")
      buf += `<thinking>\n${p.text}\n</thinking>`;
    else if (p.type === "tool-call" && includeToolCalls) {
      flush();
      const tc = p as ToolCall;
      content.push({
        type: "tool_use",
        id: tc.toolCallId,
        name: tc.toolName,
        input: tc.input,
      });
    }
  }
  flush();
  return content;
}

const textFrom = (parts: readonly PromptPart[]) => {
  let r = "";
  for (const p of parts) {
    if (p.type === "text") r += p.text;
    else if (p.type === "reasoning")
      r += `<thinking>\n${p.text}\n</thinking>\n`;
  }
  return r;
};

function countContentBlockTokens(b: ContentBlockParam): number {
  if (b.type === "text") return countText(b.text);
  if (b.type === "tool_use") return countText(b.name + safeStringify(b.input));
  if (b.type === "tool_result") {
    const c = b.content;
    if (typeof c === "string") return countText(c);
    if (Array.isArray(c))
      return c.reduce(
        (n, e) => n + (e.type === "text" ? countText(e.text) : 0),
        0
      );
  }
  return 0;
}

function countAnthropicMessageTokens(msg: MessageParam): number {
  if (typeof msg.content === "string") return countText(msg.content);
  return msg.content.reduce((n, b) => n + countContentBlockTokens(b), 0);
}

const extractText = (content: Anthropic.Messages.ContentBlock[]) =>
  content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

export class AnthropicProvider extends ModelProvider<AnthropicRenderResult> {
  readonly renderer = new AnthropicRenderer();
  private readonly client: Anthropic;
  private readonly model: Model;
  private readonly maxTokens: number;

  constructor(client: Anthropic, model: Model, maxTokens: number) {
    super();
    this.client = client;
    this.model = model;
    this.maxTokens = maxTokens;
  }

  countTokens(r: AnthropicRenderResult): number {
    return (
      (r.system ? countText(r.system) : 0) +
      r.messages.reduce((n, m) => n + countAnthropicMessageTokens(m), 0)
    );
  }

  async completion(r: AnthropicRenderResult): Promise<string> {
    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      ...(r.system ? { system: r.system } : {}),
      messages: r.messages,
    });
    return extractText(res.content);
  }

  async object<T>(r: AnthropicRenderResult, schema: z.ZodType<T>): Promise<T> {
    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      system: `${r.system ?? ""}\n\nYou must respond with valid JSON only.`,
      messages: r.messages,
    });
    return schema.parse(JSON.parse(extractText(res.content)));
  }
}

export function createProvider(
  client: Anthropic,
  model: Model,
  options: { maxTokens?: number } = {}
): AnthropicProvider {
  return new AnthropicProvider(client, model, options.maxTokens ?? 1024);
}
