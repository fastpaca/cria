import { getEncoding } from "js-tiktoken";
import type OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { ResponseInputItem } from "openai/resources/responses/responses";
import type { z } from "zod";
import type { ChatCompletionsInput } from "../protocols/chat-completions";
import { ChatCompletionsProtocol } from "../protocols/chat-completions";
import type {
  ResponsesContentPart,
  ResponsesInput,
  ResponsesToolIO,
} from "../protocols/responses";
import { ResponsesProtocol } from "../protocols/responses";
import type { ProviderAdapter } from "../provider-adapter";
import { ProtocolProvider } from "../provider-adapter";

const encoder = getEncoding("cl100k_base");
const countText = (text: string): number => encoder.encode(text).length;

/** OpenAI tool IO matches the responses protocol tool IO. */
export type OpenAiToolIO = ResponsesToolIO;

/** OpenAI responses API item shape. */
export type OpenAIResponsePart = ResponseInputItem;
/** OpenAI responses API input array. */
export type OpenAIResponses = OpenAIResponsePart[];

/**
 * Adapter between chat-completions protocol messages and OpenAI chat messages.
 */
export class OpenAIChatAdapter
  implements
    ProviderAdapter<
      ChatCompletionsInput<OpenAiToolIO>,
      ChatCompletionMessageParam[]
    >
{
  /** Convert protocol messages into OpenAI chat messages. */
  toProvider(
    input: ChatCompletionsInput<OpenAiToolIO>
  ): ChatCompletionMessageParam[] {
    return input.flatMap((message) => {
      switch (message.role) {
        case "assistant":
          return [renderOpenAiAssistantMessage(message.content)];
        case "tool":
          return message.content.map((result) => ({
            role: "tool",
            tool_call_id: result.toolCallId,
            content: result.output,
          }));
        default:
          return [{ role: message.role, content: message.content }];
      }
    });
  }

  /** Convert OpenAI chat messages into protocol messages. */
  fromProvider(
    input: ChatCompletionMessageParam[]
  ): ChatCompletionsInput<OpenAiToolIO> {
    const toolNameById = new Map<string, string>();

    return input.map((message) => {
      switch (message.role) {
        case "assistant": {
          const text = chatText(message.content);
          const toolCalls = message.tool_calls?.map((tc) => {
            toolNameById.set(tc.id, tc.function.name);
            return {
              type: "tool-call" as const,
              toolCallId: tc.id,
              toolName: tc.function.name,
              input: tc.function.arguments,
            };
          });

          if (toolCalls && toolCalls.length > 0) {
            const parts: Array<
              { type: "text"; text: string } | (typeof toolCalls)[number]
            > = [];
            if (text) {
              parts.push({ type: "text", text });
            }
            parts.push(...toolCalls);
            return { role: "assistant", content: parts };
          }

          return { role: "assistant", content: text };
        }
        case "tool": {
          const toolCallId = message.tool_call_id;
          const toolName = toolNameById.get(toolCallId) ?? "";
          return {
            role: "tool",
            content: [
              {
                type: "tool-result" as const,
                toolCallId,
                toolName,
                output: chatText(message.content),
              },
            ],
          };
        }
        case "function": {
          const toolName = message.name ?? "";
          return {
            role: "tool",
            content: [
              {
                type: "tool-result" as const,
                toolCallId: toolName,
                toolName,
                output: chatText(message.content),
              },
            ],
          };
        }
        default:
          return { role: message.role, content: chatText(message.content) };
      }
    });
  }
}

/**
 * Adapter between responses protocol items and OpenAI responses items.
 */
export class OpenAIResponsesAdapter
  implements ProviderAdapter<ResponsesInput, OpenAIResponses>
{
  /** Convert protocol items into OpenAI responses input. */
  toProvider(input: ResponsesInput): OpenAIResponses {
    return input.flatMap((item, index) =>
      mapResponsesItemToOpenAi(item, index)
    );
  }

  /** Convert OpenAI responses input into protocol items. */
  fromProvider(input: OpenAIResponses): ResponsesInput {
    return input.flatMap((item) => mapOpenAiItemToResponses(item));
  }
}

