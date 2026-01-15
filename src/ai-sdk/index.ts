import type {
  LanguageModel,
  ModelMessage,
  ToolResultPart,
  UIMessage,
} from "ai";
import { generateText, Output } from "ai";
import {
  Message,
  Reasoning,
  Region,
  ToolCall,
  ToolResult,
} from "../components";
import { markdownRenderer } from "../renderers/markdown";
import {
  coalesceTextParts,
  collectMessageNodes,
  collectSemanticParts,
  type MessageElement,
  partsToText,
  type SemanticPart,
} from "../renderers/shared";
import { tiktokenTokenizer } from "../tokenizers";
import type {
  CompletionMessage,
  CompletionResult,
  EvaluatorOutput,
  EvaluatorProvider,
  EvaluatorRequest,
  MaybePromise,
  ModelProvider,
  PromptChild,
  PromptChildren,
  PromptElement,
  PromptRenderer,
  Strategy,
  Tokenizer,
} from "../types";
import { EvaluatorOutputSchema } from "../types";

/**
 * Priority configuration for message types when rendering prompts.
 * Lower numbers = higher priority (less likely to be dropped).
 */
export interface Priorities {
  system: number;
  user: number;
  assistant: number;
  toolCall: number;
  toolResult: number;
  reasoning: number;
}

export const DEFAULT_PRIORITIES: Priorities = {
  system: 0,
  user: 1,
  assistant: 1,
  toolCall: 3,
  toolResult: 2,
  reasoning: 3,
};

export interface MessagesProps {
  messages: readonly UIMessage[];
  includeReasoning?: boolean;
  priorities?: Partial<Priorities>;
  id?: string;
}

/**
 * Converts AI SDK UIMessages into Cria prompt elements.
 * Use this to include conversation history in your prompts.
 */
export function Messages({
  messages,
  includeReasoning = false,
  priorities,
  id,
}: MessagesProps): PromptElement {
  const resolvedPriorities = resolvePriorities(priorities);

  const children = messages.map((message) =>
    UIMessageElement({
      includeReasoning,
      message,
      priorities: resolvedPriorities,
    })
  );

  return Region({
    priority: 0,
    ...(id === undefined ? {} : { id }),
    children,
  });
}

const omitStrategy: Strategy = () => null;

interface UIMessageElementProps {
  message: UIMessage;
  priorities: Priorities;
  includeReasoning: boolean;
}

function UIMessageElement({
  message,
  priorities,
  includeReasoning,
}: UIMessageElementProps): PromptElement {
  const messagePriority = rolePriority(message.role, priorities);

  const children: PromptChild[] = [];

  for (const part of message.parts) {
    if (part.type === "text") {
      children.push(part.text);
      continue;
    }

    if (part.type === "reasoning") {
      if (!includeReasoning) {
        continue;
      }

      children.push(
        Reasoning({
          priority: priorities.reasoning,
          strategy: omitStrategy,
          text: part.text,
        })
      );
      continue;
    }

    const toolInvocation = parseToolInvocationPart(part);
    if (!toolInvocation) {
      continue;
    }

    const toolCall = ToolCall({
      input: toolInvocation.input,
      priority: priorities.toolCall,
      strategy: omitStrategy,
      toolCallId: toolInvocation.toolCallId,
      toolName: toolInvocation.toolName,
    });

    children.push(toolCall);

    if (toolInvocation.output !== undefined) {
      children.push(
        ToolResult({
          output: toolInvocation.output,
          priority: priorities.toolResult,
          strategy: omitStrategy,
          toolCallId: toolInvocation.toolCallId,
          toolName: toolInvocation.toolName,
        })
      );
    }
  }

  return Message({
    id: `message:${message.id}`,
    messageRole: message.role,
    priority: messagePriority,
    children,
  });
}

function resolvePriorities(
  priorities: Partial<Priorities> | undefined
): Priorities {
  return { ...DEFAULT_PRIORITIES, ...priorities };
}

const ROLE_PRIORITY_MAP: Record<UIMessage["role"], keyof Priorities> = {
  system: "system",
  user: "user",
  assistant: "assistant",
};

