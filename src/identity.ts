import type { PromptElement, PromptNodeKind } from "./types";

export type PromptElementPath = readonly number[];

export type HashFunction = (input: string) => string;

export type AssignPromptElementIdsOptions = {
  /** Preserve existing ids when present. Default: true. */
  preserveExistingIds?: boolean;
  /** Hash function used to derive ids. */
  hash?: HashFunction;
  /** Optional prefix for generated ids. */
  idPrefix?: string;
};

/**
 * Locate a node by its position within the current prompt tree.
 *
 * The path is an index into the canonical children array (including strings),
 * so it is unstable across insertions, removals, or renormalization.
 */
export function locatePromptElementPath(
  root: PromptElement,
  target: PromptElement
): PromptElementPath | null {
  const path: number[] = [];
  const found = walkPromptElementPath(root, target, path);
  return found ? path.slice() : null;
}

type StableJsonValue =
  | null
  | string
  | number
  | boolean
  | StableJsonValue[]
  | { [key: string]: StableJsonValue };

type HashSeed = {
  priority: number;
  children: string[];
  kind?: PromptNodeKind;
  role?: string;
  toolCallId?: string;
  toolName?: string;
  text?: string;
  input?: StableJsonValue;
  output?: StableJsonValue;
};

type HashWalkResult = {
  element: PromptElement;
  hash: string;
};

/**
 * Assign deterministic content-hash ids to every node in the tree.
 *
 * Ids are derived from stable content (no strategy/context/id), so edits change ids.
 */
export function assignPromptElementIds(
  root: PromptElement,
  options: AssignPromptElementIdsOptions = {}
): PromptElement {
  const {
    preserveExistingIds = true,
    hash,
    idPrefix = "",
  } = options;
  if (!hash) {
    throw new Error("assignPromptElementIds requires options.hash.");
  }
  const hashFn = hash;
  const seen = new Map<string, number>();

  const walk = (element: PromptElement): HashWalkResult => {
    const childResults = element.children.map((child) =>
      typeof child === "string" ? child : walk(child)
    );

    const childTokens = childResults.map((child) =>
      typeof child === "string" ? `t:${child}` : `h:${child.hash}`
    );

    const seed = buildHashSeed(element, childTokens);
    const hashValue = hashFn(stableStringify(seed));

    const children = childResults.map((child) =>
      typeof child === "string" ? child : child.element
    );

    let id: string;
    if (preserveExistingIds && element.id !== undefined) {
      id = element.id;
      markSeen(id, seen);
    } else {
      id = ensureUnique(`${idPrefix}${hashValue}`, seen);
    }

    return {
      element: { ...element, id, children },
      hash: hashValue,
    };
  };

  return walk(root).element;
}

function walkPromptElementPath(
  element: PromptElement,
  target: PromptElement,
  path: number[]
): boolean {
  if (element === target) {
    return true;
  }

  for (const [index, child] of element.children.entries()) {
    if (typeof child === "string") {
      continue;
    }

    path.push(index);
    if (walkPromptElementPath(child, target, path)) {
      return true;
    }
    path.pop();
  }

  return false;
}

function buildHashSeed(element: PromptElement, children: string[]): HashSeed {
  const seed: HashSeed = {
    priority: element.priority,
    children,
  };

  if (element.kind !== undefined) {
    seed.kind = element.kind;
  }

  switch (element.kind) {
    case "message":
      seed.role = element.role;
      break;
    case "tool-call":
      seed.toolCallId = element.toolCallId;
      seed.toolName = element.toolName;
      seed.input = stableJsonValue(element.input, new WeakSet());
      break;
    case "tool-result":
      seed.toolCallId = element.toolCallId;
      seed.toolName = element.toolName;
      seed.output = stableJsonValue(element.output, new WeakSet());
      break;
    case "reasoning":
      seed.text = element.text;
      break;
    default:
      break;
  }

  return seed;
}

function ensureUnique(base: string, seen: Map<string, number>): string {
  const count = seen.get(base);
  if (count === undefined) {
    seen.set(base, 1);
    return base;
  }

  const next = `${base}-${count}`;
  seen.set(base, count + 1);
  return next;
}

function markSeen(id: string, seen: Map<string, number>): void {
  const count = seen.get(id);
  if (count === undefined) {
    seen.set(id, 1);
    return;
  }
  seen.set(id, count + 1);
}

function stableStringify(value: unknown): string {
  return JSON.stringify(stableJsonValue(value, new WeakSet()));
}

function stableJsonValue(
  value: unknown,
  seen: WeakSet<object>
): StableJsonValue {
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
    return value.map((entry) => stableJsonValue(entry, seen));
  }

  if (valueType === "object") {
    if (seen.has(value)) {
      return "[Circular]";
    }

    if (value instanceof Date) {
      return value.toISOString();
    }

    seen.add(value);

    if (!isPlainRecord(value)) {
      return String(value);
    }

    const result: Record<string, StableJsonValue> = {};
    for (const key of Object.keys(value).sort()) {
      result[key] = stableJsonValue(value[key], seen);
    }
    return result;
  }

  return String(value);
}

function isPlainRecord(value: object): value is Record<string, unknown> {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
