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
import type {
  ChatCompletionsInput,
  ChatMessage,
} from "../protocols/chat-completions";
import { ChatCompletionsProtocol } from "../protocols/chat-completions";
import type { ProviderAdapter } from "../provider-adapter";
import { ProtocolProvider } from "../provider-adapter";
import type { ToolCallPart } from "../types";

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

type AnthropicAssistantContent = Extract<
  ChatMessage<AnthropicToolIO>,
  { role: "assistant" }
>["content"];

export class AnthropicAdapter
  implements
    ProviderAdapter<
      ChatCompletionsInput<AnthropicToolIO>,
      AnthropicRenderResult
    >
{
  toProvider(
    input: ChatCompletionsInput<AnthropicToolIO>
  ): AnthropicRenderResult {
    const messages: MessageParam[] = [];
    let system = "";

    for (const message of input) {
      if (message.role === "system" || message.role === "developer") {
        system = system ? `${system}\n\n${message.content}` : message.content;
        continue;
      }

      if (message.role === "tool") {
        for (const result of message.content) {
          messages.push({
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: result.toolCallId,
                content: result.output,
              },
            ],
          });
        }
        continue;
      }

      const rendered = renderAnthropicMessage(message);
      if (rendered.message) {
        messages.push(rendered.message);
      }
    }

    return system ? { system, messages } : { messages };
  }

  fromProvider(
    input: AnthropicRenderResult
  ): ChatCompletionsInput<AnthropicToolIO> {
    const output: ChatMessage<AnthropicToolIO>[] = [];
    const toolNameById = new Map<string, string>();

    if (input.system) {
      output.push({ role: "system", content: input.system });
    }

    for (const message of input.messages) {
      if (message.role === "assistant") {
        output.push(parseAnthropicAssistantMessage(message, toolNameById));
      }
      if (message.role === "user") {
        output.push(...parseAnthropicUserMessage(message, toolNameById));
      }
    }

    return output;
  }
}

interface RenderedAnthropicMessage {
  message?: MessageParam;
}

function renderAnthropicMessage(
  message: ChatMessage<AnthropicToolIO>
): RenderedAnthropicMessage {
  switch (message.role) {
    case "user":
      return renderAnthropicUserMessage(message.content);
    case "assistant":
      return renderAnthropicAssistantMessage(message.content);
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
  content: AnthropicAssistantContent
): RenderedAnthropicMessage {
  if (typeof content === "string") {
    return content
      ? {
          message: {
            role: "assistant",
            content: [{ type: "text", text: content }],
          },
        }
      : {};
  }

  let text = "";
  let reasoning = "";
  const toolUses: ContentBlockParam[] = [];

  for (const part of content) {
    if (part.type === "text") {
      text += part.text;
    } else if (part.type === "reasoning") {
      reasoning += part.text;
    } else if (part.type === "tool-call") {
      toolUses.push({
        type: "tool_use",
        id: part.toolCallId,
        name: part.toolName,
        input: part.input,
      });
    }
  }

  const combinedText = reasoning
    ? `${text}<thinking>\n${reasoning}\n</thinking>`
    : text;

  const contentBlocks: ContentBlockParam[] = [
    ...(combinedText ? [{ type: "text", text: combinedText }] : []),
    ...toolUses,
  ];

  return contentBlocks.length > 0
    ? { message: { role: "assistant", content: contentBlocks } }
    : {};
}

function parseAnthropicAssistantMessage(
  message: MessageParam,
  toolNameById: Map<string, string>
): ChatMessage<AnthropicToolIO> {
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

  if (toolCalls.length > 0) {
    return {
      role: "assistant",
      content: [...(text ? [{ type: "text", text }] : []), ...toolCalls],
    };
  }

  return { role: "assistant", content: text };
}

function parseAnthropicUserMessage(
  message: MessageParam,
  toolNameById: Map<string, string>
): ChatMessage<AnthropicToolIO>[] {
  const blocks =
    typeof message.content === "string"
      ? [{ type: "text", text: message.content }]
      : message.content;
  const output: ChatMessage<AnthropicToolIO>[] = [];
  let text = "";

  for (const block of blocks) {
    if (block.type === "text") {
      text += block.text;
    } else if (block.type === "tool_result") {
      if (text) {
        output.push({ role: "user", content: text });
        text = "";
      }
      const toolName = toolNameById.get(block.tool_use_id) ?? "";
      output.push({
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: block.tool_use_id,
            toolName,
            output: block.content,
          },
        ],
      });
    }
  }

  if (text) {
    output.push({ role: "user", content: text });
  }

  return output;
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

export class AnthropicProvider extends ProtocolProvider<
  AnthropicRenderResult,
  ChatCompletionsInput<AnthropicToolIO>,
  AnthropicToolIO
> {
  private readonly client: Anthropic;
  private readonly model: Model;
  private readonly maxTokens: number;

  constructor(client: Anthropic, model: Model, maxTokens: number) {
    super(
      new ChatCompletionsProtocol<AnthropicToolIO>(),
      new AnthropicAdapter()
    );
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
