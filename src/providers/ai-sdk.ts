import type { LanguageModel, ModelMessage } from "ai";
import { generateObject, generateText } from "ai";
import type { z } from "zod";
import { countText } from "../renderers/shared";
import type {
  PromptLayout,
  PromptMessage,
  PromptPart,
  ToolCallPart as PromptToolCallPart,
} from "../types";
import { ModelProvider, PromptRenderer } from "../types";

type AiContentPart = Exclude<ModelMessage["content"], string>[number];
type AiToolCallPart = Extract<AiContentPart, { type: "tool-call" }>;
type AiToolResultPart = Extract<AiContentPart, { type: "tool-result" }>;
type AiTextPart = Extract<AiContentPart, { type: "text" }>;
type AiReasoningPart = Extract<AiContentPart, { type: "reasoning" }>;

export interface AiSdkToolIO {
  callInput: AiToolCallPart["input"];
  resultOutput: AiToolResultPart["output"];
}

export class AiSdkRenderer extends PromptRenderer<ModelMessage[], AiSdkToolIO> {
  override render(layout: PromptLayout<AiSdkToolIO>): ModelMessage[] {
    /*
    AI SDK expects message "content" as either a string or a parts array.
    PromptLayout already normalized our semantic messages, so here we simply
    re-expand assistant/tool messages into the parts form the SDK requires.
    */
    return layout.map(renderModelMessage);
  }

  override historyToLayout(
    messages: ModelMessage[]
  ): PromptLayout<AiSdkToolIO> {
    return parseAiSdkHistory(messages);
  }
}

function renderModelMessage(message: PromptMessage<AiSdkToolIO>): ModelMessage {
  if (message.role === "tool") {
    return renderToolMessage(message);
  }

  if (message.role === "assistant") {
    return renderAssistantMessage(message);
  }

  return { role: message.role, content: message.text };
}

function renderToolMessage(
  message: Extract<PromptMessage<AiSdkToolIO>, { role: "tool" }>
): ModelMessage {
  return {
    role: "tool",
    content: [
      {
        type: "tool-result",
        toolCallId: message.toolCallId,
        toolName: message.toolName,
        output: message.output,
      },
    ],
  };
}

function renderAssistantMessage(
  message: Extract<PromptMessage<AiSdkToolIO>, { role: "assistant" }>
): ModelMessage {
  const parts: PromptPart<AiSdkToolIO>[] = [];
  if (message.text) {
    parts.push({ type: "text", text: message.text });
  }
  if (message.reasoning) {
    parts.push({ type: "reasoning", text: message.reasoning });
  }
  if (message.toolCalls) {
    parts.push(...message.toolCalls);
  }

  if (parts.length === 1 && parts[0]?.type === "text") {
    return { role: "assistant", content: parts[0].text };
  }

  return { role: "assistant", content: parts } as ModelMessage;
}

const isAiToolCallPart = (part: AiContentPart): part is AiToolCallPart =>
  part.type === "tool-call";

const isAiToolResultPart = (part: AiContentPart): part is AiToolResultPart =>
  part.type === "tool-result";

const isAiTextPart = (part: AiContentPart): part is AiTextPart =>
  part.type === "text";

const isAiReasoningPart = (part: AiContentPart): part is AiReasoningPart =>
  part.type === "reasoning";

function parseAiSdkHistory(
  messages: ModelMessage[]
): PromptLayout<AiSdkToolIO> {
  return messages.flatMap(parseAiSdkMessage);
}

function parseAiSdkMessage(
  message: ModelMessage
): PromptMessage<AiSdkToolIO>[] {
  if (message.role === "assistant") {
    return [parseAiSdkAssistant(message)];
  }
  if (message.role === "tool") {
    return [parseAiSdkTool(message)];
  }
  return [parseAiSdkTextMessage(message)];
}

function parseAiSdkAssistant(
  message: Extract<ModelMessage, { role: "assistant" }>
): PromptMessage<AiSdkToolIO> {
  if (typeof message.content === "string") {
    return { role: "assistant", text: message.content };
  }

  const { text, reasoning, toolCalls } = collectAiSdkAssistantParts(
    message.content
  );
  const assistant: Extract<
    PromptMessage<AiSdkToolIO>,
    { role: "assistant" }
  > = {
    role: "assistant",
    text,
  };
  if (reasoning) {
    assistant.reasoning = reasoning;
  }
  if (toolCalls.length > 0) {
    assistant.toolCalls = toolCalls;
  }
  return assistant;
}

function parseAiSdkTool(
  message: Extract<ModelMessage, { role: "tool" }>
): PromptMessage<AiSdkToolIO> {
  if (typeof message.content === "string") {
    return {
      role: "tool",
      toolCallId: "unknown",
      toolName: "unknown",
      output: message.content,
    };
  }

  const toolResult = message.content.find(isAiToolResultPart);
  if (!toolResult) {
    throw new Error("Tool history must include tool-result parts.");
  }
  return {
    role: "tool",
    toolCallId: toolResult.toolCallId,
    toolName: toolResult.toolName,
    output: toolResult.output,
  };
}

function parseAiSdkTextMessage(
  message: Extract<ModelMessage, { role: "system" | "user" }>
): PromptMessage<AiSdkToolIO> {
  if (typeof message.content === "string") {
    return { role: message.role, text: message.content };
  }

  return { role: message.role, text: textFromParts(message.content) };
}

function collectAiSdkAssistantParts(parts: AiContentPart[]): {
  text: string;
  reasoning: string;
  toolCalls: PromptToolCallPart<AiSdkToolIO>[];
} {
  let text = "";
  let reasoning = "";
  const toolCalls: PromptToolCallPart<AiSdkToolIO>[] = [];

  for (const part of parts) {
    if (isAiTextPart(part)) {
      text += part.text;
      continue;
    }
    if (isAiReasoningPart(part)) {
      reasoning += part.text;
      continue;
    }
    if (isAiToolCallPart(part)) {
      toolCalls.push({
        type: "tool-call",
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        input: part.input,
      });
    }
  }

  return { text, reasoning, toolCalls };
}

function textFromParts(parts: AiContentPart[]): string {
  return parts
    .filter(isAiTextPart)
    .map((part) => part.text)
    .join("");
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
      const input =
        typeof part.input === "string"
          ? part.input
          : JSON.stringify(part.input);
      tokens += countText(part.toolName + input);
    } else if (part.type === "tool-result") {
      const output =
        typeof part.output === "string"
          ? part.output
          : JSON.stringify(part.output);
      tokens += countText(output);
    }
  }
  return tokens;
}

export class AiSdkProvider extends ModelProvider<ModelMessage[], AiSdkToolIO> {
  readonly renderer = new AiSdkRenderer();
  private readonly model: LanguageModel;

  constructor(model: LanguageModel) {
    super();
    this.model = model;
  }

  countTokens(messages: ModelMessage[]): number {
    return messages.reduce((n, m) => n + countModelMessageTokens(m), 0);
  }

  async completion(messages: ModelMessage[]): Promise<string> {
    const result = await generateText({ model: this.model, messages });
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
