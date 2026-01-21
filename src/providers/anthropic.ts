import type Anthropic from "@anthropic-ai/sdk";
import type {
  ContentBlockParam,
  MessageParam,
  Model,
  ToolResultBlockParam,
  ToolUseBlockParam,
} from "@anthropic-ai/sdk/resources/messages";
import { getEncoding } from "js-tiktoken";
import type { z } from "zod";
import { MessageCodec } from "../message-codec";
import type { PromptLayout, PromptMessage, ToolCallPart } from "../types";
import { ModelProvider } from "../types";

const encoder = getEncoding("cl100k_base");
const countText = (text: string): number => encoder.encode(text).length;

export interface AnthropicRenderResult {
  system?: string;
  messages: MessageParam[];
}

export interface AnthropicToolIO {
  callInput: ToolUseBlockParam["input"];
  resultOutput: ToolResultBlockParam["content"];
}

export class AnthropicCodec extends MessageCodec<
  AnthropicRenderResult,
  AnthropicToolIO
> {
  override render(
    layout: PromptLayout<AnthropicToolIO>
  ): AnthropicRenderResult {
    const messages: MessageParam[] = [];
    let system = "";

    for (const message of layout) {
      const rendered = renderAnthropicMessage(message);
      if (rendered.systemText) {
        system = system
          ? `${system}\n\n${rendered.systemText}`
          : rendered.systemText;
      }
      if (rendered.message) {
        messages.push(rendered.message);
      }
    }

    return system ? { system, messages } : { messages };
  }

  override parse(
    rendered: AnthropicRenderResult
  ): PromptLayout<AnthropicToolIO> {
    const layout: PromptMessage<AnthropicToolIO>[] = [];
    const toolNameById = new Map<string, string>();

    if (rendered.system) {
      layout.push({ role: "system", text: rendered.system });
    }

    for (const message of rendered.messages) {
      switch (message.role) {
        case "assistant":
          layout.push(parseAnthropicAssistantMessage(message, toolNameById));
          break;
        case "user":
          layout.push(...parseAnthropicUserMessage(message, toolNameById));
          break;
        default:
          break;
      }
    }

    return layout;
  }
}

interface RenderedAnthropicMessage {
  systemText?: string;
  message?: MessageParam;
}

function renderAnthropicMessage(
  message: PromptMessage<AnthropicToolIO>
): RenderedAnthropicMessage {
  switch (message.role) {
    case "system":
      return { systemText: message.text };
    case "user":
      return renderAnthropicUserMessage(message.text);
    case "assistant":
      return renderAnthropicAssistantMessage(message);
    case "tool":
      return {
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: message.toolCallId,
              content: message.output,
            },
          ],
        },
      };
    default:
      return {};
  }
}

function renderAnthropicUserMessage(text: string): RenderedAnthropicMessage {
  return text
    ? { message: { role: "user", content: [{ type: "text", text }] } }
    : {};
}

function renderAnthropicAssistantMessage(
  message: Extract<PromptMessage<AnthropicToolIO>, { role: "assistant" }>
): RenderedAnthropicMessage {
  const text =
    message.text +
    (message.reasoning ? `<thinking>\n${message.reasoning}\n</thinking>` : "");
  const content: ContentBlockParam[] = [
    ...(text ? [{ type: "text", text }] : []),
    ...(message.toolCalls ?? []).map((tc) => ({
      type: "tool_use",
      id: tc.toolCallId,
      name: tc.toolName,
      input: tc.input,
    })),
  ];
  return content.length > 0 ? { message: { role: "assistant", content } } : {};
}

function parseAnthropicAssistantMessage(
  message: MessageParam,
  toolNameById: Map<string, string>
): PromptMessage<AnthropicToolIO> {
  const blocks =
    typeof message.content === "string"
      ? [{ type: "text", text: message.content }]
      : message.content;
  const toolCalls: ToolCallPart<AnthropicToolIO>[] = [];
  let text = "";

  for (const block of blocks) {
    if (block.type === "text") {
      text += block.text;
    } else if (block.type === "tool_use") {
      toolNameById.set(block.id, block.name);
      toolCalls.push({
        type: "tool-call",
        toolCallId: block.id,
        toolName: block.name,
        input: block.input,
      });
    }
  }

  const assistant: PromptMessage<AnthropicToolIO> = {
    role: "assistant",
    text,
  };
  if (toolCalls.length > 0) {
    assistant.toolCalls = toolCalls;
  }
  return assistant;
}

function parseAnthropicUserMessage(
  message: MessageParam,
  toolNameById: Map<string, string>
): PromptMessage<AnthropicToolIO>[] {
  const blocks =
    typeof message.content === "string"
      ? [{ type: "text", text: message.content }]
      : message.content;
  const layout: PromptMessage<AnthropicToolIO>[] = [];
  let text = "";

  for (const block of blocks) {
    if (block.type === "text") {
      text += block.text;
    } else if (block.type === "tool_result") {
      if (text) {
        layout.push({ role: "user", text });
        text = "";
      }
      const toolName = toolNameById.get(block.tool_use_id) ?? "";
      layout.push({
        role: "tool",
        toolCallId: block.tool_use_id,
        toolName,
        output: block.content,
      });
    }
  }

  if (text) {
    layout.push({ role: "user", text });
  }

  return layout;
}

const serializeToolInput = (input: ToolUseBlockParam["input"]): string => {
  if (typeof input === "string") {
    return input;
  }
  return JSON.stringify(input) ?? "";
};

function countContentBlockTokens(b: ContentBlockParam): number {
  if (b.type === "text") {
    return countText(b.text);
  }
  if (b.type === "tool_use") {
    return countText(b.name + serializeToolInput(b.input));
  }
  if (b.type === "tool_result") {
    const c = b.content;
    if (typeof c === "string") {
      return countText(c);
    }
    if (Array.isArray(c)) {
      return c.reduce(
        (n, e) => n + (e.type === "text" ? countText(e.text) : 0),
        0
      );
    }
  }
  return 0;
}

function countAnthropicMessageTokens(msg: MessageParam): number {
  if (typeof msg.content === "string") {
    return countText(msg.content);
  }
  return msg.content.reduce((n, b) => n + countContentBlockTokens(b), 0);
}

const extractText = (content: Anthropic.Messages.ContentBlock[]) =>
  content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

export class AnthropicProvider extends ModelProvider<
  AnthropicRenderResult,
  AnthropicToolIO
> {
  readonly codec = new AnthropicCodec();
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