/** Render assistant content into an OpenAI chat message. */
function renderOpenAiAssistantMessage(
  content: ChatCompletionsInput<OpenAiToolIO>[number]["content"]
): ChatCompletionMessageParam {
  if (typeof content === "string") {
    return { role: "assistant", content };
  }

  let text = "";
  const toolCalls: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }> = [];

  for (const part of content) {
    if (part.type === "text") {
      text += part.text;
    } else if (part.type === "tool-call") {
      toolCalls.push({
        id: part.toolCallId,
        type: "function",
        function: { name: part.toolName, arguments: part.input },
      });
    }
  }

  if (toolCalls.length === 0) {
    return { role: "assistant", content: text };
  }

  return {
    role: "assistant",
    ...(text ? { content: text } : {}),
    tool_calls: toolCalls,
  };
}

/** Map a responses protocol item into OpenAI response parts. */
function mapResponsesItemToOpenAi(
  item: ResponsesInput[number],
  index: number
): OpenAIResponsePart[] {
  switch (item.type) {
    case "message":
      return [
        {
          type: "message",
          role: item.role,
          content: responsesText(item.content),
        },
      ];
    case "reasoning":
      return [
        {
          type: "reasoning",
          summary: item.summary,
          id: item.id ?? `reasoning_${index}`,
        },
      ];
    case "function_call":
      return [
        {
          type: "function_call",
          call_id: item.call_id,
          name: item.name,
          arguments: item.arguments,
        },
      ];
    case "function_call_output":
      return [
        {
          type: "function_call_output",
          call_id: item.call_id,
          output: responsesText(item.output),
        },
      ];
    case "item_reference":
      return [
        {
          type: "item_reference",
          id: item.id,
        },
      ];
    default:
      return [];
  }
}

/** Map an OpenAI response part into protocol items. */
function mapOpenAiItemToResponses(item: OpenAIResponsePart): ResponsesInput {
  if ("role" in item) {
    return [
      {
        type: "message",
        role: item.role,
        content: responseText(item.content),
      },
    ];
  }

  switch (item.type) {
    case "reasoning":
      return [
        {
          type: "reasoning",
          summary: item.summary,
          ...("id" in item && item.id ? { id: item.id } : {}),
        },
      ];
    case "function_call":
      return [
        {
          type: "function_call",
          call_id: item.call_id,
          name: item.name,
          arguments: item.arguments,
        },
      ];
    case "function_call_output":
      return [
        {
          type: "function_call_output",
          call_id: item.call_id,
          output: item.output,
        },
      ];
    case "item_reference":
      return [
        {
          type: "item_reference",
          id: item.id,
        },
      ];
    default:
      return [];
  }
}

/** Count tokens for a single OpenAI chat message. */
function countChatMessageTokens(msg: ChatCompletionMessageParam): number {
  let n = 0;
  if ("content" in msg && typeof msg.content === "string") {
    n += countText(msg.content);
  }
  if ("tool_calls" in msg && msg.tool_calls) {
    for (const c of msg.tool_calls) {
      n += countText(c.function.name + c.function.arguments);
    }
  }
  return n;
}

/** Count tokens for a single OpenAI responses item. */
function countResponseItemTokens(item: ResponseInputItem): number {
  if ("content" in item && typeof item.content === "string") {
    return countText(item.content);
  }
  if (item.type === "message" && Array.isArray(item.content)) {
    return (item.content as { text?: string }[]).reduce(
      (n, c) => n + (c.text ? countText(c.text) : 0),
      0
    );
  }
  if (item.type === "reasoning") {
    return item.summary.reduce((n, s) => n + countText(s.text), 0);
  }
  if (item.type === "function_call") {
    return countText(item.name + item.arguments);
  }
  if (item.type === "function_call_output") {
    return countText(item.output);
  }
  return 0;
}

