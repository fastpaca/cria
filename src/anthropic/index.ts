import type Anthropic from "@anthropic-ai/sdk";
import type {
  ContentBlockParam,
  MessageParam,
  Model,
  ToolResultBlockParam,
  ToolUseBlockParam,
} from "@anthropic-ai/sdk/resources/messages";
import type { Child } from "../jsx-runtime";
import { markdownRenderer } from "../renderers/markdown";
import {
  coalesceTextParts,
  collectMessageNodes,
  collectSemanticParts,
  type MessageElement,
  type SemanticPart,
  safeStringify,
  type ToolCallPart,
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

/**
 * Convert message nodes to Anthropic format.
 * Key quirk: tool results must be in user messages, not assistant messages.
 */
function convertMessages(nodes: MessageElement[]): MessageParam[] {
  return nodes.flatMap(convertMessageNode);
}

function convertMessageNode(node: MessageElement): MessageParam[] {
  const parts = coalesceTextParts(collectSemanticParts(node.children));

  if (node.role === "user") {
    return buildUserMessages(parts);
  }

  return buildAssistantMessages(parts);
}

function buildUserMessages(parts: readonly SemanticPart[]): MessageParam[] {
  const content = buildUserContent(parts);
  if (content.length === 0) {
    return [];
  }

  return [{ role: "user", content }];
}

/**
 * Build user content blocks preserving tool result positions.
 * Adjacent text/reasoning parts are coalesced into single text blocks.
 */
function buildUserContent(parts: readonly SemanticPart[]): ContentBlockParam[] {
  const content: ContentBlockParam[] = [];
  let textBuffer = "";

  const flushTextBuffer = () => {
    if (textBuffer.length > 0) {
      content.push({ type: "text", text: textBuffer });
      textBuffer = "";
    }
  };

  for (const part of parts) {
    if (part.type === "tool-result") {
      flushTextBuffer();
      content.push(toToolResultBlock(part));
    } else if (part.type === "text") {
      textBuffer += part.text;
    } else if (part.type === "reasoning") {
      textBuffer += `<thinking>\n${part.text}\n</thinking>`;
    }
    // tool-call parts in user messages are ignored
  }

  flushTextBuffer();
  return content;
}

function buildAssistantMessages(
  parts: readonly SemanticPart[]
): MessageParam[] {
  // Separate tool results (go to user message) from assistant content
  const assistantParts = parts.filter((p) => p.type !== "tool-result");
  const toolResultParts = parts.filter(
    (p): p is ToolResultPart => p.type === "tool-result"
  );

  const content = buildAssistantContent(assistantParts);
  const result: MessageParam[] = [];

  if (content.length > 0) {
    result.push({ role: "assistant", content });
  }

  if (toolResultParts.length > 0) {
    result.push({
      role: "user",
      content: toolResultParts.map(toToolResultBlock),
    });
  }

  return result;
}

/**
 * Build assistant content blocks preserving tool call positions.
 * Adjacent text/reasoning parts are coalesced into single text blocks.
 */
function buildAssistantContent(
  parts: readonly SemanticPart[]
): ContentBlockParam[] {
  const content: ContentBlockParam[] = [];
  let textBuffer = "";

  const flushTextBuffer = () => {
    if (textBuffer.length > 0) {
      content.push({ type: "text", text: textBuffer });
      textBuffer = "";
    }
  };

  for (const part of parts) {
    if (part.type === "text") {
      textBuffer += part.text;
    } else if (part.type === "reasoning") {
      textBuffer += `<thinking>\n${part.text}\n</thinking>`;
    } else if (part.type === "tool-call") {
      flushTextBuffer();
      content.push(toToolUseBlock(part));
    }
    // tool-result parts handled separately
  }

  flushTextBuffer();
  return content;
}

function collectTextContent(children: PromptChildren): string {
  let result = "";

  for (const child of children) {
    if (typeof child === "string") {
      result += child;
      continue;
    }

    if (child.kind === undefined) {
      result += collectTextContent(child.children);
    } else if (child.kind === "reasoning") {
      result += `<thinking>\n${child.text}\n</thinking>\n`;
    }
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
    content: safeStringify(part.output),
  };
}

type AnthropicRole = "user" | "assistant";
const VALID_ANTHROPIC_ROLES = new Set<string>(["user", "assistant"]);

/**
 * ModelProvider implementation that wraps an Anthropic client.
 * Use this with the DSL's `.provider()` method.
 *
 * @example
 * ```typescript
 * import Anthropic from "@anthropic-ai/sdk";
 * import { cria } from "@fastpaca/cria";
 * import { Provider } from "@fastpaca/cria/anthropic";
 *
 * const client = new Anthropic();
 * const provider = new Provider(client, "claude-sonnet-4-20250514");
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
  readonly name = "anthropic";
  private readonly client: Anthropic;
  private readonly model: Model;
  private readonly maxTokens: number;

  constructor(client: Anthropic, model: Model, maxTokens = 1024) {
    this.client = client;
    this.model = model;
    this.maxTokens = maxTokens;
  }

  async completion(request: CompletionRequest): Promise<CompletionResult> {
    const messages = convertToAnthropicMessages(request);

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      ...(request.system ? { system: request.system } : {}),
      messages,
    });

    const text = extractTextFromResponse(response.content);
    return { text };
  }
}

function convertToAnthropicMessages(
  request: CompletionRequest
): MessageParam[] {
  const messages: MessageParam[] = [];
  for (const msg of request.messages) {
    // System messages are handled separately in Anthropic's API
    if (VALID_ANTHROPIC_ROLES.has(msg.role)) {
      messages.push({ role: msg.role as AnthropicRole, content: msg.content });
    }
  }
  return messages;
}

function extractTextFromResponse(
  content: Anthropic.Messages.ContentBlock[]
): string {
  return content
    .filter(
      (block): block is Anthropic.Messages.TextBlock => block.type === "text"
    )
    .map((block) => block.text)
    .join("");
}

interface AnthropicProviderProps {
  /** Anthropic client instance */
  client: Anthropic;
  /** Model to use (e.g. "claude-sonnet-4-20250514", "claude-3-5-haiku-latest") */
  model: Model;
  /** Maximum tokens to generate. Defaults to 1024. */
  maxTokens?: number;
  /** Optional tokenizer to use for budgeting; defaults to a tiktoken-based tokenizer */
  tokenizer?: Tokenizer;
  /** Child components that will have access to this provider */
  children?: Child;
}

