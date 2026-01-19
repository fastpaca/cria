import type { LanguageModel, ModelMessage, ToolResultPart } from "ai";
import { generateObject, generateText } from "ai";
import { getEncoding } from "js-tiktoken";
import type { z } from "zod";
import { safeStringify } from "../renderers/shared";
import type { PromptLayout, PromptPart } from "../types";
import { ModelProvider, PromptRenderer } from "../types";

const encoder = getEncoding("cl100k_base");
const countText = (text: string): number => encoder.encode(text).length;

export class AiSdkRenderer extends PromptRenderer<ModelMessage[]> {
  render(layout: PromptLayout): ModelMessage[] {
    return layout.messages.map((m) => {
      if (m.role === "system") {
        return { role: "system", content: textFrom(m.parts) };
      }
      if (m.role === "user") {
        return { role: "user", content: textFrom(m.parts) };
      }
      if (m.role === "assistant") {
        return { role: "assistant", content: m.parts } as ModelMessage;
      }
      // tool
      const p = m.parts[0] as ToolResultPart;
      return { role: "tool", content: [{ ...p, output: coerce(p.output) }] };
    });
  }
}

const textFrom = (parts: readonly PromptPart[]) =>
  parts
    .filter((p) => p.type === "text")
    .map((p) => p.text)
    .join("");

const coerce = (output: unknown): ToolResultPart["output"] =>
  typeof output === "string"
    ? { type: "text", value: output }
    : hasOutputShape(output)
      ? output
      : { type: "text", value: safeStringify(output) };

const hasOutputShape = (v: unknown): v is ToolResultPart["output"] =>
  typeof v === "object" &&
  v !== null &&
  "type" in v &&
  typeof (v as { type: unknown }).type === "string";

function countModelMessageTokens(message: ModelMessage): number {
  if (typeof message.content === "string") {
    return countText(message.content);
  }
  let tokens = 0;
  for (const part of message.content) {
    if (part.type === "text" || part.type === "reasoning") {
      tokens += countText(part.text);
    } else if (part.type === "tool-call") {
      tokens += countText(part.toolName + safeStringify(part.input));
    } else if (part.type === "tool-result") {
      tokens += countText(safeStringify(part.output));
    }
  }
  return tokens;
}

export class AiSdkProvider extends ModelProvider<ModelMessage[]> {
  readonly renderer = new AiSdkRenderer();
  private readonly model: LanguageModel;

  constructor(model: LanguageModel) {
    super();
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
