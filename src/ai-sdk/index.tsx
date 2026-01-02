import type { ModelMessage, ToolResultPart, UIMessage } from "ai";
import {
  Message,
  Reasoning,
  Region,
  ToolCall,
  ToolResult,
} from "../components";
import { markdownRenderer } from "../renderers/markdown";
import type {
  PromptChildren,
  PromptElement,
  PromptRenderer,
  Strategy,
} from "../types";

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

  return (
    <Region priority={0} {...(id === undefined ? {} : { id })}>
      {messages.map((message) => (
        <UIMessageElement
          includeReasoning={includeReasoning}
          message={message}
          priorities={resolvedPriorities}
        />
      ))}
    </Region>
  );
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
        if (!toolInvocation) {
          return null;
        }

        const toolCall = (
          <ToolCall
            input={toolInvocation.input}
            priority={priorities.toolCall}
            strategy={omitStrategy}
            toolCallId={toolInvocation.toolCallId}
            toolName={toolInvocation.toolName}
          />
        );

        if (toolInvocation.output === undefined) {
          return toolCall;
        }

        return [
          toolCall,
          <ToolResult
            output={toolInvocation.output}
            priority={priorities.toolResult}
            strategy={omitStrategy}
            toolCallId={toolInvocation.toolCallId}
            toolName={toolInvocation.toolName}
          />,
        ];
      })}
    </Message>
  );
}

function resolvePriorities(
  priorities: Partial<Priorities> | undefined
): Priorities {
  if (!priorities) {
    return DEFAULT_PRIORITIES;
  }

  return {
    system: priorities.system ?? DEFAULT_PRIORITIES.system,
    user: priorities.user ?? DEFAULT_PRIORITIES.user,
    assistant: priorities.assistant ?? DEFAULT_PRIORITIES.assistant,
    toolCall: priorities.toolCall ?? DEFAULT_PRIORITIES.toolCall,
    toolResult: priorities.toolResult ?? DEFAULT_PRIORITIES.toolResult,
    reasoning: priorities.reasoning ?? DEFAULT_PRIORITIES.reasoning,
  };
}

function rolePriority(role: UIMessage["role"], priorities: Priorities): number {
  if (role === "system") {
    return priorities.system;
  }
  if (role === "user") {
    return priorities.user;
  }
  return priorities.assistant;
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

function partsToText(parts: readonly SemanticPart[]): string {
  let result = "";
  for (const part of parts) {
    if (part.type === "text") {
      result += part.text;
    }
  }
  return result;
}
