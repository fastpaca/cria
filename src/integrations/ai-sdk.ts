import type {
  AssistantContent,
  LanguageModel,
  ModelMessage,
  ToolResultPart,
} from "ai";
import { generateObject, generateText } from "ai";
import { getEncoding } from "js-tiktoken";
import type { z } from "zod";
import {
  coalesceTextParts,
  partsToText,
  safeStringify,
} from "../renderers/shared";
import type { PromptLayout, PromptMessage, PromptPart } from "../types";
import { ModelProvider, PromptRenderer } from "../types";

const encoder = getEncoding("cl100k_base");
const countText = (text: string): number => encoder.encode(text).length;

/** AI SDK content part types that can appear in assistant messages. */
type AssistantPart = Exclude<AssistantContent, string>[number];

export class AiSdkRenderer extends PromptRenderer<ModelMessage[]> {
  render(layout: PromptLayout): ModelMessage[] {
    const messages: ModelMessage[] = [];
    for (const message of layout.messages) {
      messages.push(toModelMessage(message));
    }
    return messages;
  }
}

function toModelMessage(message: PromptMessage): ModelMessage {
  const coalesced = coalesceTextParts(message.parts);

  switch (message.role) {
    case "system":
      return toSystemMessage(coalesced);
    case "user":
      return toUserMessage(coalesced);
    case "assistant":
      return toAssistantMessage(coalesced);
    case "tool":
      return toToolMessage(coalesced);
    default:
      throw new Error(
        `Unsupported role "${message.role}" for AI SDK renderer.`
      );
  }
}

function toSystemMessage(parts: readonly PromptPart[]): ModelMessage {
  return { role: "system", content: partsToText(parts) };
}

function toUserMessage(parts: readonly PromptPart[]): ModelMessage {
  return { role: "user", content: partsToText(parts) };
}

function toAssistantMessage(parts: readonly PromptPart[]): ModelMessage {
  const content: AssistantPart[] = [];
  for (const part of parts) {
    if (part.type === "text") {
      content.push({ type: "text", text: part.text });
    } else if (part.type === "reasoning") {
      content.push({ type: "reasoning", text: part.text });
    } else if (part.type === "tool-call") {
      content.push({
        type: "tool-call",
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        input: part.input,
      });
    } else if (part.type === "tool-result") {
      throw new Error("Tool results must be inside tool messages.");
    }
  }
  return { role: "assistant", content };
}

function toToolMessage(parts: readonly PromptPart[]): ModelMessage {
  const toolResult = parts[0];
  if (!toolResult || toolResult.type !== "tool-result") {
    throw new Error("Tool messages must contain a tool result.");
  }
  const content: ToolResultPart[] = [
    {
      type: "tool-result",
      toolCallId: toolResult.toolCallId,
      toolName: toolResult.toolName,
      output: coerceToolResultOutput(toolResult.output),
    },
  ];
  return { role: "tool", content };
}

function countModelMessageTokens(message: ModelMessage): number {
  if (typeof message.content === "string") {
    return countText(message.content);
  }

  let tokens = 0;
  for (const part of message.content) {
    if (part.type === "text" || part.type === "reasoning") {
      tokens += countText(part.text);
    } else if (part.type === "tool-call") {
      tokens += countText(part.toolName + safeStringify(part.input));
    } else if (part.type === "tool-result") {
      tokens += countText(safeStringify(part.output));
    }
  }
  return tokens;
}

function coerceToolResultOutput(output: unknown): ToolResultPart["output"] {
  if (typeof output === "string") {
    return { type: "text", value: output };
  }
  if (isToolResultOutput(output)) {
    return output;
  }
  return { type: "text", value: safeStringify(output) };
}

function isToolResultOutput(value: unknown): value is ToolResultPart["output"] {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const v = value as { type?: unknown; value?: unknown; reason?: unknown };
  if (typeof v.type !== "string") {
    return false;
  }
  switch (v.type) {
    case "text":
    case "error-text":
      return typeof v.value === "string";
    case "json":
    case "error-json":
      return v.value !== undefined;
    case "execution-denied":
      return v.reason === undefined || typeof v.reason === "string";
    case "content":
      return Array.isArray(v.value);
    default:
      return false;
  }
}

export class AiSdkProvider extends ModelProvider<ModelMessage[]> {
  readonly renderer = new AiSdkRenderer();
  private readonly model: LanguageModel;

  constructor(model: LanguageModel) {
    super();
    this.model = model;
  }

  countTokens(messages: ModelMessage[]): number {
    let tokens = 0;
    for (const message of messages) {
      tokens += countModelMessageTokens(message);
    }
    return tokens;
  }

  async completion(messages: ModelMessage[]): Promise<string> {
    const result = await generateText({
      model: this.model,
      messages,
    });
    return result.text;
  }

  async object<T>(messages: ModelMessage[], schema: z.ZodType<T>): Promise<T> {
    const result = await generateObject({
      model: this.model,
      schema,
      messages,
    });
    return result.object;
  }
}

export function createProvider(model: LanguageModel): AiSdkProvider {
  return new AiSdkProvider(model);
}
