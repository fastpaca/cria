import type { LanguageModel, ModelMessage } from "ai";
import { generateObject, generateText } from "ai";
import { getEncoding } from "js-tiktoken";
import type { z } from "zod";
import type {
  ChatCompletionsInput,
  ChatMessage,
} from "../protocols/chat-completions";
import { ChatCompletionsProtocol } from "../protocols/chat-completions";
import type { ProviderAdapter } from "../provider-adapter";
import { ProtocolProvider } from "../provider-adapter";

const encoder = getEncoding("cl100k_base");
const countText = (text: string): number => encoder.encode(text).length;

type AiContentPart = Exclude<ModelMessage["content"], string>[number];
type AiToolCallPart = Extract<AiContentPart, { type: "tool-call" }>;
type AiToolResultPart = Extract<AiContentPart, { type: "tool-result" }>;

export interface AiSdkToolIO {
  callInput: AiToolCallPart["input"];
  resultOutput: AiToolResultPart["output"];
}

export class AiSdkAdapter
  implements ProviderAdapter<ChatCompletionsInput<AiSdkToolIO>, ModelMessage[]>
{
  toProvider(input: ChatCompletionsInput<AiSdkToolIO>): ModelMessage[] {
    return input.map((message) => {
      if (message.role === "developer") {
        return { role: "system", content: message.content };
      }

      if (message.role === "assistant") {
        return { role: "assistant", content: message.content };
      }

      if (message.role === "tool") {
        return { role: "tool", content: message.content };
      }

      return { role: message.role, content: message.content };
    });
  }

  fromProvider(input: ModelMessage[]): ChatCompletionsInput<AiSdkToolIO> {
    return input.flatMap((message) => {
      switch (message.role) {
        case "assistant":
          return [
            {
              role: "assistant",
              content: message.content,
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
