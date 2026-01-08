import type { PromptElement, PromptNodeKind } from "./types";

export type JsonValue =
  | null
  | string
  | number
  | boolean
  | { [key: string]: JsonValue }
  | JsonValue[];

type PromptNodeKindValue = Exclude<PromptNodeKind, undefined>;

export type SerializedPromptElement = {
  priority: number;
  children: SerializedPromptChildren;
  id?: string;
  kind?: PromptNodeKindValue;
  role?: string;
  toolCallId?: string;
  toolName?: string;
  input?: JsonValue;
  output?: JsonValue;
  text?: string;
};

export type SerializedPromptChild = SerializedPromptElement | string;
export type SerializedPromptChildren = SerializedPromptChild[];

export type SerializePromptElementOptions = {
  /** Serialize tool input/output with a custom function (defaults to safe JSON). */
  serializeData?: (value: unknown) => JsonValue;
};

export type InspectPromptElementOptions = {
  indent?: number;
  serializeData?: (value: unknown) => JsonValue;
};

export function serializePromptElement(
  element: PromptElement,
  options: SerializePromptElementOptions = {}
): SerializedPromptElement {
  const serializeData = options.serializeData ?? safeJsonValue;
  const children = serializePromptChildren(element.children, serializeData);
  const result: SerializedPromptElement = {
    priority: element.priority,
    children,
  };

  if (element.id !== undefined) {
    result.id = element.id;
  }

  if (element.kind !== undefined) {
    result.kind = element.kind;
  }

  switch (element.kind) {
    case "message":
      result.role = element.role;
      break;
    case "tool-call":
      result.toolCallId = element.toolCallId;
      result.toolName = element.toolName;
      result.input = serializeData(element.input);
      break;
    case "tool-result":
      result.toolCallId = element.toolCallId;
      result.toolName = element.toolName;
      result.output = serializeData(element.output);
      break;
    case "reasoning":
      result.text = element.text;
      break;
    default:
      break;
  }

  return result;
}

export function inspectPromptElement(
  element: PromptElement,
  options: InspectPromptElementOptions = {}
): string {
  const { indent = 2, serializeData } = options;
  const serialized = serializePromptElement(element, { serializeData });
  return JSON.stringify(serialized, null, indent);
}

function serializePromptChildren(
  children: PromptElement["children"],
  serializeData: (value: unknown) => JsonValue
): SerializedPromptChildren {
  return children.map((child) =>
    typeof child === "string"
      ? child
      : serializePromptElement(child, { serializeData })
  );
}

function safeJsonValue(value: unknown): JsonValue {
  if (value === null) {
    return null;
  }

  const valueType = typeof value;

  if (valueType === "string" || valueType === "boolean") {
    return value;
  }

  if (valueType === "number") {
    return Number.isFinite(value) ? value : String(value);
  }

  if (valueType === "bigint") {
    return value.toString();
  }

  if (valueType === "symbol") {
    return value.description ? `Symbol(${value.description})` : "Symbol";
  }

  if (valueType === "function") {
    const name = value.name?.trim();
    return name ? `[Function ${name}]` : "[Function]";
  }

  if (Array.isArray(value)) {
    return value.map(safeJsonValue);
  }

  if (valueType === "object") {
    if (!isPlainRecord(value)) {
      return String(value);
    }

    const result: Record<string, JsonValue> = {};
    for (const [key, entry] of Object.entries(value)) {
      result[key] = safeJsonValue(entry);
    }
    return result;
  }

  return String(value);
}

function isPlainRecord(value: object): value is Record<string, unknown> {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
