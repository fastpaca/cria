import { MessageCodec, type ProviderRenderContext } from "../provider";
import type {
  PromptLayout,
  PromptMessage,
  ProviderToolIO,
  ToolCallPart,
  ToolResultPart,
} from "../types";

/** Text part used in chat-style assistant content. */
interface ChatTextPart {
  type: "text";
  text: string;
}

/** Reasoning part used in chat-style assistant content. */
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

/** Roles supported by the chat completions protocol. */
export type ChatRole = "system" | "developer" | "user" | "assistant" | "tool";

/** Protocol message shape for chat completions. */
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

/** Protocol input for chat completions (ordered message list). */
export type ChatCompletionsInput<TToolIO extends ProviderToolIO> =
  readonly ChatMessage<TToolIO>[];

/** Protocol codec for chat completions. */
export class ChatCompletionsProtocol<
  TToolIO extends ProviderToolIO,
> extends MessageCodec<ChatCompletionsInput<TToolIO>, TToolIO> {
  /** Render PromptLayout into chat-completions protocol input. */
  override render(
    layout: PromptLayout<TToolIO>,
    _context?: ProviderRenderContext
  ): ChatCompletionsInput<TToolIO> {
    return layout.map((message) => renderChatMessage(message));
  }

  /** Parse chat-completions protocol input into PromptLayout. */
  override parse(
    rendered: ChatCompletionsInput<TToolIO>
  ): PromptLayout<TToolIO> {
    return rendered.flatMap((message) => parseChatMessage(message));
  }
}

/** Map a PromptLayout message into a protocol message. */
function renderChatMessage<TToolIO extends ProviderToolIO>(
  message: PromptMessage<TToolIO>
): ChatMessage<TToolIO> {
  switch (message.role) {
    case "assistant": {
      const hasReasoning = Boolean(message.reasoning);
      const hasToolCalls = Boolean(message.toolCalls?.length);
      if (!(hasReasoning || hasToolCalls)) {
        return { role: "assistant", content: message.text };
      }

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

      return { role: "assistant", content: parts };
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

/** Map a protocol message into one or more PromptLayout messages. */
function parseChatMessage<TToolIO extends ProviderToolIO>(
  message: ChatMessage<TToolIO>
): readonly PromptMessage<TToolIO>[] {
  switch (message.role) {
    case "assistant":
      return [parseAssistantMessage(message.content)];
    case "tool":
      return message.content.map((result) => ({
        role: "tool",
        toolCallId: result.toolCallId,
        toolName: result.toolName,
        output: result.output,
      }));
    default:
      return [{ role: message.role, text: message.content }];
  }
}

/** Convert assistant content into a PromptLayout assistant message. */
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
