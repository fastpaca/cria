import type { LanguageModel, ModelMessage, ToolResultPart } from "ai";
import { generateObject, generateText } from "ai";
import { getEncoding } from "js-tiktoken";
import type { z } from "zod";
import { safeStringify } from "../renderers/shared";
import type { PromptLayout, PromptMessage, PromptPart } from "../types";
import { ModelProvider, PromptRenderer } from "../types";

const encoder = getEncoding("cl100k_base");
const countText = (text: string): number => encoder.encode(text).length;

export class AiSdkRenderer extends PromptRenderer<ModelMessage[]> {
  render(layout: PromptLayout): ModelMessage[] {
    return layout.map(renderModelMessage);
  }
}

const coerce = (output: unknown): ToolResultPart["output"] => {
  if (typeof output === "string") {
    return { type: "text", value: output };
  }

  if (hasOutputShape(output)) {
    return output;
  }

  return { type: "text", value: safeStringify(output) };
};

function renderModelMessage(message: PromptMessage): ModelMessage {
  if (message.role === "tool") {
    return renderToolMessage(message);
  }

  if (message.role === "assistant") {
    return renderAssistantMessage(message);
  }

  return { role: message.role as ModelMessage["role"], content: message.text };
}

function renderToolMessage(
  message: Extract<PromptMessage, { role: "tool" }>
): ModelMessage {
  return {
    role: "tool",
    content: [
      {
        type: "tool-result",
        toolCallId: message.toolCallId,
        toolName: message.toolName,
        output: coerce(message.output),
      },
    ],
  };
}

function renderAssistantMessage(
  message: Extract<PromptMessage, { role: "assistant" }>
): ModelMessage {
  const parts: PromptPart[] = [];
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

const hasOutputShape = (v: unknown): v is ToolResultPart["output"] =>
  typeof v === "object" &&
  v !== null &&
  "type" in v &&
  typeof (v as { type: unknown }).type === "string";

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

export class AiSdkProvider extends ModelProvider<ModelMessage[]> {
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
