import type {
  AssistantMessage,
  PromptMessage,
  PromptMessageNode,
  PromptPart,
  ProviderToolIO,
  ToolCallPart,
  ToolResultPart,
} from "./types";

export function buildMessageFromNode<TToolIO extends ProviderToolIO>(
  node: PromptMessageNode<TToolIO>
): PromptMessage<TToolIO> {
  if (node.role === "tool") {
    return buildToolMessage(node.children);
  }

  if (node.role === "assistant") {
    return buildAssistantMessage(node.children);
  }

  return buildTextMessage(node.role, node.children);
}

function buildToolMessage<TToolIO extends ProviderToolIO>(
  children: readonly PromptPart<TToolIO>[]
): PromptMessage<TToolIO> {
  // Tool messages are a single tool result by construction.
  if (children.length !== 1 || children[0]?.type !== "tool-result") {
    throw new Error("Tool messages must contain exactly one tool result.");
  }
  const result = children[0] as ToolResultPart<TToolIO>;
  return {
    role: "tool",
    toolCallId: result.toolCallId,
    toolName: result.toolName,
    output: result.output,
  };
}

function buildAssistantMessage<TToolIO extends ProviderToolIO>(
  children: readonly PromptPart<TToolIO>[]
): AssistantMessage<TToolIO> {
  const { text, reasoning, toolCalls } = collectAssistantParts(children);

  const message: AssistantMessage<TToolIO> = { role: "assistant", text };
  if (reasoning.length > 0) {
    message.reasoning = reasoning;
  }
  if (toolCalls.length > 0) {
    message.toolCalls = toolCalls;
  }
  return message;
}

function collectAssistantParts<TToolIO extends ProviderToolIO>(
  children: readonly PromptPart<TToolIO>[]
): {
  text: string;
  reasoning: string;
  toolCalls: ToolCallPart<TToolIO>[];
} {
  let text = "";
  let reasoning = "";
  const toolCalls: ToolCallPart<TToolIO>[] = [];

  for (const part of children) {
    if (part.type === "text") {
      text += part.text;
      continue;
    }
    if (part.type === "reasoning") {
      reasoning += part.text;
      continue;
    }
    if (part.type === "tool-call") {
      toolCalls.push(part);
      continue;
    }
    if (part.type === "tool-result") {
      // Tool results must live in tool messages, not assistant messages.
      throw new Error("Tool results must be inside a tool message.");
    }
  }

  return { text, reasoning, toolCalls };
}

function buildTextMessage<TToolIO extends ProviderToolIO>(
  role: PromptMessage<TToolIO>["role"],
  children: readonly PromptPart<TToolIO>[]
): PromptMessage<TToolIO> {
  // System/user messages are text-only; other parts are rejected here.
  const text = collectTextParts(children);

  if (role === "system") {
    return { role: "system", text };
  }

  if (role === "developer") {
    return { role: "developer", text };
  }

  if (role === "user") {
    return { role: "user", text };
  }

  throw new Error(`Unsupported message role: ${role}`);
}

function collectTextParts<TToolIO extends ProviderToolIO>(
  children: readonly PromptPart<TToolIO>[]
): string {
  let text = "";
  for (const part of children) {
    if (part.type !== "text") {
      throw new Error(
        "Only assistant messages may contain reasoning or tool calls."
      );
    }
    text += part.text;
  }
  return text;
}
