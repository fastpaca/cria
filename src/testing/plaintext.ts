import { getEncoding } from "js-tiktoken";
import type { z } from "zod";
import type { PromptLayout, PromptMessage } from "../types";
import { ModelProvider, PromptRenderer } from "../types";

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

export class PlainTextRenderer extends PromptRenderer<string, PlainTextToolIO> {
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

export class PlainTextProvider extends ModelProvider<string, PlainTextToolIO> {
  readonly renderer: PromptRenderer<string, PlainTextToolIO>;

  constructor(renderer: PromptRenderer<string, PlainTextToolIO>) {
    super();
    this.renderer = renderer;
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

export function createPlainTextRenderer(
  options: PlainTextRendererOptions = {}
): PromptRenderer<string, PlainTextToolIO> {
  return new PlainTextRenderer(options);
}

export function createTestProvider(
  options: PlainTextRendererOptions = {}
): ModelProvider<string, PlainTextToolIO> {
  return new PlainTextProvider(createPlainTextRenderer(options));
}
