import type { PromptChildren, PromptElement, PromptNodeKind } from "./types";

export function isPromptChildren(value: unknown): value is PromptChildren {
  if (!Array.isArray(value)) {
    return false;
  }

  for (const child of value) {
    if (typeof child === "string") {
      continue;
    }
    if (!isPromptElement(child)) {
      return false;
    }
  }

  return true;
}

export function assertPromptChildren(
  value: unknown,
  label = "PromptChildren"
): asserts value is PromptChildren {
  if (!isPromptChildren(value)) {
    throw new Error(`${label} must be a flat array of string | PromptElement.`);
  }
}

export function isPromptElement(value: unknown): value is PromptElement {
  if (!isRecord(value)) {
    return false;
  }

  if (!isFiniteNumber(value.priority)) {
    return false;
  }

  if (!isPromptChildren(value.children)) {
    return false;
  }

  if (value.strategy !== undefined && typeof value.strategy !== "function") {
    return false;
  }

  if (value.id !== undefined) {
    if (typeof value.id !== "string") {
      return false;
    }
    if (value.id.trim().length === 0) {
      return false;
    }
  }

  if (value.context !== undefined && !isRecord(value.context)) {
    return false;
  }

  return isValidKind(value);
}

export function assertPromptElement(
  value: unknown,
  label = "PromptElement"
): asserts value is PromptElement {
  if (!isPromptElement(value)) {
    throw new Error(`${label} must be a valid PromptElement.`);
  }
}

export function findDuplicatePromptElementIds(
  root: PromptElement
): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  const walk = (element: PromptElement): void => {
    if (element.id !== undefined) {
      if (seen.has(element.id)) {
        duplicates.add(element.id);
      } else {
        seen.add(element.id);
      }
    }

    for (const child of element.children) {
      if (typeof child === "string") {
        continue;
      }
      walk(child);
    }
  };

  walk(root);

  return Array.from(duplicates);
}

export function assertPromptElementIdsUnique(
  root: PromptElement,
  label = "PromptElement"
): void {
  const duplicates = findDuplicatePromptElementIds(root);
  if (duplicates.length > 0) {
    throw new Error(
      `${label} ids must be unique. Duplicate ids: ${duplicates.join(", ")}.`
    );
  }
}

function isValidKind(value: Record<string, unknown>): boolean {
  const kind = value.kind as PromptNodeKind | undefined;

  if (kind === undefined) {
    return true;
  }

  if (kind === "message") {
    return typeof value.role === "string";
  }

  if (kind === "tool-call") {
    return (
      typeof value.toolCallId === "string" &&
      typeof value.toolName === "string" &&
      "input" in value
    );
  }

  if (kind === "tool-result") {
    return (
      typeof value.toolCallId === "string" &&
      typeof value.toolName === "string" &&
      "output" in value
    );
  }

  if (kind === "reasoning") {
    return typeof value.text === "string";
  }

  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
