import type {
  ContentBlockParam,
  MessageParam,
  ToolResultBlockParam,
  ToolUseBlockParam,
} from "@anthropic-ai/sdk/resources/messages";
import { markdownRenderer } from "../renderers/markdown";
import type { PromptChildren, PromptElement, PromptRenderer } from "../types";

/**
 * Result of rendering to Anthropic format.
 * System messages are extracted separately since Anthropic's API
 * takes them as a separate parameter.
 */
export interface AnthropicRenderResult {
  system?: string;
  messages: MessageParam[];
}

/**
 * Renderer that outputs Anthropic-compatible messages.
 * Use this with the Anthropic SDK.
 *
 * Note: System messages are extracted to a separate `system` field since
 * Anthropic's API takes them as a separate parameter.
 *
 * @example
 * ```ts
 * import { render } from "@fastpaca/cria";
 * import { anthropic } from "@fastpaca/cria/anthropic";
 *
 * const { system, messages } = await render(prompt, { tokenizer, budget, renderer: anthropic });
 * const response = await client.messages.create({
 *   model: "claude-sonnet-4-20250514",
 *   system,
 *   messages,
 * });
 * ```
 */
export const anthropic: PromptRenderer<AnthropicRenderResult> = {
  name: "anthropic",
  tokenString: markdownRenderer.tokenString,
  render: (element) => renderToAnthropic(element),
  empty: () => ({ messages: [] }),
};

type MessageElement = Extract<PromptElement, { kind: "message" }>;

function renderToAnthropic(root: PromptElement): AnthropicRenderResult {
  const messageNodes = collectMessageNodes(root);

  // Extract system messages
  const systemNodes = messageNodes.filter((m) => m.role === "system");
  const nonSystemNodes = messageNodes.filter((m) => m.role !== "system");

  // Combine all system messages into one string
  const systemText = systemNodes
    .map((m) => collectTextContent(m.children))
    .filter((s) => s.length > 0)
    .join("\n\n");

  // Convert non-system messages
  const messages = convertMessages(nonSystemNodes);

  return {
    ...(systemText.length > 0 ? { system: systemText } : {}),
    messages,
  };
}

function collectMessageNodes(
  element: PromptElement,
  acc: MessageElement[] = []
): MessageElement[] {
  if (element.kind === "message") {
    acc.push(element);
    return acc;
  }

  for (const child of element.children) {
    if (typeof child === "string") {
      continue;
    }
    collectMessageNodes(child, acc);
  }

  return acc;
}

/**
 * Convert message nodes to Anthropic format.
 * Key quirk: tool results must be in user messages, not assistant messages.
 */
function convertMessages(nodes: MessageElement[]): MessageParam[] {
  const result: MessageParam[] = [];

  for (const node of nodes) {
    const parts = collectSemanticParts(node.children);
    const { textParts, toolCallParts, toolResultParts, reasoningParts } =
      categorizeParts(parts);

    if (node.role === "user") {
      // User messages can have text and tool results
      const content: ContentBlockParam[] = [];

      // Add tool results first (from previous assistant turn)
      for (const tr of toolResultParts) {
        content.push(toToolResultBlock(tr));
      }

      // Add text content
      const text = combineTextParts(textParts, reasoningParts);
      if (text.length > 0) {
        content.push({ type: "text", text });
      }

      if (content.length > 0) {
        result.push({ role: "user", content });
      }
    } else {
      // Assistant messages have text, reasoning, and tool calls
      const content: ContentBlockParam[] = [];

      // Add text content (reasoning included as text since we don't have signatures)
      const text = combineTextParts(textParts, reasoningParts);
      if (text.length > 0) {
        content.push({ type: "text", text });
      }

      // Add tool calls
      for (const tc of toolCallParts) {
        content.push(toToolUseBlock(tc));
      }

      // Tool results from assistant messages need to go in the next user message
      // For now, we'll add them as a separate user message
      if (content.length > 0) {
        result.push({ role: "assistant", content });
      }

      if (toolResultParts.length > 0) {
        const userContent: ContentBlockParam[] = toolResultParts.map((tr) =>
          toToolResultBlock(tr)
        );
        result.push({ role: "user", content: userContent });
      }
    }
  }

  return result;
}

