import type {
  ModelMessage,
  TextPart,
  ToolCallPart,
  ToolResultPart,
  UIMessage,
} from "ai";
import { Message, Reasoning, Region, ToolCall, ToolResult } from "./components";
import { markdownRenderer } from "./renderers/markdown";
import type {
  PromptChildren,
  PromptElement,
  PromptRenderer,
  Strategy,
} from "./types";

export interface AiSdkPriorities {
  system: number;
  user: number;
  assistant: number;
  toolCall: number;
  toolResult: number;
  reasoning: number;
}

export const DEFAULT_AI_SDK_PRIORITIES: AiSdkPriorities = {
  system: 0,
  user: 1,
  assistant: 2,
  toolCall: 3,
  toolResult: 1,
  reasoning: 3,
} as const;

export interface AiSdkMessagesProps {
  messages: readonly UIMessage[];
  includeReasoning?: boolean;
  priorities?: Partial<AiSdkPriorities>;
  id?: string;
}

export function AiSdkMessages({
  messages,
  includeReasoning = false,
  priorities,
  id,
}: AiSdkMessagesProps): PromptElement {
  const resolvedPriorities = resolvePriorities(priorities);

  return (
    <Region priority={0} {...(id === undefined ? {} : { id })}>
      {messages.map((message) => (
        <AiSdkMessage
          includeReasoning={includeReasoning}
          message={message}
          priorities={resolvedPriorities}
        />
      ))}
    </Region>
  );
}

const omitStrategy: Strategy = async () => null;

interface AiSdkMessageProps {
  message: UIMessage;
  priorities: AiSdkPriorities;
  includeReasoning: boolean;
}

function AiSdkMessage({
  message,
  priorities,
  includeReasoning,
}: AiSdkMessageProps): PromptElement {
  const messagePriority = rolePriority(message.role, priorities);

  return (
    <Message
      id={`message:${message.id}`}
      priority={messagePriority}
      role={message.role}
    >
      {message.parts.map((part) => {
        if (part.type === "text") {
          return part.text;
        }

        if (part.type === "reasoning") {
          if (!includeReasoning) {
            return null;
          }
          return (
            <Reasoning
              priority={priorities.reasoning}
              strategy={omitStrategy}
              text={part.text}
            />
          );
        }

        const toolInvocation = parseToolInvocationPart(part);
        if (toolInvocation) {
          return [
            <ToolCall
              input={toolInvocation.input}
              priority={priorities.toolCall}
              strategy={omitStrategy}
              toolCallId={toolInvocation.toolCallId}
              toolName={toolInvocation.toolName}
            />,
            toolInvocation.output === undefined ? null : (
              <ToolResult
                output={toolInvocation.output}
                priority={priorities.toolResult}
                strategy={omitStrategy}
                toolCallId={toolInvocation.toolCallId}
                toolName={toolInvocation.toolName}
              />
            ),
          ];
        }

        return null;
      })}
    </Message>
  );
}

function resolvePriorities(
  priorities: Partial<AiSdkPriorities> | undefined
): AiSdkPriorities {
  if (!priorities) {
    return DEFAULT_AI_SDK_PRIORITIES;
  }

  return {
    system: priorities.system ?? DEFAULT_AI_SDK_PRIORITIES.system,
    user: priorities.user ?? DEFAULT_AI_SDK_PRIORITIES.user,
    assistant: priorities.assistant ?? DEFAULT_AI_SDK_PRIORITIES.assistant,
    toolCall: priorities.toolCall ?? DEFAULT_AI_SDK_PRIORITIES.toolCall,
    toolResult: priorities.toolResult ?? DEFAULT_AI_SDK_PRIORITIES.toolResult,
    reasoning: priorities.reasoning ?? DEFAULT_AI_SDK_PRIORITIES.reasoning,
  };
}

function rolePriority(
  role: UIMessage["role"],
  priorities: AiSdkPriorities
): number {
  switch (role) {
    case "system":
      return priorities.system;
    case "user":
      return priorities.user;
    case "assistant":
      return priorities.assistant;
    default: {
      return priorities.assistant;
    }
  }
}

interface ToolInvocation {
  toolCallId: string;
  toolName: string;
  input: unknown;
  output?: unknown;
}

function parseToolInvocationPart(
  part: UIMessage["parts"][number]
): ToolInvocation | null {
  if (part.type === "dynamic-tool") {
    const output = toolOutputFromDynamicTool(part);
    return {
      toolCallId: part.toolCallId,
      toolName: part.toolName,
      input: part.input,
      ...(output === undefined ? {} : { output }),
    };
  }

  if (part.type.startsWith("tool-")) {
    const toolName = part.type.slice("tool-".length);
    if (!("toolCallId" in part)) {
      return null;
    }
    const toolCallId = part.toolCallId;
    if (typeof toolCallId !== "string") {
      return null;
    }

    const input = "input" in part ? part.input : undefined;
    const output = toolOutputFromStaticTool(part);
    return {
      toolCallId,
      toolName,
      input,
      ...(output === undefined ? {} : { output }),
    };
  }

  return null;
}

function toolOutputFromDynamicTool(
  part: Extract<UIMessage["parts"][number], { type: "dynamic-tool" }>
): unknown {
  if (part.state === "output-available") {
    return part.output;
  }
  if (part.state === "output-error") {
    return { type: "error-text", value: part.errorText };
  }
  if (part.state === "output-denied") {
    const reason = part.approval.reason;
    return reason
      ? { type: "execution-denied", reason }
      : { type: "execution-denied" };
  }
  return undefined;
}

