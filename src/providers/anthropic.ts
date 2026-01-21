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

/**
 * Rendered Anthropic input (system + messages array).
 */
export interface AnthropicRenderResult {
  system?: string;
  messages: MessageParam[];
}

/**
 * Tool IO contract derived from Anthropic tool block shapes.
 */
export interface AnthropicToolIO {
  callInput: ToolUseBlockParam["input"];
  resultOutput: ToolResultBlockParam["content"];
}

type AnthropicAssistantContent = Extract<
  ChatMessage<AnthropicToolIO>,
  { role: "assistant" }
>["content"];

/**
 * Adapter between chat-completions protocol messages and Anthropic messages.
 */
export class AnthropicAdapter
  implements
    ProviderAdapter<
      ChatCompletionsInput<AnthropicToolIO>,
      AnthropicRenderResult
    >
{
  /** Convert protocol messages into Anthropic input. */
  toProvider(
    input: ChatCompletionsInput<AnthropicToolIO>
  ): AnthropicRenderResult {
    const messages: MessageParam[] = [];
    let system = "";

    for (const message of input) {
      if (message.role === "system" || message.role === "developer") {
        system = appendSystemContent(system, message.content);
        continue;
      }

      if (message.role === "tool") {
        appendToolResults(messages, message);
        continue;
      }

      appendRenderedMessage(messages, renderAnthropicMessage(message));
    }

    return system ? { system, messages } : { messages };
  }

  /** Convert Anthropic input back into protocol messages. */
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

function appendSystemContent(current: string, content: string): string {
  return current ? `${current}\n\n${content}` : content;
}

function appendToolResults(
  messages: MessageParam[],
  message: Extract<ChatMessage<AnthropicToolIO>, { role: "tool" }>
): void {
  for (const result of message.content) {
    messages.push({
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: result.toolCallId,
          content: result.output ?? "",
        },
      ],
    });
  }
}

function appendRenderedMessage(
  messages: MessageParam[],
  rendered: RenderedAnthropicMessage
): void {
  if (rendered.message) {
    messages.push(rendered.message);
  }
}

/** Render a single protocol message into an Anthropic message if supported. */
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

/** Render a user message into Anthropic message format. */
function renderAnthropicUserMessage(text: string): RenderedAnthropicMessage {
  return text
    ? { message: { role: "user", content: [{ type: "text", text }] } }
    : {};
}

/** Render assistant content into Anthropic message format. */
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

  const contentBlocks: ContentBlockParam[] = [];
  if (combinedText) {
    contentBlocks.push({ type: "text", text: combinedText });
  }
  contentBlocks.push(...toolUses);

  return contentBlocks.length > 0
    ? { message: { role: "assistant", content: contentBlocks } }
    : {};
}

/** Parse an Anthropic assistant message into protocol assistant content. */
function parseAnthropicAssistantMessage(
  message: MessageParam,
  toolNameById: Map<string, string>
): ChatMessage<AnthropicToolIO> {
  const blocks: ContentBlockParam[] =
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
    const content: Array<
      { type: "text"; text: string } | ToolCallPart<AnthropicToolIO>
    > = [];
    if (text) {
      content.push({ type: "text", text });
    }
    content.push(...toolCalls);
    return {
      role: "assistant",
      content,
    };
  }

  return { role: "assistant", content: text };
}

/** Parse an Anthropic user message into protocol user/tool messages. */
function parseAnthropicUserMessage(
  message: MessageParam,
  toolNameById: Map<string, string>
): ChatMessage<AnthropicToolIO>[] {
  const blocks: ContentBlockParam[] =
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

/** Serialize tool input for token counting. */
const serializeToolInput = (input: ToolUseBlockParam["input"]): string => {
  if (typeof input === "string") {
    return input;
  }
  return JSON.stringify(input) ?? "";
};

/** Count tokens for a single Anthropic content block. */
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

/** Count tokens for a single Anthropic message. */
function countAnthropicMessageTokens(msg: MessageParam): number {
  if (typeof msg.content === "string") {
    return countText(msg.content);
  }
  return msg.content.reduce((n, b) => n + countContentBlockTokens(b), 0);
}

/** Extract concatenated text from Anthropic response content blocks. */
const extractText = (content: Anthropic.Messages.ContentBlock[]) =>
  content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

/**
 * Anthropic provider using the chat-completions protocol.
 */
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

  /** Count tokens for Anthropic rendered input. */
  countTokens(r: AnthropicRenderResult): number {
    return (
      (r.system ? countText(r.system) : 0) +
      r.messages.reduce((n, m) => n + countAnthropicMessageTokens(m), 0)
    );
  }

  /** Generate a text completion using Anthropic messages API. */
  async completion(r: AnthropicRenderResult): Promise<string> {
    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      ...(r.system ? { system: r.system } : {}),
      messages: r.messages,
    });
    return extractText(res.content);
  }

  /** Generate a structured object using Anthropic messages API. */
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

/** Convenience creator for the Anthropic provider. */
export function createProvider(
  client: Anthropic,
  model: Model,
  options: { maxTokens?: number } = {}
): AnthropicProvider {
  return new AnthropicProvider(client, model, options.maxTokens ?? 1024);
}