type SemanticPart =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "tool-call"; toolCallId: string; toolName: string; input: unknown }
  | {
      type: "tool-result";
      toolCallId: string;
      toolName: string;
      output: unknown;
    };

type ToolCallPart = Extract<SemanticPart, { type: "tool-call" }>;
type ToolResultPart = Extract<SemanticPart, { type: "tool-result" }>;
type TextPart = Extract<SemanticPart, { type: "text" }>;
type ReasoningPart = Extract<SemanticPart, { type: "reasoning" }>;

function categorizeParts(parts: SemanticPart[]): {
  textParts: TextPart[];
  toolCallParts: ToolCallPart[];
  toolResultParts: ToolResultPart[];
  reasoningParts: ReasoningPart[];
} {
  const textParts: TextPart[] = [];
  const toolCallParts: ToolCallPart[] = [];
  const toolResultParts: ToolResultPart[] = [];
  const reasoningParts: ReasoningPart[] = [];

  for (const part of parts) {
    switch (part.type) {
      case "text":
        textParts.push(part);
        break;
      case "tool-call":
        toolCallParts.push(part);
        break;
      case "tool-result":
        toolResultParts.push(part);
        break;
      case "reasoning":
        reasoningParts.push(part);
        break;
    }
  }

  return { textParts, toolCallParts, toolResultParts, reasoningParts };
}

function collectSemanticParts(children: PromptChildren): SemanticPart[] {
  const parts: SemanticPart[] = [];

  for (const child of children) {
    if (typeof child === "string") {
      if (child.length > 0) {
        parts.push({ type: "text", text: child });
      }
      continue;
    }

    parts.push(...semanticPartsFromElement(child));
  }

  return coalesceTextParts(parts);
}

function semanticPartsFromElement(element: PromptElement): SemanticPart[] {
  switch (element.kind) {
    case "tool-call":
      return [
        {
          type: "tool-call",
          toolCallId: element.toolCallId,
          toolName: element.toolName,
          input: element.input,
        },
      ];
    case "tool-result":
      return [
        {
          type: "tool-result",
          toolCallId: element.toolCallId,
          toolName: element.toolName,
          output: element.output,
        },
      ];
    case "reasoning":
      return element.text.length === 0
        ? []
        : [{ type: "reasoning", text: element.text }];
    case "message":
      // Nested messages are ambiguous - skip
      return [];
    default:
      return collectSemanticParts(element.children);
  }
}

function coalesceTextParts(parts: readonly SemanticPart[]): SemanticPart[] {
  const result: SemanticPart[] = [];
  let buffer = "";

  for (const part of parts) {
    if (part.type === "text") {
      buffer += part.text;
      continue;
    }

    if (buffer.length > 0) {
      result.push({ type: "text", text: buffer });
      buffer = "";
    }

    result.push(part);
  }

  if (buffer.length > 0) {
    result.push({ type: "text", text: buffer });
  }

  return result;
}

function collectTextContent(children: PromptChildren): string {
  let result = "";

  for (const child of children) {
    if (typeof child === "string") {
      result += child;
    } else if (child.kind === undefined) {
      result += collectTextContent(child.children);
    } else if (child.kind === "reasoning") {
      result += `<thinking>\n${child.text}\n</thinking>\n`;
    }
  }

  return result;
}

function combineTextParts(
  textParts: TextPart[],
  reasoningParts: ReasoningPart[]
): string {
  let result = "";

  // Add reasoning as thinking blocks
  for (const rp of reasoningParts) {
    result += `<thinking>\n${rp.text}\n</thinking>\n`;
  }

  // Add text parts
  for (const tp of textParts) {
    result += tp.text;
  }

  return result;
}

function toToolUseBlock(part: ToolCallPart): ToolUseBlockParam {
  return {
    type: "tool_use",
    id: part.toolCallId,
    name: part.toolName,
    input: part.input,
  };
}

function toToolResultBlock(part: ToolResultPart): ToolResultBlockParam {
  return {
    type: "tool_result",
    tool_use_id: part.toolCallId,
    content: stringifyOutput(part.output),
  };
}

function stringifyOutput(output: unknown): string {
  if (typeof output === "string") {
    return output;
  }
  try {
    return JSON.stringify(output) ?? "null";
  } catch {
    return String(output);
  }
}
