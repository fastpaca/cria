import { getEncoding } from "js-tiktoken";
import type { z } from "zod";
import { safeStringify } from "../renderers/shared";
import type { PromptLayout } from "../types";
import { ModelProvider, PromptRenderer } from "../types";

const encoder = getEncoding("cl100k_base");
const countText = (text: string): number => encoder.encode(text).length;

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
    const messages: string[] = [];

    for (const message of layout.messages) {
      const content = message.parts
        .map((part) => {
          switch (part.type) {
            case "text":
            case "reasoning":
              return part.text;
            case "tool-call":
              return `[tool-call:${part.toolName}]${safeStringify(part.input)}`;
            case "tool-result":
              return `[tool-result:${part.toolName}]${safeStringify(part.output)}`;
            default:
              return "";
          }
        })
        .join("");

      const formatted = this.includeRolePrefix
        ? `${message.role}: ${content}`
        : content;

      messages.push(formatted);
    }

    return messages.join(this.joinMessagesWith);
  }
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