function rolePriority(role: UIMessage["role"], priorities: Priorities): number {
  return priorities[ROLE_PRIORITY_MAP[role]];
}

interface ToolInvocation {
  toolCallId: string;
  toolName: string;
  input: unknown;
  output?: unknown;
}

type UIMessagePart = UIMessage["parts"][number];

const TOOL_PART_PREFIX = "tool-" as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getModelId(model: LanguageModel): string | undefined {
  if (!isRecord(model)) {
    return undefined;
  }

  const modelId = model.modelId;
  return typeof modelId === "string" ? modelId : undefined;
}

function parseToolInvocationPart(part: UIMessagePart): ToolInvocation | null {
  if (part.type === "dynamic-tool") {
    const output = toolOutputFromPart(part);
    return {
      toolCallId: part.toolCallId,
      toolName: part.toolName,
      input: part.input,
      ...(output === undefined ? {} : { output }),
    };
  }

  if (part.type.startsWith(TOOL_PART_PREFIX)) {
    const toolName = part.type.slice(TOOL_PART_PREFIX.length);
    if (!("toolCallId" in part)) {
      return null;
    }
    const toolCallId = part.toolCallId;
    if (typeof toolCallId !== "string") {
      return null;
    }

    const input = "input" in part ? part.input : undefined;
    const output = toolOutputFromPart(part);
    return {
      toolCallId,
      toolName,
      input,
      ...(output === undefined ? {} : { output }),
    };
  }

  return null;
}

function toolOutputFromPart(part: UIMessagePart): unknown | undefined {
  if (!("state" in part)) {
    return undefined;
  }

  if (part.state === "output-available") {
    if ("output" in part) {
      return part.output;
    }
    return undefined;
  }

  if (part.state === "output-error") {
    const errorText =
      "errorText" in part && typeof part.errorText === "string"
        ? part.errorText
        : "Tool error";
    return { type: "error-text", value: errorText };
  }

  if (part.state === "output-denied") {
    const reason = deniedReasonFromPart(part);
    return reason
      ? { type: "execution-denied", reason }
      : { type: "execution-denied" };
  }

  return undefined;
}

function deniedReasonFromPart(part: UIMessagePart): string | undefined {
  if (!("approval" in part)) {
    return undefined;
  }
  const approval = part.approval;
  if (!isRecord(approval)) {
    return undefined;
  }
  const reason = approval.reason;
  if (typeof reason !== "string") {
    return undefined;
  }
  return reason.length === 0 ? undefined : reason;
}

/**
 * Renderer that outputs ModelMessage[] for use with the Vercel AI SDK.
 * Pass this to render() to get messages compatible with generateText/streamText.
 */
export const renderer: PromptRenderer<ModelMessage[]> = {
  name: "ai-sdk",
  tokenString: markdownRenderer.tokenString,
  render: (element) => renderToModelMessages(element),
  empty: () => [],
};

function renderToModelMessages(root: PromptElement): ModelMessage[] {
  const messageNodes = collectMessageNodes(root);
  const result: ModelMessage[] = [];

  for (const messageNode of messageNodes) {
    result.push(...messageNodeToModelMessages(messageNode));
  }

  return result;
}

type ToolResultSemanticPart = Extract<SemanticPart, { type: "tool-result" }>;
type NonToolSemanticPart = Exclude<SemanticPart, { type: "tool-result" }>;

type SemanticPartGroup =
  | { kind: "non-tool"; parts: NonToolSemanticPart[] }
  | { kind: "tool-result"; parts: ToolResultSemanticPart[] };

function messageNodeToModelMessages(
  messageNode: MessageElement
): ModelMessage[] {
  const parts = coalesceTextParts(collectSemanticParts(messageNode.children));
  const groups = groupSemanticParts(parts);

  const result: ModelMessage[] = [];
  for (const group of groups) {
    if (group.kind === "tool-result") {
      result.push(toToolModelMessage(group.parts));
      continue;
    }
    result.push(toModelMessage(messageNode.role, group.parts));
  }

  return result;
}

