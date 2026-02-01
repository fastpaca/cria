import type Anthropic from "@anthropic-ai/sdk";
import type {
  ContentBlockParam,
  MessageParam,
  Model,
  TextBlockParam,
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
import {
  ProtocolProvider,
  type ProviderAdapter,
  type ProviderRenderContext,
} from "../provider";
import type { ToolCallPart } from "../types";

const encoder = getEncoding("cl100k_base");
const countText = (text: string): number => encoder.encode(text).length;

type AnthropicAssistantContent = Extract<
  ChatMessage<AnthropicToolIO>,
  { role: "assistant" }
>["content"];

interface AnthropicUserMessage {
  role: "user";
  content: string;
}
interface AnthropicAssistantMessage {
  role: "assistant";
  content: AnthropicAssistantContent;
}
type AnthropicUserOrAssistantMessage =
  | AnthropicUserMessage
  | AnthropicAssistantMessage;

type AnthropicSystem = string | TextBlockParam[];

interface AnthropicCacheControl {
  type: "ephemeral";
  ttl?: "5m" | "1h";
}

type CacheableContentBlockParam = ContentBlockParam & {
  cache_control?: AnthropicCacheControl | undefined;
};

const toAnthropicTtl = (
  ttlSeconds: number | undefined
): "5m" | "1h" | undefined => {
  if (ttlSeconds === undefined) {
    return undefined;
  }
  return ttlSeconds >= 60 * 60 ? "1h" : "5m";
};

function buildCacheControl(
  ttlSeconds: number | undefined
): AnthropicCacheControl {
  const ttl = toAnthropicTtl(ttlSeconds);
  return ttl ? { type: "ephemeral", ttl } : { type: "ephemeral" };
}

function applyCacheControlToBlock<T extends ContentBlockParam>(
  block: T,
  cacheControl: AnthropicCacheControl
): T & CacheableContentBlockParam {
  return {
    ...block,
    cache_control: cacheControl,
  } as T & CacheableContentBlockParam;
}

function toContentBlocks(
  content: MessageParam["content"]
): ContentBlockParam[] {
  if (typeof content === "string") {
    return content ? [{ type: "text", text: content }] : [];
  }
  return [...content];
}

function applyCacheControlToMessage(
  message: MessageParam,
  cacheControl: AnthropicCacheControl
): MessageParam {
  const blocks = toContentBlocks(message.content);
  if (blocks.length === 0) {
    return message;
  }
  const lastIndex = blocks.length - 1;
  const lastBlock = blocks[lastIndex];
  if (lastBlock) {
    blocks[lastIndex] = applyCacheControlToBlock(lastBlock, cacheControl);
  }
  return { ...message, content: blocks };
}

function resolveCacheControlState(context: ProviderRenderContext | undefined): {
  lastPinnedIndex: number;
  cacheControl?: AnthropicCacheControl;
} {
  const pinnedPrefixCount = context?.cache?.pinnedPrefixMessageCount ?? 0;
  const lastPinnedIndex = pinnedPrefixCount > 0 ? pinnedPrefixCount - 1 : -1;
  const cacheControl =
    lastPinnedIndex >= 0
      ? buildCacheControl(context?.cache?.ttlSeconds)
      : undefined;
  if (cacheControl) {
    return { lastPinnedIndex, cacheControl };
  }
  return { lastPinnedIndex };
}

function createTextBlock(text: string): TextBlockParam {
  return { type: "text", text };
}

function maybeApplyCacheControl<T extends ContentBlockParam>(
  block: T,
  shouldMarkCache: boolean,
  cacheControl: AnthropicCacheControl | undefined
): T | (T & CacheableContentBlockParam) {
  if (!(shouldMarkCache && cacheControl)) {
    return block;
  }
  return applyCacheControlToBlock(block, cacheControl);
}

function renderToolResultMessages(
  message: Extract<ChatMessage<AnthropicToolIO>, { role: "tool" }>,
  shouldMarkCache: boolean,
  cacheControl: AnthropicCacheControl | undefined
): MessageParam[] {
  return message.content.map((result) => {
    const block: ContentBlockParam = {
      type: "tool_result",
      tool_use_id: result.toolCallId,
      content: result.output ?? "",
    };
    const resolvedBlock = maybeApplyCacheControl(
      block,
      shouldMarkCache,
      cacheControl
    );
    return { role: "user", content: [resolvedBlock] };
  });
}

function renderUserOrAssistantMessage(
  message: AnthropicUserOrAssistantMessage,
  shouldMarkCache: boolean,
  cacheControl: AnthropicCacheControl | undefined
): MessageParam | null {
  const rendered = renderAnthropicMessage(message);
  if (!rendered.message) {
    return null;
  }
  if (shouldMarkCache && cacheControl) {
    return applyCacheControlToMessage(rendered.message, cacheControl);
  }
  return rendered.message;
}

function systemToString(
  system: AnthropicSystem | undefined
): string | undefined {
  if (!system) {
    return undefined;
  }
  if (typeof system === "string") {
    return system;
  }
  return system.map((block) => block.text).join("\n\n");
}

function systemToBlocks(system: AnthropicSystem | undefined): TextBlockParam[] {
  if (!system) {
    return [];
  }
  if (typeof system === "string") {
    return system ? [{ type: "text", text: system }] : [];
  }
  return [...system];
}

function countSystemTokens(system: AnthropicSystem | undefined): number {
  if (!system) {
    return 0;
  }
  if (typeof system === "string") {
    return countText(system);
  }
  return system.reduce((total, block) => total + countText(block.text), 0);
}

/**
 * Rendered Anthropic input (system + messages array).
 */
export interface AnthropicRenderResult {
  system?: AnthropicSystem;
  messages: MessageParam[];
}

/**
 * Tool IO contract derived from Anthropic tool block shapes.
 */
export interface AnthropicToolIO {
  callInput: ToolUseBlockParam["input"];
  resultOutput: ToolResultBlockParam["content"];
}

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
  to(
    input: ChatCompletionsInput<AnthropicToolIO>,
    context?: ProviderRenderContext
  ): AnthropicRenderResult {
    const messages: MessageParam[] = [];
    const systemBlocks: TextBlockParam[] = [];
    const { lastPinnedIndex, cacheControl } = resolveCacheControlState(context);
    let hasSystemCacheControl = false;

    for (const [index, message] of input.entries()) {
      const shouldMarkCache = index === lastPinnedIndex;
      switch (message.role) {
        case "system":
        case "developer": {
          // Anthropic uses a system field; keep system messages as text blocks.
          if (!message.content) {
            break;
          }
          const block = createTextBlock(message.content);
          const shouldApplyCache = Boolean(shouldMarkCache && cacheControl);
          const resolvedBlock = maybeApplyCacheControl(
            block,
            shouldMarkCache,
            cacheControl
          );
          hasSystemCacheControl = shouldApplyCache || hasSystemCacheControl;
          systemBlocks.push(resolvedBlock);
          break;
        }
        case "tool":
          // Tool results are represented as user tool_result blocks.
          messages.push(
            ...renderToolResultMessages(message, shouldMarkCache, cacheControl)
          );
          break;
        case "user": {
          const userMessage: { role: "user"; content: string } = {
            role: "user",
            content: message.content,
          };
          const rendered = renderUserOrAssistantMessage(
            userMessage,
            shouldMarkCache,
            cacheControl
          );
          if (rendered) {
            messages.push(rendered);
          }
          break;
        }
        case "assistant": {
          const assistantMessage: {
            role: "assistant";
            content: AnthropicAssistantContent;
          } = {
            role: "assistant",
            content: message.content,
          };
          const rendered = renderUserOrAssistantMessage(
            assistantMessage,
            shouldMarkCache,
            cacheControl
          );
          if (rendered) {
            messages.push(rendered);
          }
          break;
        }
        default:
          break;
      }
    }

    let system: AnthropicSystem | undefined;
    if (systemBlocks.length > 0) {
      system = hasSystemCacheControl
        ? systemBlocks
        : systemToString(systemBlocks);
    }
    return system ? { system, messages } : { messages };
  }

  /** Convert Anthropic input back into protocol messages. */
  from(input: AnthropicRenderResult): ChatCompletionsInput<AnthropicToolIO> {
    const output: ChatMessage<AnthropicToolIO>[] = [];
    const toolNameById = new Map<string, string>();

    const systemText = systemToString(input.system);
    if (systemText) {
      output.push({ role: "system", content: systemText });
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
  // Anthropic encodes reasoning in <thinking> blocks within assistant text.

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
      countSystemTokens(r.system) +
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
    const systemBlocks = systemToBlocks(r.system);
    const jsonInstruction = "You must respond with valid JSON only.";
    systemBlocks.push({ type: "text", text: jsonInstruction });

    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      ...(systemBlocks.length > 0 ? { system: systemBlocks } : {}),
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
