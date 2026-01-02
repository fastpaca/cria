import type {
  ChatCompletionAssistantMessageParam,
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
  ChatCompletionSystemMessageParam,
  ChatCompletionToolMessageParam,
  ChatCompletionUserMessageParam,
} from "openai/resources/chat/completions";
import { markdownRenderer } from "../renderers/markdown";
import type { PromptChildren, PromptElement, PromptRenderer } from "../types";

/**
 * Renderer that outputs ChatCompletionMessageParam[] for the OpenAI Chat Completions API.
 * Pass this to render() to get messages compatible with client.chat.completions.create().
 *
 * @example
 * ```ts
 * import { render } from "@fastpaca/cria";
 * import { chatCompletions } from "@fastpaca/cria/openai";
 *
 * const messages = await render(prompt, { tokenizer, budget, renderer: chatCompletions });
 * const response = await openai.chat.completions.create({ model: "gpt-4", messages });
 * ```
 */
export const chatCompletions: PromptRenderer<ChatCompletionMessageParam[]> = {
  name: "openai-chat-completions",
  tokenString: markdownRenderer.tokenString,
  render: (element) => renderToChatCompletions(element),
  empty: () => [],
};

type MessageElement = Extract<PromptElement, { kind: "message" }>;

function renderToChatCompletions(
  root: PromptElement
): ChatCompletionMessageParam[] {
  const messageNodes = collectMessageNodes(root);
  const result: ChatCompletionMessageParam[] = [];

  for (const messageNode of messageNodes) {
    result.push(...messageNodeToParams(messageNode));
  }

  return result;
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

type ToolResultPart = Extract<SemanticPart, { type: "tool-result" }>;

function messageNodeToParams(
  messageNode: MessageElement
): ChatCompletionMessageParam[] {
  const parts = coalesceTextParts(collectSemanticParts(messageNode.children));

  if (messageNode.role === "system") {
    return [toSystemMessage(parts)];
  }

  if (messageNode.role === "user") {
    return [toUserMessage(parts)];
  }

  // Assistant message: may contain tool calls, and tool results become separate messages
  const { assistantParts, toolResultParts } = splitToolResults(parts);
  const result: ChatCompletionMessageParam[] = [];

  if (assistantParts.length > 0 || toolResultParts.length === 0) {
    result.push(toAssistantMessage(assistantParts));
  }

  for (const toolResult of toolResultParts) {
    result.push(toToolMessage(toolResult));
  }

  return result;
}

function splitToolResults(parts: SemanticPart[]): {
  assistantParts: Exclude<SemanticPart, { type: "tool-result" }>[];
  toolResultParts: ToolResultPart[];
} {
  const assistantParts: Exclude<SemanticPart, { type: "tool-result" }>[] = [];
  const toolResultParts: ToolResultPart[] = [];

  for (const part of parts) {
    if (part.type === "tool-result") {
      toolResultParts.push(part);
    } else {
      assistantParts.push(part);
    }
  }

  return { assistantParts, toolResultParts };
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

  return parts;
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
      // OpenAI Chat Completions doesn't have native reasoning support
      // Include as text content
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

function toSystemMessage(
  parts: readonly SemanticPart[]
): ChatCompletionSystemMessageParam {
  return {
    role: "system",
    content: partsToText(parts),
  };
}

function toUserMessage(
  parts: readonly SemanticPart[]
): ChatCompletionUserMessageParam {
  return {
    role: "user",
    content: partsToText(parts),
  };
}

function toAssistantMessage(
  parts: readonly Exclude<SemanticPart, { type: "tool-result" }>[]
): ChatCompletionAssistantMessageParam {
  const toolCalls: ChatCompletionMessageToolCall[] = [];
  let textContent = "";

  for (const part of parts) {
    if (part.type === "text") {
      textContent += part.text;
    } else if (part.type === "reasoning") {
      // Include reasoning as text since Chat Completions doesn't support it natively
      textContent += `<thinking>\n${part.text}\n</thinking>\n`;
    } else if (part.type === "tool-call") {
      toolCalls.push({
        id: part.toolCallId,
        type: "function",
        function: {
          name: part.toolName,
          arguments: stringifyInput(part.input),
        },
      });
    }
  }

  const result: ChatCompletionAssistantMessageParam = {
    role: "assistant",
  };

  if (textContent.length > 0) {
    result.content = textContent;
  }

  if (toolCalls.length > 0) {
    result.tool_calls = toolCalls;
  }

  return result;
}

function toToolMessage(part: ToolResultPart): ChatCompletionToolMessageParam {
  return {
    role: "tool",
    tool_call_id: part.toolCallId,
    content: stringifyOutput(part.output),
  };
}

function stringifyInput(input: unknown): string {
  if (typeof input === "string") {
    return input;
  }
  try {
    return JSON.stringify(input) ?? "null";
  } catch {
    return String(input);
  }
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

function partsToText(parts: readonly SemanticPart[]): string {
  let result = "";
  for (const part of parts) {
    if (part.type === "text") {
      result += part.text;
    } else if (part.type === "reasoning") {
      result += `<thinking>\n${part.text}\n</thinking>\n`;
    }
  }
  return result;
}

// ============================================================================
// Responses API Renderer (for reasoning models)
// ============================================================================

import type {
  EasyInputMessage,
  ResponseFunctionToolCall,
  ResponseInputItem,
  ResponseReasoningItem,
} from "openai/resources/responses/responses";

/**
 * Renderer that outputs ResponseInputItem[] for the OpenAI Responses API.
 * Use this with reasoning models that support native reasoning.
 *
 * @example
 * ```ts
 * import { render } from "@fastpaca/cria";
 * import { responses } from "@fastpaca/cria/openai";
 *
 * const input = await render(prompt, { tokenizer, budget, renderer: responses });
 * const response = await openai.responses.create({ model: "o3", input });
 * ```
 */
export const responses: PromptRenderer<ResponseInputItem[]> = {
  name: "openai-responses",
  tokenString: markdownRenderer.tokenString,
  render: (element) => renderToResponses(element),
  empty: () => [],
};

function renderToResponses(root: PromptElement): ResponseInputItem[] {
  const result: ResponseInputItem[] = [];

  // Collect all semantic items from the tree
  collectResponseItems(root, result);

  return result;
}

function collectResponseItems(
  element: PromptElement,
  acc: ResponseInputItem[]
): void {
  switch (element.kind) {
    case "message": {
      const parts = coalesceTextParts(collectSemanticParts(element.children));
      const { nonToolParts, toolCallParts, toolResultParts } =
        categorizePartsForResponses(parts);

      // Add message if it has text content
      if (nonToolParts.length > 0) {
        const role = mapRoleForResponses(element.role);
        const message: EasyInputMessage = {
          role,
          content: partsToTextForResponses(nonToolParts),
        };
        acc.push(message);
      }

      // Add tool calls as separate items
      for (const tc of toolCallParts) {
        const toolCall: ResponseFunctionToolCall = {
          type: "function_call",
          call_id: tc.toolCallId,
          name: tc.toolName,
          arguments: stringifyInput(tc.input),
        };
        acc.push(toolCall);
      }

      // Add tool results as separate items
      for (const tr of toolResultParts) {
        const toolResult: ResponseInputItem.FunctionCallOutput = {
          type: "function_call_output",
          call_id: tr.toolCallId,
          output: stringifyOutput(tr.output),
        };
        acc.push(toolResult);
      }
      break;
    }

    case "reasoning": {
      // Native reasoning support in Responses API
      if (element.text.length > 0) {
        const reasoningItem: ResponseReasoningItem = {
          id: element.id ?? `rs_${Date.now()}`,
          type: "reasoning",
          summary: [{ type: "summary_text", text: element.text }],
        };
        acc.push(reasoningItem);
      }
      break;
    }

    case "tool-call": {
      const toolCall: ResponseFunctionToolCall = {
        type: "function_call",
        call_id: element.toolCallId,
        name: element.toolName,
        arguments: stringifyInput(element.input),
      };
      acc.push(toolCall);
      break;
    }

    case "tool-result": {
      const toolResult: ResponseInputItem.FunctionCallOutput = {
        type: "function_call_output",
        call_id: element.toolCallId,
        output: stringifyOutput(element.output),
      };
      acc.push(toolResult);
      break;
    }

    default: {
      // Recurse into children for regions without semantic kind
      for (const child of element.children) {
        if (typeof child !== "string") {
          collectResponseItems(child, acc);
        }
      }
    }
  }
}

type ToolCallPart = Extract<SemanticPart, { type: "tool-call" }>;

function categorizePartsForResponses(parts: SemanticPart[]): {
  nonToolParts: Exclude<SemanticPart, { type: "tool-call" | "tool-result" }>[];
  toolCallParts: ToolCallPart[];
  toolResultParts: ToolResultPart[];
} {
  const nonToolParts: Exclude<
    SemanticPart,
    { type: "tool-call" | "tool-result" }
  >[] = [];
  const toolCallParts: ToolCallPart[] = [];
  const toolResultParts: ToolResultPart[] = [];

  for (const part of parts) {
    if (part.type === "tool-call") {
      toolCallParts.push(part);
    } else if (part.type === "tool-result") {
      toolResultParts.push(part);
    } else {
      nonToolParts.push(part);
    }
  }

  return { nonToolParts, toolCallParts, toolResultParts };
}

function mapRoleForResponses(
  role: string
): "user" | "assistant" | "system" | "developer" {
  if (role === "system" || role === "developer") {
    return role;
  }
  if (role === "user") {
    return "user";
  }
  return "assistant";
}

function partsToTextForResponses(
  parts: readonly Exclude<SemanticPart, { type: "tool-call" | "tool-result" }>[]
): string {
  let result = "";
  for (const part of parts) {
    if (part.type === "text") {
      result += part.text;
    }
    // Note: reasoning parts inside messages are handled separately
    // We don't include them as text here since Responses API has native reasoning
  }
  return result;
}