function groupSemanticParts(
  parts: readonly SemanticPart[]
): SemanticPartGroup[] {
  const groups: SemanticPartGroup[] = [];

  for (const part of parts) {
    const lastGroup = groups.at(-1);

    if (part.type === "tool-result") {
      if (lastGroup?.kind === "tool-result") {
        lastGroup.parts.push(part);
      } else {
        groups.push({ kind: "tool-result", parts: [part] });
      }
      continue;
    }

    if (lastGroup?.kind === "non-tool") {
      lastGroup.parts.push(part);
    } else {
      groups.push({ kind: "non-tool", parts: [part] });
    }
  }

  return groups;
}

function toModelMessage(
  role: string,
  parts: readonly NonToolSemanticPart[]
): ModelMessage {
  if (role === "system") {
    return { role: "system", content: partsToText(parts) };
  }

  if (role === "user") {
    return { role: "user", content: partsToText(parts) };
  }

  type AssistantModelMessage = Extract<ModelMessage, { role: "assistant" }>;
  type AssistantContent = AssistantModelMessage["content"];
  type AssistantContentPart =
    Exclude<AssistantContent, string> extends readonly (infer Part)[]
      ? Part
      : never;

  const content: AssistantContentPart[] = [];
  for (const part of parts) {
    if (part.type === "text") {
      content.push({ type: "text", text: part.text });
    } else if (part.type === "reasoning") {
      content.push({ type: "reasoning", text: part.text });
    } else if (part.type === "tool-call") {
      content.push({
        type: "tool-call",
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        input: part.input,
      });
    }
  }

  return { role: "assistant", content };
}

function toToolModelMessage(
  parts: readonly ToolResultSemanticPart[]
): ModelMessage {
  const content: ToolResultPart[] = [];
  for (const part of parts) {
    content.push({
      type: "tool-result",
      toolCallId: part.toolCallId,
      toolName: part.toolName,
      output: coerceToolResultOutput(part.output),
    });
  }
  return { role: "tool", content };
}

function coerceToolResultOutput(output: unknown): ToolResultPart["output"] {
  if (typeof output === "string") {
    return { type: "text", value: output };
  }

  if (isToolResultOutput(output)) {
    return output;
  }

  return { type: "json", value: safeJsonValue(output) };
}

interface ToolResultOutputLike {
  type: unknown;
  value?: unknown;
  reason?: unknown;
}

function isToolResultOutput(value: unknown): value is ToolResultPart["output"] {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const output = value as ToolResultOutputLike;

  if (typeof output.type !== "string") {
    return false;
  }

  switch (output.type) {
    case "text":
    case "error-text":
      return typeof output.value === "string";
    case "json":
    case "error-json":
      return output.value !== undefined;
    case "execution-denied":
      return output.reason === undefined || typeof output.reason === "string";
    case "content":
      return Array.isArray(output.value);
    default:
      return false;
  }
}

type JsonValue =
  | null
  | string
  | number
  | boolean
  | { [key: string]: JsonValue }
  | JsonValue[];

function safeJsonValue(value: unknown): JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(safeJsonValue);
  }

  if (typeof value === "object") {
    const result: Record<string, JsonValue> = {};
    for (const [key, entry] of Object.entries(value)) {
      result[key] = safeJsonValue(entry);
    }
    return result;
  }

  return String(value);
}

interface AISDKProviderProps {
  /** The language model to use (e.g. openai("gpt-4o"), anthropic("claude-sonnet-4-20250514")) */
  model: LanguageModel;
  /** Optional tokenizer to use for budgeting; defaults to an approximate counter */
  tokenizer?: Tokenizer;
  /** Child components that will have access to this provider */
  children?: PromptChildren;
}