/** Extract plain text from OpenAI chat content. */
function chatText(content: ChatCompletionMessageParam["content"]): string {
  if (content === null || content === undefined) {
    return "";
  }
  if (typeof content === "string") {
    return content;
  }
  let text = "";
  for (const part of content) {
    if (typeof part === "string") {
      text += part;
    } else if (part.type === "text") {
      text += part.text;
    }
  }
  return text;
}

/** Narrowed response item shape that includes a role. */
type ResponseMessageItem = Extract<ResponseInputItem, { role: string }>;

/** Extract plain text from OpenAI response message content. */
function responseText(content: ResponseMessageItem["content"]): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    let text = "";
    for (const part of content) {
      if (typeof part === "string") {
        text += part;
      } else if (part.type === "input_text" || part.type === "output_text") {
        text += part.text;
      } else if (part.type === "refusal") {
        text += part.refusal;
      }
    }
    return text;
  }
  return "";
}

/** Extract plain text from protocol responses content parts. */
function responsesText(content: string | ResponsesContentPart[]): string {
  if (typeof content === "string") {
    return content;
  }

  let text = "";
  for (const part of content) {
    if (part.type === "input_text" || part.type === "output_text") {
      if (part.text) {
        text += part.text;
      }
    } else if (part.type === "refusal" && part.refusal) {
      text += part.refusal;
    }
  }
  return text;
}

/**
 * OpenAI provider using the chat completions protocol.
 */
export class OpenAIChatProvider extends ProtocolProvider<
  ChatCompletionMessageParam[],
  ChatCompletionsInput<OpenAiToolIO>,
  OpenAiToolIO
> {
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(client: OpenAI, model: string) {
    super(new ChatCompletionsProtocol<OpenAiToolIO>(), new OpenAIChatAdapter());
    this.client = client;
    this.model = model;
  }

  /** Count tokens for OpenAI chat messages. */
  countTokens(messages: ChatCompletionMessageParam[]): number {
    return messages.reduce((n, m) => n + countChatMessageTokens(m), 0);
  }

  /** Generate a text completion using chat completions. */
  async completion(messages: ChatCompletionMessageParam[]): Promise<string> {
    const res = await this.client.chat.completions.create({
      model: this.model,
      messages,
    });
    return res.choices[0]?.message?.content ?? "";
  }

  /** Generate a structured object using chat completions. */
  async object<T>(
    messages: ChatCompletionMessageParam[],
    schema: z.ZodType<T>
  ): Promise<T> {
    const res = await this.client.chat.completions.create({
      model: this.model,
      messages,
      response_format: { type: "json_object" },
    });
    return schema.parse(JSON.parse(res.choices[0]?.message?.content ?? ""));
  }
}

/**
 * OpenAI provider using the responses protocol.
 */
export class OpenAIResponsesProvider extends ProtocolProvider<
  OpenAIResponses,
  ResponsesInput,
  OpenAiToolIO
> {
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(client: OpenAI, model: string) {
    super(new ResponsesProtocol(), new OpenAIResponsesAdapter());
    this.client = client;
    this.model = model;
  }

  /** Count tokens for OpenAI responses items. */
  countTokens(items: OpenAIResponses): number {
    return items.reduce((n, i) => n + countResponseItemTokens(i), 0);
  }

  /** Generate a text completion using the responses API. */
  async completion(items: OpenAIResponses): Promise<string> {
    const res = await this.client.responses.create({
      model: this.model,
      input: items,
    });
    return res.output_text ?? "";
  }

  /** Generate a structured object using the responses API. */
  async object<T>(items: OpenAIResponses, schema: z.ZodType<T>): Promise<T> {
    return schema.parse(JSON.parse(await this.completion(items)));
  }
}

/** Convenience creator for the OpenAI chat provider. */
export function createProvider(
  client: OpenAI,
  model: string
): OpenAIChatProvider {
  return new OpenAIChatProvider(client, model);
}

/** Convenience creator for the OpenAI responses provider. */
export function createResponsesProvider(
  client: OpenAI,
  model: string
): OpenAIResponsesProvider {
  return new OpenAIResponsesProvider(client, model);
}
