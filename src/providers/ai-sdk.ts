import type { LanguageModel, ModelMessage } from "ai";
import { generateObject, generateText } from "ai";
import { getEncoding } from "js-tiktoken";
import type { z } from "zod";
import { ListMessageCodec } from "../message-codec";
import type { PromptMessage } from "../types";
import { ModelProvider } from "../types";

const encoder = getEncoding("cl100k_base");
const countText = (text: string): number => encoder.encode(text).length;

type AiContentPart = Exclude<ModelMessage["content"], string>[number];
type AiToolCallPart = Extract<AiContentPart, { type: "tool-call" }>;
type AiToolResultPart = Extract<AiContentPart, { type: "tool-result" }>;

export interface AiSdkToolIO {
  callInput: AiToolCallPart["input"];
  resultOutput: AiToolResultPart["output"];
}

export class AiSdkCodec extends ListMessageCodec<ModelMessage, AiSdkToolIO> {
  protected toProviderMessage(
    message: PromptMessage<AiSdkToolIO>
  ): readonly ModelMessage[] {
    switch (message.role) {
      case "tool":
        return [
          {
            role: "tool",
            content: [
              {
                type: "tool-result",
                toolCallId: message.toolCallId,
                toolName: message.toolName,
                output: message.output,
              },
            ],
          },
        ];
      case "assistant": {
        const toolCalls = message.toolCalls ?? [];
        const content: ModelMessage["content"] =
          message.reasoning || toolCalls.length > 0
            ? [
                ...(message.text ? [{ type: "text", text: message.text }] : []),
                ...(message.reasoning
                  ? [{ type: "reasoning", text: message.reasoning }]
                  : []),
                ...toolCalls,
              ]
            : message.text;
        return [{ role: "assistant", content }];
      }
      default:
        return [{ role: message.role, content: message.text }];
    }
  }

  protected fromProviderMessage(
    message: ModelMessage
  ): readonly PromptMessage<AiSdkToolIO>[] {
    const content = normalizeContent(message.content);

    switch (message.role) {
      case "tool":
        return content.flatMap((part) =>
          part.type === "tool-result"
            ? [
                {
                  role: "tool",
                  toolCallId: part.toolCallId,
                  toolName: part.toolName,
                  output: part.output,
                },
              ]
            : []
        );
      case "assistant": {
        const { text, reasoning, toolCalls } = content.reduce(
          (acc, part) => {
            if (part.type === "text") {
              acc.text += part.text;
            } else if (part.type === "reasoning") {
              acc.reasoning += part.text;
            } else if (part.type === "tool-call") {
              acc.toolCalls.push(part);
            }
            return acc;
          },
          { text: "", reasoning: "", toolCalls: [] as AiToolCallPart[] }
        );

        return [
          {
            role: "assistant",
            text,
            ...(reasoning ? { reasoning } : {}),
            ...(toolCalls.length ? { toolCalls } : {}),
          },
        ];
      }
      default: {
        const text = content.reduce(
          (acc, part) => (part.type === "text" ? acc + part.text : acc),
          ""
        );
        return [{ role: message.role, text }];
      }
    }
  }
}

function normalizeContent(content: ModelMessage["content"]): AiContentPart[] {
  return typeof content === "string"
    ? [{ type: "text", text: content }]
    : content;
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
  readonly codec = new AiSdkCodec();
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
