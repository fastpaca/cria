import { MessageCodec } from "../message-codec";
import type { PromptLayout, PromptMessage } from "../types";

export interface ResponsesToolIO {
  callInput: string;
  resultOutput: string;
}

export type ResponsesRole = "system" | "developer" | "user" | "assistant";

export interface ResponsesTextContent {
  type: "input_text" | "output_text";
  text: string;
}

export interface ResponsesRefusalContent {
  type: "refusal";
  refusal: string;
}

export type ResponsesContentPart =
  | ResponsesTextContent
  | ResponsesRefusalContent;

export interface ResponsesMessageItem {
  type: "message";
  role: ResponsesRole;
  content: string | ResponsesContentPart[];
  id?: string | null;
  status?: string | null;
}

export interface ResponsesReasoningSummary {
  type: "summary_text";
  text: string;
}

export interface ResponsesReasoningItem {
  type: "reasoning";
  summary: ResponsesReasoningSummary[];
  id?: string | null;
}

export type ResponsesItemStatus = "in_progress" | "completed" | "incomplete";

export interface ResponsesFunctionCallItem {
  type: "function_call";
  call_id: string;
  name: string;
  arguments: string;
  id?: string | null;
  status?: ResponsesItemStatus | null;
}

export interface ResponsesFunctionCallOutputItem {
  type: "function_call_output";
  call_id: string;
  output: string | ResponsesContentPart[];
  id?: string | null;
  status?: ResponsesItemStatus | null;
}

export interface ResponsesItemReference {
  type: "item_reference";
  id: string;
}

export type ResponsesItem =
  | ResponsesItemReference
  | ResponsesReasoningItem
  | ResponsesMessageItem
  | ResponsesFunctionCallItem
  | ResponsesFunctionCallOutputItem;

export type ResponsesInput = ResponsesItem[];

export class ResponsesProtocol extends MessageCodec<
  ResponsesInput,
  ResponsesToolIO
> {
  override render(layout: PromptLayout<ResponsesToolIO>): ResponsesInput {
    let reasoningIndex = 0;
    return layout.flatMap((message) => {
      switch (message.role) {
        case "tool":
          return [
            {
              type: "function_call_output",
              call_id: message.toolCallId,
              output: message.output,
            },
          ];
        case "assistant": {
          const items: ResponsesItem[] = [];
          if (message.text) {
            items.push({
              type: "message",
              role: "assistant",
              content: message.text,
            });
          }
          if (message.reasoning) {
            items.push({
              id: `reasoning_${reasoningIndex++}`,
              type: "reasoning",
              summary: [{ type: "summary_text", text: message.reasoning }],
            });
          }
          if (message.toolCalls?.length) {
            items.push(
              ...message.toolCalls.map((tc) => ({
                type: "function_call" as const,
                call_id: tc.toolCallId,
                name: tc.toolName,
                arguments: tc.input,
              }))
            );
          }
          return items;
        }
        case "system":
        case "developer":
        case "user":
          return message.text
            ? [
                {
                  type: "message",
                  role: message.role,
                  content: message.text,
                },
              ]
            : [];
        default:
          return [];
      }
    });
  }

  override parse(rendered: ResponsesInput): PromptLayout<ResponsesToolIO> {
    return parseResponsesItems(rendered);
  }
}

function parseResponsesItems(
  items: ResponsesInput
): PromptLayout<ResponsesToolIO> {
  const layout: PromptMessage<ResponsesToolIO>[] = [];
  const toolNameById = new Map<string, string>();
  let lastAssistant: Extract<
    PromptMessage<ResponsesToolIO>,
    { role: "assistant" }
  > | null = null;

  const ensureAssistant = (): Extract<
    PromptMessage<ResponsesToolIO>,
    { role: "assistant" }
  > => {
    if (!lastAssistant) {
      lastAssistant = { role: "assistant", text: "" };
      layout.push(lastAssistant);
    }
    return lastAssistant;
  };

  for (const item of items) {
    switch (item.type) {
      case "message": {
        const text = responsesText(item.content);
        if (item.role === "assistant") {
          const assistant: PromptMessage<ResponsesToolIO> = {
            role: "assistant",
            text,
          };
          layout.push(assistant);
          lastAssistant = assistant;
        } else {
          layout.push({ role: item.role, text });
          lastAssistant = null;
        }
        break;
      }
      case "reasoning": {
        const assistant = ensureAssistant();
        assistant.reasoning = `${assistant.reasoning ?? ""}${reasoningText(item)}`;
        break;
      }
      case "function_call": {
        const assistant = ensureAssistant();
        toolNameById.set(item.call_id, item.name);
        const toolCall = {
          type: "tool-call" as const,
          toolCallId: item.call_id,
          toolName: item.name,
          input: item.arguments,
        };
        assistant.toolCalls = assistant.toolCalls
          ? [...assistant.toolCalls, toolCall]
          : [toolCall];
        break;
      }
      case "function_call_output": {
        layout.push({
          role: "tool",
          toolCallId: item.call_id,
          toolName: toolNameById.get(item.call_id) ?? "",
          output: responsesText(item.output),
        });
        lastAssistant = null;
        break;
      }
      default:
        break;
    }
  }

  return layout;
}

function responsesText(content: string | ResponsesContentPart[]): string {
  if (typeof content === "string") {
    return content;
  }

  let text = "";
  for (const part of content) {
    if (part.type === "input_text" || part.type === "output_text") {
      text += part.text;
    } else if (part.type === "refusal") {
      text += part.refusal;
    }
  }
  return text;
}

function reasoningText(item: ResponsesReasoningItem): string {
  return item.summary.map((entry) => entry.text).join("");
}
