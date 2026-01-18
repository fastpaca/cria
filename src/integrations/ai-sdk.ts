import type { LanguageModel, ModelMessage, ToolResultPart } from "ai";
import { generateObject, generateText } from "ai";
import { getEncoding } from "js-tiktoken";
import type { z } from "zod";
import {
  coalesceTextParts,
  partsToText,
  safeStringify,
} from "../renderers/shared";
import type { PromptLayout, PromptPart } from "../types";
import { ModelProvider, PromptRenderer } from "../types";

const encoder = getEncoding("cl100k_base");
const countText = (text: string): number => encoder.encode(text).length;

export class AiSdkRenderer extends PromptRenderer<ModelMessage[]> {
  render(layout: PromptLayout): ModelMessage[] {
    const messages: ModelMessage[] = [];

    for (const message of layout.messages) {
      const nextMessages = partsToModelMessages(message.role, message.parts);
      messages.push(...nextMessages);
    }

    return messages;
  }
}

type ToolResultPromptPart = Extract<PromptPart, { type: "tool-result" }>;
type NonToolPromptPart = Exclude<PromptPart, { type: "tool-result" }>;

type PartGroup =
  | { kind: "non-tool"; parts: NonToolPromptPart[] }
  | { kind: "tool-result"; parts: ToolResultPromptPart[] };

function partsToModelMessages(
  role: string,
  parts: readonly PromptPart[]
): ModelMessage[] {
  const groups = groupParts(coalesceTextParts(parts));

  const result: ModelMessage[] = [];
  for (const group of groups) {
    if (group.kind === "tool-result") {
      result.push(toToolModelMessage(group.parts));
      continue;
    }
    result.push(toModelMessage(role, group.parts));
  }

  return result;
}

function groupParts(parts: readonly PromptPart[]): PartGroup[] {
  const groups: PartGroup[] = [];

  for (const part of parts) {
    const lastGroup = groups.at(-1);

    // AI SDK tool results must be emitted as separate role="tool" messages.
    if (part.type === "tool-result") {
      if (lastGroup?.kind === "tool-result") {
        lastGroup.parts.push(part);
      } else {
        groups.push({ kind: "tool-result", parts: [part] });
      }
      continue;
    }

    if (lastGroup?.kind === "non-tool") {
      lastGroup.parts.push(part);
    } else {
      groups.push({ kind: "non-tool", parts: [part] });
    }
  }

  return groups;
}

function toModelMessage(
  role: string,
  parts: readonly NonToolPromptPart[]
): ModelMessage {
  if (role === "system") {
    return { role: "system", content: partsToText(parts) };
  }

  if (role === "user") {
    return { role: "user", content: partsToText(parts) };
  }

  type AssistantModelMessage = Extract<ModelMessage, { role: "assistant" }>;
  type AssistantContent = AssistantModelMessage["content"];
  type AssistantContentPart =
    Exclude<AssistantContent, string> extends readonly (infer Part)[]
      ? Part
      : never;

  const content: AssistantContentPart[] = [];
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
    }
  }

  return { role: "assistant", content };
}

function toToolModelMessage(
  parts: readonly ToolResultPromptPart[]
): ModelMessage {
  const content: ToolResultPart[] = [];
  for (const part of parts) {
    content.push({
      type: "tool-result",
      toolCallId: part.toolCallId,
      toolName: part.toolName,
      output: coerceToolResultOutput(part.output),
    });
  }
  return { role: "tool", content };
}

function countModelMessageTokens(message: ModelMessage): number {
  if (typeof message.content === "string") {
    return countText(message.content);
  }

  let tokens = 0;
  for (const part of message.content) {
    if (part.type === "text") {
      tokens += countText(part.text);
    } else if (part.type === "reasoning") {
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

interface ToolResultOutputLike {
  type: unknown;
  value?: unknown;
  reason?: unknown;
}

function isToolResultOutput(value: unknown): value is ToolResultPart["output"] {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const output = value as ToolResultOutputLike;

  if (typeof output.type !== "string") {
    return false;
  }

  switch (output.type) {
    case "text":
    case "error-text":
      return typeof output.value === "string";
    case "json":
    case "error-json":
      return output.value !== undefined;
    case "execution-denied":
      return output.reason === undefined || typeof output.reason === "string";
    case "content":
      return Array.isArray(output.value);
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
