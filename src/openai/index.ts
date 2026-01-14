import type OpenAI from "openai";
import type {
  ChatCompletionAssistantMessageParam,
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
  ChatCompletionSystemMessageParam,
  ChatCompletionToolMessageParam,
  ChatCompletionUserMessageParam,
} from "openai/resources/chat/completions";
import type {
  ResponseFunctionToolCall,
  ResponseInputItem,
  ResponseReasoningItem,
} from "openai/resources/responses/responses";
import { markdownRenderer } from "../renderers/markdown";
import {
  coalesceTextParts,
  collectMessageNodes,
  collectSemanticParts,
  partsToText,
  type SemanticPart,
  safeStringify,
  type ToolResultPart,
} from "../renderers/shared";
import { tiktokenTokenizer } from "../tokenizers";
import type {
  CompletionRequest,
  CompletionResult,
  ModelProvider,
  PromptChildren,
  PromptElement,
  PromptRenderer,
  Tokenizer,
} from "../types";

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

function messageNodeToParams(
  messageNode: Extract<PromptElement, { kind: "message" }>
): ChatCompletionMessageParam[] {
  const parts = coalesceTextParts(collectSemanticParts(messageNode.children));

  if (messageNode.role === "system") {
    return [toSystemMessage(parts)];
  }

  if (messageNode.role === "user") {
    return [toUserMessage(parts)];
  }

  // Assistant message: may contain tool calls, and tool results become separate messages
  // Preserve original part ordering - only separate out tool results
  const assistantParts = parts.filter(
    (p): p is Exclude<SemanticPart, { type: "tool-result" }> =>
      p.type !== "tool-result"
  );
  const toolResultParts = parts.filter(
    (p): p is ToolResultPart => p.type === "tool-result"
  );
  const result: ChatCompletionMessageParam[] = [];

  if (assistantParts.length > 0 || toolResultParts.length === 0) {
    result.push(toAssistantMessage(assistantParts));
  }

  for (const toolResult of toolResultParts) {
    result.push(toToolMessage(toolResult));
  }

  return result;
}

function toSystemMessage(
  parts: readonly SemanticPart[]
): ChatCompletionSystemMessageParam {
  return {
    role: "system",
    content: partsToText(parts, { wrapReasoning: true }),
  };
}

function toUserMessage(
  parts: readonly SemanticPart[]
): ChatCompletionUserMessageParam {
  return {
    role: "user",
    content: partsToText(parts, { wrapReasoning: true }),
  };
}

function toAssistantMessage(
  parts: readonly Exclude<SemanticPart, { type: "tool-result" }>[]
): ChatCompletionAssistantMessageParam {
  const textContent = partsToText(parts, { wrapReasoning: true });
  const toolCalls: ChatCompletionMessageToolCall[] = parts
    .filter(
      (part): part is Extract<typeof part, { type: "tool-call" }> =>
        part.type === "tool-call"
    )
    .map((part) => ({
      id: part.toolCallId,
      type: "function" as const,
      function: {
        name: part.toolName,
        arguments: safeStringify(part.input),
      },
    }));

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
    content: safeStringify(part.output),
  };
}

// ============================================================================
// Responses API Renderer (for reasoning models)
// ============================================================================

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
  collectResponseItems(root, result);
  return result;
}

type MessageElement = Extract<PromptElement, { kind: "message" }>;

/**
 * Convert a message element's parts into ResponseInputItems.
 * Handles text, reasoning, tool calls, and tool results.
 */
function collectMessageResponseItems(
  element: MessageElement,
  acc: ResponseInputItem[]
): void {
  const parts = coalesceTextParts(collectSemanticParts(element.children));
  const role = mapRoleForResponses(element.role);
  let textBuffer = "";
  let reasoningIndex = 0;

  const flushTextBuffer = () => {
    if (textBuffer.length > 0) {
      acc.push({ role, content: textBuffer });
      textBuffer = "";
    }
  };

  for (const part of parts) {
    switch (part.type) {
      case "text":
        textBuffer += part.text;
        break;
      case "reasoning": {
        flushTextBuffer();
        acc.push({
          id: element.id
            ? `${element.id}-reasoning-${reasoningIndex}`
            : `reasoning_${reasoningIndex}`,
          type: "reasoning",
          summary: [{ type: "summary_text", text: part.text }],
        });
        reasoningIndex += 1;
        break;
      }
      case "tool-call":
        flushTextBuffer();
        acc.push({
          type: "function_call",
          call_id: part.toolCallId,
          name: part.toolName,
          arguments: safeStringify(part.input),
        });
        break;
      case "tool-result":
        flushTextBuffer();
        acc.push({
          type: "function_call_output",
          call_id: part.toolCallId,
          output: safeStringify(part.output),
        });
        break;
      default:
        // Exhaustive check - all SemanticPart types handled above
        break;
    }
  }

  flushTextBuffer();
}

