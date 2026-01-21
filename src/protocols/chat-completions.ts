import { MessageCodec } from "../message-codec";
import type {
  PromptLayout,
  PromptMessage,
  ProviderToolIO,
  ToolCallPart,
  ToolResultPart,
} from "../types";

interface ChatTextPart {
  type: "text";
  text: string;
}

interface ChatReasoningPart {
  type: "reasoning";
  text: string;
}

type ChatAssistantContentPart<TToolIO extends ProviderToolIO> =
  | ChatTextPart
  | ChatReasoningPart
  | ToolCallPart<TToolIO>;

type ChatToolContentPart<TToolIO extends ProviderToolIO> =
  ToolResultPart<TToolIO>;

export type ChatRole = "system" | "developer" | "user" | "assistant" | "tool";

export type ChatMessage<TToolIO extends ProviderToolIO> =
  | {
      role: "system" | "developer" | "user";
      content: string;
    }
  | {
      role: "assistant";
      content: string | readonly ChatAssistantContentPart<TToolIO>[];
    }
  | {
      role: "tool";
      content: readonly ChatToolContentPart<TToolIO>[];
    };

export type ChatCompletionsInput<TToolIO extends ProviderToolIO> =
  readonly ChatMessage<TToolIO>[];

export class ChatCompletionsProtocol<
  TToolIO extends ProviderToolIO,
> extends MessageCodec<ChatCompletionsInput<TToolIO>, TToolIO> {
  override render(
    layout: PromptLayout<TToolIO>
  ): ChatCompletionsInput<TToolIO> {
    return layout.map((message) => renderChatMessage(message));
  }

  override parse(
    rendered: ChatCompletionsInput<TToolIO>
  ): PromptLayout<TToolIO> {
    return rendered.flatMap((message) => parseChatMessage(message));
  }
}

function renderChatMessage<TToolIO extends ProviderToolIO>(
  message: PromptMessage<TToolIO>
): ChatMessage<TToolIO> {
  switch (message.role) {
    case "assistant": {
      const parts: ChatAssistantContentPart<TToolIO>[] = [];
      if (message.text) {
        parts.push({ type: "text", text: message.text });
      }
      if (message.reasoning) {
        parts.push({ type: "reasoning", text: message.reasoning });
      }
      if (message.toolCalls) {
        parts.push(...message.toolCalls);
      }

      if (parts.length > 0) {
        return { role: "assistant", content: parts };
      }

      return { role: "assistant", content: message.text };
    }
    case "tool":
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
    default:
      return { role: message.role, content: message.text };
  }
}

function parseChatMessage<TToolIO extends ProviderToolIO>(
  message: ChatMessage<TToolIO>
): readonly PromptMessage<TToolIO>[] {
  switch (message.role) {
    case "assistant":
      return [parseAssistantMessage(message.content)];
    case "tool":
      return parseToolMessage(message.content);
    default:
      return [{ role: message.role, text: message.content }];
  }
}

function parseAssistantMessage<TToolIO extends ProviderToolIO>(
  content: string | readonly ChatAssistantContentPart<TToolIO>[]
): PromptMessage<TToolIO> {
  if (typeof content === "string") {
    return { role: "assistant", text: content };
  }

  const toolCalls: ToolCallPart<TToolIO>[] = [];
  let text = "";
  let reasoning = "";

  for (const part of content) {
    if (part.type === "text") {
      text += part.text;
    } else if (part.type === "reasoning") {
      reasoning += part.text;
    } else if (part.type === "tool-call") {
      toolCalls.push(part);
    }
  }

  const assistant: PromptMessage<TToolIO> = { role: "assistant", text };
  if (reasoning) {
    assistant.reasoning = reasoning;
  }
  if (toolCalls.length > 0) {
    assistant.toolCalls = toolCalls;
  }
  return assistant;
}

function parseToolMessage<TToolIO extends ProviderToolIO>(
  content: readonly ChatToolContentPart<TToolIO>[]
): PromptMessage<TToolIO>[] {
  return content.map((result) => ({
    role: "tool",
    toolCallId: result.toolCallId,
    toolName: result.toolName,
    output: result.output,
  }));
}
