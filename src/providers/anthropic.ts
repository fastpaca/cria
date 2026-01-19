import type Anthropic from "@anthropic-ai/sdk";
import type {
  ContentBlockParam,
  MessageParam,
  Model,
} from "@anthropic-ai/sdk/resources/messages";
import type { z } from "zod";
import { countText, safeStringify } from "../renderers/shared";
import type { PromptLayout, PromptMessage, ToolCallPart } from "../types";
import { ModelProvider, PromptRenderer } from "../types";

export interface AnthropicRenderResult {
  system?: string;
  messages: MessageParam[];
}

export class AnthropicRenderer extends PromptRenderer<AnthropicRenderResult> {
  override render(layout: PromptLayout): AnthropicRenderResult {
    const messages: MessageParam[] = [];
    let system = "";

    for (const message of layout) {
      const rendered = renderAnthropicMessage(message);
      if (rendered.systemText) {
        system = appendSystemText(system, rendered.systemText);
      }
      if (rendered.message) {
        messages.push(rendered.message);
      }
    }

    return system ? { system, messages } : { messages };
  }

  override historyToLayout(rendered: AnthropicRenderResult): PromptLayout {
    return parseAnthropicHistory(rendered);
  }
}

interface RenderedAnthropicMessage {
  systemText?: string;
  message?: MessageParam;
}

function renderAnthropicMessage(
  message: PromptMessage
): RenderedAnthropicMessage {
  if (message.role === "system") {
    return { systemText: (message as { text: string }).text };
  }

  if (message.role === "tool") {
    const toolMessage = message as Extract<PromptMessage, { role: "tool" }>;
    return { message: renderToolResultMessage(toolMessage) };
  }

  if (message.role === "assistant") {
    const assistantMessage = message as Extract<
      PromptMessage,
      { role: "assistant" }
    >;
    const rendered = renderAssistantMessage(assistantMessage);
    return rendered ? { message: rendered } : {};
  }

  const rendered = renderUserMessage((message as { text: string }).text);
  return rendered ? { message: rendered } : {};
}

function renderUserMessage(text: string): MessageParam | undefined {
  const content = buildContent(text, undefined, undefined, false);
  if (content.length === 0) {
    return undefined;
  }
  return { role: "user", content };
}

function renderAssistantMessage(
  message: Extract<PromptMessage, { role: "assistant" }>
): MessageParam | undefined {
  const content = buildContent(
    message.text,
    message.reasoning,
    message.toolCalls,
    true
  );
  if (content.length === 0) {
    return undefined;
  }
  return { role: "assistant", content };
}

function renderToolResultMessage(
  message: Extract<PromptMessage, { role: "tool" }>
): MessageParam {
  return {
    role: "user",
    content: [
      {
        type: "tool_result",
        tool_use_id: message.toolCallId,
        content: safeStringify(message.output),
      },
    ],
  };
}

function parseAnthropicHistory(rendered: AnthropicRenderResult): PromptLayout {
  const layout: PromptMessage[] = [];
  const toolNameById = new Map<string, string>();

  if (rendered.system) {
    layout.push({ role: "system", text: rendered.system });
  }

  for (const message of rendered.messages) {
    layout.push(...parseAnthropicMessage(message, toolNameById));
  }

  return layout;
}

function parseAnthropicMessage(
  message: MessageParam,
  toolNameById: Map<string, string>
): PromptMessage[] {
  if (message.role === "assistant") {
    return [parseAnthropicAssistantMessage(message, toolNameById)];
  }
  if (message.role === "user") {
    return parseAnthropicUserMessage(message, toolNameById);
  }
  return [];
}

function parseAnthropicAssistantMessage(
  message: MessageParam,
  toolNameById: Map<string, string>
): PromptMessage {
  if (message.role !== "assistant") {
    throw new Error("Expected an assistant message.");
  }

  if (typeof message.content === "string") {
    return { role: "assistant", text: message.content };
  }

  const { text, toolCalls } = collectAnthropicAssistantParts(
    message.content,
    toolNameById
  );
  const assistant: Extract<PromptMessage, { role: "assistant" }> = {
    role: "assistant",
    text,
  };
  if (toolCalls.length > 0) {
    assistant.toolCalls = toolCalls;
  }
  return assistant;
}

function collectAnthropicAssistantParts(
  blocks: ContentBlockParam[],
  toolNameById: Map<string, string>
): { text: string; toolCalls: ToolCallPart[] } {
  let text = "";
  const toolCalls: ToolCallPart[] = [];

  for (const block of blocks) {
    if (block.type === "text") {
      text += block.text;
      continue;
    }
    if (block.type === "tool_use") {
      toolNameById.set(block.id, block.name);
      toolCalls.push({
        type: "tool-call",
        toolCallId: block.id,
        toolName: block.name,
        input: block.input,
      });
    }
  }

  return { text, toolCalls };
}

function parseAnthropicUserMessage(
  message: MessageParam,
  toolNameById: Map<string, string>
): PromptMessage[] {
  if (message.role !== "user") {
    throw new Error("Expected a user message.");
  }

  if (typeof message.content === "string") {
    return [{ role: "user", text: message.content }];
  }

  return parseAnthropicUserBlocks(message.content, toolNameById);
}

function parseAnthropicUserBlocks(
  blocks: ContentBlockParam[],
  toolNameById: Map<string, string>
): PromptMessage[] {
  const messages: PromptMessage[] = [];
  let text = "";

  for (const block of blocks) {
    if (block.type === "text") {
      text += block.text;
      continue;
    }
    if (block.type === "tool_result") {
      if (text) {
        messages.push({ role: "user", text });
        text = "";
      }
      messages.push({
        role: "tool",
        toolCallId: block.tool_use_id,
        toolName: toolNameById.get(block.tool_use_id) ?? "",
        output: block.content,
      });
    }
  }

  if (text) {
    messages.push({ role: "user", text });
  }

  return messages;
}

function appendSystemText(current: string, next: string): string {
  if (!next) {
    return current;
  }
  return current ? `${current}\n\n${next}` : next;
}

function buildContent(
  text: string,
  reasoning: string | undefined,
  toolCalls:
    | readonly { toolCallId: string; toolName: string; input: unknown }[]
    | undefined,
  includeToolCalls: boolean
): ContentBlockParam[] {
  const content: ContentBlockParam[] = [];
  let textBlock = text;

  if (reasoning) {
    textBlock += `<thinking>\n${reasoning}\n</thinking>`;
  }

  if (textBlock) {
    content.push({ type: "text", text: textBlock });
  }

  if (includeToolCalls && toolCalls) {
    for (const tc of toolCalls) {
      content.push({
        type: "tool_use",
        id: tc.toolCallId,
        name: tc.toolName,
        input: tc.input,
      });
    }
  }

  return content;
}

function countContentBlockTokens(b: ContentBlockParam): number {
  if (b.type === "text") {
    return countText(b.text);
  }
  if (b.type === "tool_use") {
    return countText(b.name + safeStringify(b.input));
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
