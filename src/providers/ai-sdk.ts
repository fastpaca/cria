import type { LanguageModel, ModelMessage } from "ai";
import { generateObject, generateText } from "ai";
import { getEncoding } from "js-tiktoken";
import type { z } from "zod";
import type { PromptLayout, PromptMessage, PromptPart } from "../types";
import { ModelProvider, PromptRenderer } from "../types";

const encoder = getEncoding("cl100k_base");
const countText = (text: string): number => encoder.encode(text).length;

type AiContentPart = Exclude<ModelMessage["content"], string>[number];
type AiToolCallPart = Extract<AiContentPart, { type: "tool-call" }>;
type AiToolResultPart = Extract<AiContentPart, { type: "tool-result" }>;

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
