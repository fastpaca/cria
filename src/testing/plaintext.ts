import type { z } from "zod";
import { countText, safeStringify } from "../renderers/shared";
import type { PromptLayout, PromptMessage } from "../types";
import { ModelProvider, PromptRenderer } from "../types";

export interface PlainTextRendererOptions {
  joinMessagesWith?: string;
  includeRolePrefix?: boolean;
}

export class PlainTextRenderer extends PromptRenderer<string> {
  private readonly joinMessagesWith: string;
  private readonly includeRolePrefix: boolean;

  constructor(options: PlainTextRendererOptions = {}) {
    super();
    this.joinMessagesWith = options.joinMessagesWith ?? "";
    this.includeRolePrefix = options.includeRolePrefix ?? false;
  }

  render(layout: PromptLayout): string {
    const messages = layout.map((message) =>
      formatPlaintextMessage(message, this.includeRolePrefix)
    );

    return messages.join(this.joinMessagesWith);
  }
}

function formatPlaintextMessage(
  message: PromptMessage,
  includeRolePrefix: boolean
): string {
  const content = renderPlaintextContent(message);
  if (includeRolePrefix) {
    return `${message.role}: ${content}`;
  }
  return content;
}

function renderPlaintextContent(message: PromptMessage): string {
  if (message.role === "tool") {
    return `[tool-result:${message.toolName}]${safeStringify(message.output)}`;
  }

  if (message.role === "assistant") {
    return renderAssistantContent(message);
  }

  return message.text;
}

function renderAssistantContent(
  message: Extract<PromptMessage, { role: "assistant" }>
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
      content += `[tool-call:${call.toolName}]${safeStringify(call.input)}`;
    }
  }
  return content;
}

export class PlainTextProvider extends ModelProvider<string> {
  readonly renderer: PromptRenderer<string>;

  constructor(renderer: PromptRenderer<string>) {
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
): PromptRenderer<string> {
  return new PlainTextRenderer(options);
}

export function createTestProvider(
  options: PlainTextRendererOptions = {}
): ModelProvider<string> {
  return new PlainTextProvider(createPlainTextRenderer(options));
}