function toolOutputFromStaticTool(part: UIMessage["parts"][number]): unknown {
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
    return toolOutputErrorText(part);
  }

  if (part.state === "output-denied") {
    return toolOutputDenied(part);
  }

  return undefined;
}

function toolOutputErrorText(part: UIMessage["parts"][number]): unknown {
  if ("errorText" in part) {
    return { type: "error-text", value: part.errorText };
  }

  return { type: "error-text", value: "Tool error" };
}

function toolOutputDenied(part: UIMessage["parts"][number]): unknown {
  if (
    "approval" in part &&
    typeof part.approval === "object" &&
    part.approval !== null
  ) {
    const maybeReason = (part.approval as { reason?: unknown }).reason;
    const reason = typeof maybeReason === "string" ? maybeReason : undefined;
    return reason
      ? { type: "execution-denied", reason }
      : { type: "execution-denied" };
  }

  return { type: "execution-denied" };
}

export const aiSdkRenderer: PromptRenderer<readonly ModelMessage[]> = {
  name: "ai-sdk",
  tokenString: markdownRenderer.tokenString,
  render: (element) => renderToAiSdkModelMessages(element),
  empty: () => [],
};

function renderToAiSdkModelMessages(
  root: PromptElement
): readonly ModelMessage[] {
  const messageNodes = collectMessageNodes(root);
  const result: ModelMessage[] = [];

  for (const messageNode of messageNodes) {
    result.push(...messageNodeToModelMessages(messageNode));
  }

  return result;
}

type MessageElement = Extract<PromptElement, { kind: "message" }>;

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

function messageNodeToModelMessages(
  messageNode: MessageElement
): ModelMessage[] {
  const role = messageNode.role;
  const parts = coalesceTextParts(collectSemanticParts(messageNode.children));

  const result: ModelMessage[] = [];
  let pendingNonTool: SemanticPart[] = [];
  let pendingToolResults: SemanticPart[] = [];

  const flushNonTool = () => {
    if (pendingNonTool.length === 0) {
      return;
    }
    result.push(toModelMessage(role, pendingNonTool));
    pendingNonTool = [];
  };

  const flushTool = () => {
    if (pendingToolResults.length === 0) {
      return;
    }
    result.push(toToolModelMessage(pendingToolResults));
    pendingToolResults = [];
  };

  for (const part of parts) {
    if (part.type === "tool-result") {
      flushNonTool();
      pendingToolResults.push(part);
      continue;
    }

    flushTool();
    pendingNonTool.push(part);
  }

  flushTool();
  flushNonTool();

  return result;
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
      return element.text.length === 0
        ? []
        : [{ type: "reasoning", text: element.text }];
    case "message":
      // A nested message inside a message is ambiguous for structured targets.
      // Ignore it for now (caller should flatten at the IR level).
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

function toModelMessage(
  role: string,
  parts: readonly SemanticPart[]
): ModelMessage {
  if (role === "system") {
    return { role: "system", content: partsToText(parts) };
  }

  if (role === "user") {
    return { role: "user", content: partsToText(parts) };
  }

  interface ModelReasoningPart {
    type: "reasoning";
    text: string;
  }

  const content: Array<TextPart | ModelReasoningPart | ToolCallPart> = [];
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

function toToolModelMessage(parts: readonly SemanticPart[]): ModelMessage {
  const content: ToolResultPart[] = [];
  for (const part of parts) {
    if (part.type !== "tool-result") {
      continue;
    }
    content.push({
      type: "tool-result",
      toolCallId: part.toolCallId,
      toolName: part.toolName,
      output: coerceToolResultOutput(part.output),
    });
  }
  return { role: "tool", content };
}

function partsToText(parts: readonly SemanticPart[]): string {
  let result = "";
  for (const part of parts) {
    if (part.type === "text") {
      result += part.text;
    }
  }
  return result;
}

function coerceToolResultOutput(output: unknown): ToolResultPart["output"] {
  if (typeof output === "string") {
    return { type: "text", value: output };
  }

  if (isToolResultOutput(output)) {
    return output;
  }

  if (isJsonValue(output)) {
    return { type: "json", value: output };
  }

  return { type: "text", value: safeJsonStringify(output) };
}

function isToolResultOutput(value: unknown): value is ToolResultPart["output"] {
  if (!isRecord(value)) {
    return false;
  }
  interface ToolResultOutputLike {
    type?: unknown;
    value?: unknown;
    reason?: unknown;
  }

  const output = value as ToolResultOutputLike;
  if (typeof output.type !== "string") {
    return false;
  }

  if (output.type === "text") {
    return typeof output.value === "string";
  }
  if (output.type === "json") {
    return isJsonValue(output.value);
  }
  if (output.type === "execution-denied") {
    return output.reason === undefined || typeof output.reason === "string";
  }
  if (output.type === "error-text") {
    return typeof output.value === "string";
  }
  if (output.type === "error-json") {
    return isJsonValue(output.value);
  }

  return false;
}

type JsonValue =
  | null
  | string
  | number
  | boolean
  | { [key: string]: JsonValue }
  | JsonValue[];

function isJsonValue(
  value: unknown,
  seen: Set<unknown> = new Set()
): value is JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return true;
  }

  if (typeof value !== "object") {
    return false;
  }

  if (seen.has(value)) {
    return false;
  }
  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      if (!isJsonValue(item, seen)) {
        return false;
      }
    }
    return true;
  }

  for (const [key, entry] of Object.entries(value)) {
    if (typeof key !== "string") {
      return false;
    }
    if (!isJsonValue(entry, seen)) {
      return false;
    }
  }

  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function safeJsonStringify(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value === undefined) {
    return "undefined";
  }
  try {
    return JSON.stringify(value, null, 2) ?? "null";
  } catch {
    return String(value);
  }
}
