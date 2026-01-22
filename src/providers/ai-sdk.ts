import type { LanguageModel, ModelMessage } from "ai";
import { generateObject, generateText } from "ai";
import { getEncoding } from "js-tiktoken";
import type { z } from "zod";
import type {
  ChatCompletionsInput,
  ChatMessage,
} from "../protocols/chat-completions";
import { ChatCompletionsProtocol } from "../protocols/chat-completions";
import { ProtocolProvider, type ProviderAdapter } from "../provider";

const encoder = getEncoding("cl100k_base");
const countText = (text: string): number => encoder.encode(text).length;

type AiContentPart = Exclude<ModelMessage["content"], string>[number];
type AiToolCallPart = Extract<AiContentPart, { type: "tool-call" }>;
type AiToolResultPart = Extract<AiContentPart, { type: "tool-result" }>;
type AiAssistantMessage = Extract<
  ChatMessage<AiSdkToolIO>,
  { role: "assistant" }
>;
type AiAssistantContent = AiAssistantMessage["content"];
type AiAssistantPart = Exclude<AiAssistantContent, string>[number];

/**
 * Tool IO contract derived from AI SDK content part shapes.
 */
export interface AiSdkToolIO {
  callInput: AiToolCallPart["input"];
  resultOutput: AiToolResultPart["output"];
}

/**
 * Adapter between chat-completions protocol messages and AI SDK ModelMessage.
 */
export class AiSdkAdapter
  implements ProviderAdapter<ChatCompletionsInput<AiSdkToolIO>, ModelMessage[]>
{
  /** Convert protocol messages into AI SDK message array. */
  to(input: ChatCompletionsInput<AiSdkToolIO>): ModelMessage[] {
    return input.map((message) => {
      switch (message.role) {
        case "developer":
          // AI SDK treats "developer" as system content.
          return { role: "system", content: message.content };
        case "assistant":
          return {
            role: "assistant",
            content:
              typeof message.content === "string"
                ? message.content
                : [...message.content],
          };
        case "tool":
          return { role: "tool", content: [...message.content] };
        default:
          return { role: message.role, content: message.content };
      }
    });
  }

  /** Convert AI SDK messages into protocol messages. */
  from(input: ModelMessage[]): ChatCompletionsInput<AiSdkToolIO> {
    return input.flatMap((message) => {
      switch (message.role) {
        case "assistant":
          return [
            {
              role: "assistant",
              content: toAssistantContent(message.content),
            },
          ];
        case "tool":
          return parseToolMessage(message);
        default:
          return [
            {
              role: message.role,
              content: modelMessageText(message.content),
            },
          ];
      }
    });
  }
}

/** Expand a tool message into protocol tool content parts. */
function parseToolMessage(
  message: Extract<ModelMessage, { role: "tool" }>
): ChatMessage<AiSdkToolIO>[] {
  const parts = message.content.filter(
    (part): part is AiToolResultPart => part.type === "tool-result"
  );
  return parts.map((part) => ({
    role: "tool",
    content: [part],
  }));
}

/** Extract plain text from AI SDK message content. */
function modelMessageText(content: ModelMessage["content"]): string {
  if (typeof content === "string") {
    return content;
  }

  let text = "";
  for (const part of content) {
    if (part.type === "text") {
      text += part.text;
    }
  }
  return text;
}

/** Normalize AI SDK assistant content into the chat-completions protocol. */
function toAssistantContent(
  content: Extract<ModelMessage, { role: "assistant" }>["content"]
): AiAssistantContent {
  if (typeof content === "string") {
    return content;
  }

  // AI SDK assistant content may include files/approvals; drop non-chat parts.
  return content.filter(
    (part): part is AiAssistantPart =>
      part.type === "text" ||
      part.type === "reasoning" ||
      part.type === "tool-call"
  );
}

/** Count tokens for a single AI SDK message. */
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

/**
 * AI SDK provider implementation using chat-completions protocol.
 */
export class AiSdkProvider extends ProtocolProvider<
  ModelMessage[],
  ChatCompletionsInput<AiSdkToolIO>,
  AiSdkToolIO
> {
  private readonly model: LanguageModel;

  constructor(model: LanguageModel) {
    super(new ChatCompletionsProtocol<AiSdkToolIO>(), new AiSdkAdapter());
    this.model = model;
  }

  /** Count tokens for the rendered AI SDK message array. */
  countTokens(messages: ModelMessage[]): number {
    return messages.reduce((n, m) => n + countModelMessageTokens(m), 0);
  }

  /** Generate a text completion using the AI SDK model. */
  async completion(messages: ModelMessage[]): Promise<string> {
    const result = await generateText({ model: this.model, messages });
    return result.text;
  }

  /** Generate a structured object using the AI SDK model. */
  async object<T>(messages: ModelMessage[], schema: z.ZodType<T>): Promise<T> {
    const result = await generateObject({
      model: this.model,
      schema,
      messages,
    });
    return result.object;
  }
}

/** Convenience creator for the AI SDK provider. */
export function createProvider(model: LanguageModel): AiSdkProvider {
  return new AiSdkProvider(model);
}
