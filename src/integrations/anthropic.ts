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
import {
  coalesceTextParts,
  partsToText,
  safeStringify,
} from "../renderers/shared";
import type {
  PromptLayout,
  PromptPart,
  ToolCallPart,
  ToolResultPart,
} from "../types";
import { ModelProvider, PromptRenderer } from "../types";

const encoder = getEncoding("cl100k_base");
const countText = (text: string): number => encoder.encode(text).length;

export interface AnthropicRenderResult {
  system?: string;
  messages: MessageParam[];
}

export class AnthropicRenderer extends PromptRenderer<AnthropicRenderResult> {
  render(layout: PromptLayout): AnthropicRenderResult {
    const messages: MessageParam[] = [];
    let systemText = "";

    const appendSystemParts = (parts: readonly PromptPart[]) => {
      // Anthropic uses a single system string; merge all system messages into it.
      const nextSystem = partsToText(parts, { wrapReasoning: true });
      if (nextSystem.length === 0) {
        return;
      }
      systemText =
        systemText.length > 0 ? `${systemText}\n\n${nextSystem}` : nextSystem;
    };

    const appendRoleMessages = (role: string, parts: readonly PromptPart[]) => {
      const coalesced = coalesceTextParts(parts);
      if (role === "user") {
        messages.push(...buildUserMessages(coalesced));
        return;
      }
      if (role === "assistant") {
        messages.push(...buildAssistantMessages(coalesced));
        return;
      }
      if (role === "tool") {
        const toolResult = coalesced[0];
        if (!toolResult || toolResult.type !== "tool-result") {
          throw new Error("Tool messages must contain a tool result.");
        }
        messages.push(toToolResultMessage(toolResult));
        return;
      }
      throw new Error(`Unsupported role "${role}" for Anthropic.`);
    };

    for (const message of layout.messages) {
      if (message.role === "system") {
        appendSystemParts(message.parts);
      } else {
        appendRoleMessages(message.role, message.parts);
      }
    }

    return {
      ...(systemText.length > 0 ? { system: systemText } : {}),
      messages,
    };
  }
}

function buildUserMessages(parts: readonly PromptPart[]): MessageParam[] {
  const content = buildUserContent(parts);
  if (content.length === 0) {
    return [];
  }

  return [{ role: "user", content }];
}

function buildUserContent(parts: readonly PromptPart[]): ContentBlockParam[] {
  const content: ContentBlockParam[] = [];
  let textBuffer = "";

  const flushTextBuffer = () => {
    if (textBuffer.length > 0) {
      content.push({ type: "text", text: textBuffer });
      textBuffer = "";
    }
  };

  for (const part of parts) {
    if (part.type === "text") {
      textBuffer += part.text;
    } else if (part.type === "reasoning") {
      textBuffer += `<thinking>\n${part.text}\n</thinking>`;
    }
  }

  flushTextBuffer();
  return content;
}

function buildAssistantMessages(parts: readonly PromptPart[]): MessageParam[] {
  const content = buildAssistantContent(parts);
  if (content.length === 0) {
    return [];
  }
  return [{ role: "assistant", content }];
}

function buildAssistantContent(
  parts: readonly PromptPart[]
): ContentBlockParam[] {
  const content: ContentBlockParam[] = [];
  let textBuffer = "";

  const flushTextBuffer = () => {
    if (textBuffer.length > 0) {
      content.push({ type: "text", text: textBuffer });
      textBuffer = "";
    }
  };

  for (const part of parts) {
    if (part.type === "text") {
      textBuffer += part.text;
    } else if (part.type === "reasoning") {
      textBuffer += `<thinking>\n${part.text}\n</thinking>`;
    } else if (part.type === "tool-call") {
      flushTextBuffer();
      content.push(toToolUseBlock(part));
    } else if (part.type === "tool-result") {
      throw new Error("Tool results must be inside tool messages.");
    }
  }

  flushTextBuffer();
  return content;
}

function toToolResultMessage(part: ToolResultPart): MessageParam {
  return {
    role: "user",
    content: [toToolResultBlock(part)],
  };
}

function toToolUseBlock(part: ToolCallPart): ToolUseBlockParam {
  return {
    type: "tool_use",
    id: part.toolCallId,
    name: part.toolName,
    input: part.input,
  };
}

function toToolResultBlock(part: ToolResultPart): ToolResultBlockParam {
  return {
    type: "tool_result",
    tool_use_id: part.toolCallId,
    content: safeStringify(part.output),
  };
}

function countToolResultContentTokens(
  content: ToolResultBlockParam["content"]
): number {
  if (typeof content === "string") {
    return countText(content);
  }

  if (Array.isArray(content)) {
    return content.reduce((sum, entry) => {
      if (entry.type === "text") {
        return sum + countText(entry.text);
      }
      return sum;
    }, 0);
  }

  return 0;
}

function countContentBlockTokens(block: ContentBlockParam): number {
  switch (block.type) {
    case "text":
      return countText(block.text);
    case "tool_use":
      return countText(block.name + safeStringify(block.input));
    case "tool_result":
      return countToolResultContentTokens(block.content);
    default:
      return 0;
  }
}

function countAnthropicMessageTokens(message: MessageParam): number {
  if (typeof message.content === "string") {
    return countText(message.content);
  }

  return message.content.reduce(
    (sum, block) => sum + countContentBlockTokens(block),
    0
  );
}

function extractTextFromResponse(
  content: Anthropic.Messages.ContentBlock[]
): string {
  return content
    .filter(
      (block): block is Anthropic.Messages.TextBlock => block.type === "text"
    )
    .map((block) => block.text)
    .join("");
}

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

  countTokens(rendered: AnthropicRenderResult): number {
    let tokens = 0;

    if (rendered.system) {
      tokens += countText(rendered.system);
    }

    for (const message of rendered.messages) {
      tokens += countAnthropicMessageTokens(message);
    }

    return tokens;
  }

  async completion(rendered: AnthropicRenderResult): Promise<string> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      ...(rendered.system ? { system: rendered.system } : {}),
      messages: rendered.messages,
    });
    return extractTextFromResponse(response.content);
  }

  async object<T>(
    rendered: AnthropicRenderResult,
    schema: z.ZodType<T>
  ): Promise<T> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      system: `${rendered.system ?? ""}\n\nYou must respond with valid JSON only.`,
      messages: rendered.messages,
    });
    const text = extractTextFromResponse(response.content);
    return schema.parse(JSON.parse(text));
  }
}

export function createProvider(
  client: Anthropic,
  model: Model,
  options: { maxTokens?: number } = {}
): AnthropicProvider {
  const maxTokens = options.maxTokens ?? 1024;
  return new AnthropicProvider(client, model, maxTokens);
}