/**
 * Provider component that injects an Anthropic client into the component tree.
 *
 * Child components like `<Summary>` will automatically use this provider
 * for AI-powered operations when no explicit function is provided.
 *
 * @example
 * ```tsx
 * import Anthropic from "@anthropic-ai/sdk";
 * import { AnthropicProvider } from "@fastpaca/cria/anthropic";
 * import { Summary, render } from "@fastpaca/cria";
 *
 * const client = new Anthropic();
 *
 * const prompt = (
 *   <AnthropicProvider client={client} model="claude-sonnet-4-20250514">
 *     <Summary id="conv-history" store={store} priority={2}>
 *       {conversationHistory}
 *     </Summary>
 *   </AnthropicProvider>
 * );
 *
 * const result = await render(prompt, { tokenizer, budget: 4000 });
 * ```
 */
export function AnthropicProvider({
  client,
  model,
  maxTokens = 1024,
  tokenizer,
  children = [],
}: AnthropicProviderProps): PromptElement {
  const provider: ModelProvider = {
    name: "anthropic",
    tokenizer: tokenizer ?? tiktokenTokenizer(model),
    async completion(request: CompletionRequest): Promise<CompletionResult> {
      const messages = convertToAnthropicMessages(request);

      const response = await client.messages.create({
        model,
        max_tokens: maxTokens,
        ...(request.system ? { system: request.system } : {}),
        messages,
      });

      const text = extractTextFromResponse(response.content);
      return { text };
    },
  };

  return {
    priority: 0,
    children: children as PromptChildren,
    context: { provider },
  };
}
