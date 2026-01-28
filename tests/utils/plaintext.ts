import { MessageCodec, ModelProvider } from "@fastpaca/cria/provider";
import type { PromptLayout, PromptMessage } from "@fastpaca/cria/types";
import { getEncoding } from "js-tiktoken";
import type { z } from "zod";

const encoder = getEncoding("cl100k_base");
const countText = (text: string): number => encoder.encode(text).length;

export interface PlainTextCodecOptions {
  joinMessagesWith?: string;
  includeRolePrefix?: boolean;
}

interface PlainTextToolIO {
  callInput: string;
  resultOutput: string;
}

const ROLE_PREFIX_RE = /^(system|developer|user|assistant|tool):\s*/;

export class PlainTextCodec extends MessageCodec<string, PlainTextToolIO> {
  private readonly joinMessagesWith: string;
  private readonly includeRolePrefix: boolean;
  private readonly separatorTokens: number;

  constructor(options: PlainTextCodecOptions = {}) {
    super();
    this.joinMessagesWith = options.joinMessagesWith ?? "";
    this.includeRolePrefix = options.includeRolePrefix ?? false;
    this.separatorTokens = this.joinMessagesWith
      ? countText(this.joinMessagesWith)
      : 0;
  }

  override render(layout: PromptLayout<PlainTextToolIO>): string {
    const messages = layout.map((message) => this.renderMessage(message));

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
            if (
              role === "system" ||
              role === "developer" ||
              role === "user" ||
              role === "assistant"
            ) {
              return { role, text };
            }
          }
        }

        return { role: "assistant", text: segment };
      });
  }

  renderMessage(message: PromptMessage<PlainTextToolIO>): string {
    return formatPlaintextMessage(message, this.includeRolePrefix);
  }

  separatorTokenCount(): number {
    return this.separatorTokens;
  }

  supportsMessageTokenCounting(): boolean {
    return this.includeRolePrefix || this.joinMessagesWith.length > 0;
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

export function createPlainTextCodec(
  options: PlainTextCodecOptions = {}
): MessageCodec<string, PlainTextToolIO> {
  return new PlainTextCodec(options);
}

export function createTestProvider(
  options: PlainTextCodecOptions = {}
): ModelProvider<string, PlainTextToolIO> {
  return new PlainTextProvider(createPlainTextCodec(options));
}

export class PlainTextProvider extends ModelProvider<string, PlainTextToolIO> {
  readonly codec: PlainTextCodec;

  constructor(codec: MessageCodec<string, PlainTextToolIO>) {
    super();
    if (!(codec instanceof PlainTextCodec)) {
      throw new Error("PlainTextProvider requires a PlainTextCodec.");
    }
    this.codec = codec;
  }

  tokenCountingMode(): "message" | "rendered" {
    return this.codec.supportsMessageTokenCounting() ? "message" : "rendered";
  }

  countMessageTokens(message: PromptMessage<PlainTextToolIO>): number {
    const renderedMessage = this.codec.renderMessage(message);
    return countText(renderedMessage);
  }

  countBoundaryTokens(
    _prev: PromptMessage<PlainTextToolIO> | null,
    _next: PromptMessage<PlainTextToolIO>
  ): number {
    return this.codec.separatorTokenCount();
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
