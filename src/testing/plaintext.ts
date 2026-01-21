import { getEncoding } from "js-tiktoken";
import type { z } from "zod";
import { MessageCodec } from "../message-codec";
import type { PromptLayout, PromptMessage } from "../types";
import { ModelProvider } from "../types";

const encoder = getEncoding("cl100k_base");
const countText = (text: string): number => encoder.encode(text).length;

export interface PlainTextRendererOptions {
  joinMessagesWith?: string;
  includeRolePrefix?: boolean;
}

interface PlainTextToolIO {
  callInput: string;
  resultOutput: string;
}

const ROLE_PREFIX_RE = /^(system|user|assistant|tool):\s*/;

export class PlainTextCodec extends MessageCodec<string, PlainTextToolIO> {
  private readonly joinMessagesWith: string;
  private readonly includeRolePrefix: boolean;

  constructor(options: PlainTextRendererOptions = {}) {
    super();
    this.joinMessagesWith = options.joinMessagesWith ?? "";
    this.includeRolePrefix = options.includeRolePrefix ?? false;
  }

  override render(layout: PromptLayout<PlainTextToolIO>): string {
    const messages = layout.map((message) =>
      formatPlaintextMessage(message, this.includeRolePrefix)
    );

    return messages.join(this.joinMessagesWith);
  }

  override parse(rendered: string): PromptLayout<PlainTextToolIO> {
    if (!rendered) {
      return [];
    }

    const segments = this.joinMessagesWith
      ? rendered.split(this.joinMessagesWith)
      : [rendered];

    return segments
      .filter((segment) => segment.length > 0)
      .map((segment): PromptMessage<PlainTextToolIO> => {
        if (this.includeRolePrefix) {
          const match = segment.match(ROLE_PREFIX_RE);
          if (match) {
            const role = match[1];
            const text = segment.slice(match[0].length);
            if (role === "tool") {
              return {
                role: "tool",
                toolCallId: "tool",
                toolName: "tool",
                output: text,
              };
            }
            if (role === "system" || role === "user" || role === "assistant") {
              return { role, text };
            }
          }
        }

        return { role: "assistant", text: segment };
      });
  }
}

function formatPlaintextMessage(
  message: PromptMessage<PlainTextToolIO>,
  includeRolePrefix: boolean
): string {
  const content = renderPlaintextContent(message);
  if (includeRolePrefix) {
    return `${message.role}: ${content}`;
  }
  return content;
}

function renderPlaintextContent(
  message: PromptMessage<PlainTextToolIO>
): string {
  if (message.role === "tool") {
    return `[tool-result:${message.toolName}]${message.output}`;
  }

  if (message.role === "assistant") {
    return renderAssistantContent(message);
  }

  return message.text;
}

function renderAssistantContent(
  message: Extract<PromptMessage<PlainTextToolIO>, { role: "assistant" }>
): string {
  let content = "";
  if (message.text) {
    content += message.text;
  }
  if (message.reasoning) {
    content += message.reasoning;
  }
  if (message.toolCalls) {
    for (const call of message.toolCalls) {
      content += `[tool-call:${call.toolName}]${call.input}`;
    }
  }
  return content;
}

export function createPlainTextRenderer(
  options: PlainTextRendererOptions = {}
): MessageCodec<string, PlainTextToolIO> {
  return new PlainTextCodec(options);
}

export function createTestProvider(
  options: PlainTextRendererOptions = {}
): ModelProvider<string, PlainTextToolIO> {
  return new PlainTextProvider(createPlainTextRenderer(options));
}

export class PlainTextProvider extends ModelProvider<string, PlainTextToolIO> {
  readonly codec: MessageCodec<string, PlainTextToolIO>;

  constructor(codec: MessageCodec<string, PlainTextToolIO>) {
    super();
    this.codec = codec;
  }

  countTokens(rendered: string): number {
    return countText(rendered);
  }

  completion(rendered: string): string {
    return rendered;
  }

  object<T>(rendered: string, schema: z.ZodType<T>): T {
    return schema.parse(JSON.parse(rendered));
  }
}