/**
 * Provider component that injects an AI SDK model into the component tree.
 *
 * Child components like `<Summary>` will automatically use this provider
 * for AI-powered operations when no explicit function is provided.
 *
 * @example
 * ```tsx
 * import { AISDKProvider } from "@fastpaca/cria/ai-sdk";
 * import { Summary, render } from "@fastpaca/cria";
 * import { openai } from "@ai-sdk/openai";
 *
 * const prompt = (
 *   <AISDKProvider model={openai("gpt-4o")}>
 *     <Summary id="conv-history" store={store} priority={2}>
 *       {conversationHistory}
 *     </Summary>
 *   </AISDKProvider>
 * );
 *
 * const result = await render(prompt, { tokenizer, budget: 4000 });
 * ```
 */
type AISDKRole = "user" | "assistant" | "system";
const VALID_AI_SDK_ROLES = new Set<string>(["user", "assistant", "system"]);

function toModelMessages(messages: CompletionMessage[]): ModelMessage[] {
  const result: ModelMessage[] = [];

  for (const msg of messages) {
    if (VALID_AI_SDK_ROLES.has(msg.role)) {
      result.push({ role: msg.role as AISDKRole, content: msg.content });
    }
  }

  return result;
}

async function executeCompletion(
  model: LanguageModel,
  messages: ModelMessage[]
): Promise<CompletionResult> {
  const { text } = await generateText({ model, messages });
  return { text };
}

/**
 * ModelProvider implementation that wraps an AI SDK LanguageModel.
 * Use this with the DSL's `.provider()` method.
 *
 * @example
 * ```typescript
 * import { cria } from "@fastpaca/cria";
 * import { Provider } from "@fastpaca/cria/ai-sdk";
 * import { openai } from "@ai-sdk/openai";
 *
 * const provider = new Provider(openai("gpt-4o"));
 *
 * const prompt = cria
 *   .prompt()
 *   .provider(provider, (p) =>
 *     p.summary(content, { id: "summary", store })
 *   )
 *   .build();
 * ```
 */
export class Provider implements ModelProvider<ModelMessage[]> {
  readonly name = "ai-sdk";
  readonly renderer: PromptRenderer<ModelMessage[]> = renderer;
  readonly tokenizer?: Tokenizer;
  private readonly model: LanguageModel;

  constructor(model: LanguageModel, options: { tokenizer?: Tokenizer } = {}) {
    this.model = model;
    this.tokenizer =
      options.tokenizer ?? tiktokenTokenizer(getModelId(this.model));
  }

  completion(messages: ModelMessage[]): Promise<CompletionResult> {
    return executeCompletion(this.model, messages);
  }
}

/**
 * Evaluator provider that uses AI SDK structured outputs.
 *
 * @example
 * ```typescript
 * import { Evaluator } from "@fastpaca/cria/ai-sdk";
 * import { openai } from "@ai-sdk/openai";
 *
 * const evaluator = new Evaluator(openai("gpt-4o-mini"));
 * ```
 */
export class Evaluator implements EvaluatorProvider {
  readonly name: string;
  readonly tokenizer?: Tokenizer;
  private readonly model: LanguageModel;

  constructor(
    model: LanguageModel,
    options: { name?: string; tokenizer?: Tokenizer } = {}
  ) {
    this.model = model;
    this.name = options.name ?? "ai-sdk-evaluator";
    this.tokenizer = options.tokenizer ?? tiktokenTokenizer(getModelId(model));
  }

  async evaluate(request: EvaluatorRequest): Promise<EvaluatorOutput> {
    const messages = toModelMessages(request.messages);
    const result = await generateText({
      model: this.model,
      messages,
      output: Output.object({
        schema: EvaluatorOutputSchema,
        name: "evaluation",
        description: "Score from 0-1 with a short reasoning string.",
      }),
    });

    return result.output;
  }
}

export function AISDKProvider({
  model,
  tokenizer,
  children = [],
}: AISDKProviderProps): MaybePromise<PromptElement> {
  const provider: ModelProvider<ModelMessage[]> = {
    name: "ai-sdk",
    renderer,
    tokenizer: tokenizer ?? tiktokenTokenizer(getModelId(model)),
    completion: (messages) => executeCompletion(model, messages),
  };

  return {
    priority: 0,
    children,
    context: { provider },
  };
}