function collectResponseItems(
  element: PromptElement,
  acc: ResponseInputItem[]
): void {
  switch (element.kind) {
    case "message": {
      collectMessageResponseItems(element, acc);
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
        arguments: safeStringify(element.input),
      };
      acc.push(toolCall);
      break;
    }

    case "tool-result": {
      const toolResult: ResponseInputItem.FunctionCallOutput = {
        type: "function_call_output",
        call_id: element.toolCallId,
        output: safeStringify(element.output),
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

type ResponseRole = "user" | "assistant" | "system" | "developer";

const RESPONSE_ROLE_MAP: Record<string, ResponseRole> = {
  system: "system",
  developer: "developer",
  user: "user",
};

function mapRoleForResponses(role: string): ResponseRole {
  return RESPONSE_ROLE_MAP[role] ?? "assistant";
}

interface OpenAIProviderProps {
  /** OpenAI client instance */
  client: OpenAI;
  /** Model to use (e.g. "gpt-4o", "gpt-4o-mini") */
  model: string;
  /** Optional tokenizer to use for budgeting; defaults to a tiktoken-based tokenizer */
  tokenizer?: Tokenizer;
  /** Child components that will have access to this provider */
  children?: PromptChildren;
}

/**
 * Provider component that injects an OpenAI client into the component tree.
 *
 * Child components like `<Summary>` will automatically use this provider
 * for AI-powered operations when no explicit function is provided.
 *
 * @example
 * ```tsx
 * import OpenAI from "openai";
 * import { OpenAIProvider } from "@fastpaca/cria/openai";
 * import { Summary, render } from "@fastpaca/cria";
 *
 * const client = new OpenAI();
 *
 * const prompt = (
 *   <OpenAIProvider client={client} model="gpt-4o">
 *     <Summary id="conv-history" store={store} priority={2}>
 *       {conversationHistory}
 *     </Summary>
 *   </OpenAIProvider>
 * );
 *
 * const result = await render(prompt, { tokenizer, budget: 4000 });
 * ```
 */
type OpenAIRole = "user" | "assistant" | "system";
const VALID_OPENAI_ROLES = new Set<string>(["user", "assistant", "system"]);

/**
 * ModelProvider implementation that wraps an OpenAI client.
 * Use this with the DSL's `.provider()` method.
 *
 * @example
 * ```typescript
 * import OpenAI from "openai";
 * import { cria } from "@fastpaca/cria";
 * import { Provider } from "@fastpaca/cria/openai";
 *
 * const client = new OpenAI();
 * const provider = new Provider(client, "gpt-4o");
 *
 * const prompt = cria
 *   .prompt()
 *   .provider(provider, (p) =>
 *     p.summary(content, { id: "summary", store })
 *   )
 *   .build();
 * ```
 */
export class Provider implements ModelProvider {
  readonly name = "openai";
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(client: OpenAI, model: string) {
    this.client = client;
    this.model = model;
  }

  async completion(request: CompletionRequest): Promise<CompletionResult> {
    const messages: ChatCompletionMessageParam[] = request.system
      ? [{ role: "system", content: request.system }]
      : [];

    for (const msg of request.messages) {
      if (msg.role === "system" && request.system) {
        continue;
      }
      if (VALID_OPENAI_ROLES.has(msg.role)) {
        messages.push({ role: msg.role as OpenAIRole, content: msg.content });
      }
    }

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages,
    });

    const text = response.choices[0]?.message?.content ?? "";
    return { text };
  }
}

export function OpenAIProvider({
  client,
  model,
  tokenizer,
  children = [],
}: OpenAIProviderProps): PromptElement {
  const provider: ModelProvider = {
    name: "openai",
    tokenizer: tokenizer ?? tiktokenTokenizer(model),
    async completion(request: CompletionRequest): Promise<CompletionResult> {
      const messages: ChatCompletionMessageParam[] = request.system
        ? [{ role: "system", content: request.system }]
        : [];

      for (const msg of request.messages) {
        if (msg.role === "system" && request.system) {
          continue;
        }
        if (VALID_OPENAI_ROLES.has(msg.role)) {
          messages.push({ role: msg.role as OpenAIRole, content: msg.content });
        }
      }

      const response = await client.chat.completions.create({
        model,
        messages,
      });

      const text = response.choices[0]?.message?.content ?? "";
      return { text };
    },
  };

  return {
    priority: 0,
    children,
    context: { provider },
  };
}
