import type { LanguageModel, ModelMessage, ToolResultPart } from "ai";
import { generateObject, generateText } from "ai";
import type { z } from "zod";
import { markdownRenderer } from "../renderers/markdown";
import {
  coalesceTextParts,
  collectMessageNodes,
  collectSemanticParts,
  type MessageElement,
  partsToText,
  type SemanticPart,
} from "../renderers/shared";
import type {
  ModelProvider,
  PromptElement,
  PromptRenderer,
  Tokenizer,
} from "../types";

/**
 * Renderer that outputs ModelMessage[] for use with the Vercel AI SDK.
 * Pass this to render() to get messages compatible with generateText/streamText.
 */
export const renderer: PromptRenderer<ModelMessage[]> = {
  name: "ai-sdk",
  tokenString: markdownRenderer.tokenString,
  render: (element) => renderToModelMessages(element),
  empty: () => [],
};

function renderToModelMessages(root: PromptElement): ModelMessage[] {
  const messageNodes = collectMessageNodes(root);
  const result: ModelMessage[] = [];

  for (const messageNode of messageNodes) {
    result.push(...messageNodeToModelMessages(messageNode));
  }

  return result;
}

type ToolResultSemanticPart = Extract<SemanticPart, { type: "tool-result" }>;
type NonToolSemanticPart = Exclude<SemanticPart, { type: "tool-result" }>;

type SemanticPartGroup =
  | { kind: "non-tool"; parts: NonToolSemanticPart[] }
  | { kind: "tool-result"; parts: ToolResultSemanticPart[] };

function messageNodeToModelMessages(
  messageNode: MessageElement
): ModelMessage[] {
  const parts = coalesceTextParts(collectSemanticParts(messageNode.children));
  const groups = groupSemanticParts(parts);

  const result: ModelMessage[] = [];
  for (const group of groups) {
    if (group.kind === "tool-result") {
      result.push(toToolModelMessage(group.parts));
      continue;
    }
    result.push(toModelMessage(messageNode.role, group.parts));
  }

  return result;
}

function groupSemanticParts(
  parts: readonly SemanticPart[]
): SemanticPartGroup[] {
  const groups: SemanticPartGroup[] = [];

  for (const part of parts) {
    const lastGroup = groups.at(-1);

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
  parts: readonly NonToolSemanticPart[]
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
  parts: readonly ToolResultSemanticPart[]
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

function coerceToolResultOutput(output: unknown): ToolResultPart["output"] {
  if (typeof output === "string") {
    return { type: "text", value: output };
  }

  if (isToolResultOutput(output)) {
    return output;
  }

  return { type: "json", value: safeJsonValue(output) };
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

type JsonValue =
  | null
  | string
  | number
  | boolean
  | { [key: string]: JsonValue }
  | JsonValue[];

function safeJsonValue(value: unknown): JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(safeJsonValue);
  }

  if (typeof value === "object") {
    const result: Record<string, JsonValue> = {};
    for (const [key, entry] of Object.entries(value)) {
      result[key] = safeJsonValue(entry);
    }
    return result;
  }

  return String(value);
}

/**
 * Create a ModelProvider for the Vercel AI SDK.
 *
 * @example
 * ```typescript
 * import { createProvider } from "@fastpaca/cria/ai-sdk";
 * import { openai } from "@ai-sdk/openai";
 *
 * const provider = createProvider(openai("gpt-4o"));
 * ```
 */
export function createProvider(
  model: LanguageModel,
  options: { tokenizer?: Tokenizer } = {}
): ModelProvider<ModelMessage[]> {
  return {
    name: "ai-sdk",
    ...(options.tokenizer ? { tokenizer: options.tokenizer } : {}),
    renderer,

    async completion(messages) {
      const { text } = await generateText({ model, messages });
      return text;
    },

    async object<T>(messages: ModelMessage[], schema: z.ZodType<T>) {
      const { object } = await generateObject({ model, messages, schema });
      return object;
    },
  };
}
