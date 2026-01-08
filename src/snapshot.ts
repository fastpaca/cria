import { createHash } from "node:crypto";
import { markdownRenderer } from "./renderers/markdown";
import type {
  PromptElement,
  PromptNodeKind,
  PromptRenderer,
  PromptRole,
  Tokenizer,
} from "./types";

/**
 * Snapshots are deterministic, post-fit projections of the prompt tree for
 * observability and diffing. They flatten the fitted IR into nodes with
 * stable identity (prefer explicit ids, otherwise positional paths),
 * include per-node token counts using the renderer's tokenString, and
 * produce a stable hash. Rendering/strategies still work on the IR; snapshots
 * exist only for tooling (diffs, caching, tracing).
 */
export interface SnapshotNode {
  nodeType: "element" | "text";
  path: readonly number[];
  /** Prefer explicit ids for stable identity; fall back to positional path. */
  id?: string;
  kind?: PromptNodeKind;
  priority?: number;
  role?: PromptRole;
  text?: string;
  toolCallId?: string;
  toolName?: string;
  content?: string;
  tokens: number;
}

export interface Snapshot {
  nodes: SnapshotNode[];
  totalTokens: number;
  hash: string;
}

export interface SnapshotOptions {
  tokenizer: Tokenizer;
  renderer?: PromptRenderer<unknown>;
}

export function createSnapshot(
  element: PromptElement,
  { tokenizer, renderer = markdownRenderer }: SnapshotOptions
): Snapshot {
  const nodes: SnapshotNode[] = [];
  collectNodes(element, [], tokenizer, renderer, nodes);

  const totalTokens = nodes.reduce((sum, node) => sum + node.tokens, 0);
  const hash = hashSnapshot(nodes);

  return { nodes, totalTokens, hash };
}

export interface SnapshotDiff {
  added: SnapshotNode[];
  removed: SnapshotNode[];
  changed: Array<{
    path: readonly number[];
    before: SnapshotNode;
    after: SnapshotNode;
  }>;
}

export function diffSnapshots(
  before: Snapshot,
  after: Snapshot
): SnapshotDiff {
  const beforeMap = mapByKey(before.nodes);
  const afterMap = mapByKey(after.nodes);

  const added: SnapshotNode[] = [];
  const removed: SnapshotNode[] = [];
  const changed: SnapshotDiff["changed"] = [];

  for (const [key, node] of afterMap.entries()) {
    const prev = beforeMap.get(key);
    if (!prev) {
      added.push(node);
      continue;
    }
    if (!nodesEqual(prev, node)) {
      changed.push({
        path: node.path,
        before: prev,
        after: node,
      });
    }
  }

  for (const [key, node] of beforeMap.entries()) {
    if (!afterMap.has(key)) {
      removed.push(node);
    }
  }

  return { added, removed, changed };
}

function collectNodes(
  element: PromptElement,
  path: number[],
  tokenizer: Tokenizer,
  renderer: PromptRenderer<unknown>,
  nodes: SnapshotNode[]
): void {
  const node: SnapshotNode = {
    nodeType: "element",
    path: [...path],
    kind: element.kind,
    priority: element.priority,
    tokens: tokenizer(renderer.tokenString(element)),
  };

  if (element.id) {
    node.id = element.id;
  }

  switch (element.kind) {
    case "message":
      node.role = element.role;
      break;
    case "reasoning":
      node.text = element.text;
      break;
    case "tool-call":
      node.toolCallId = element.toolCallId;
      node.toolName = element.toolName;
      node.content = safeStringify(element.input);
      break;
    case "tool-result":
      node.toolCallId = element.toolCallId;
      node.toolName = element.toolName;
      node.content = safeStringify(element.output);
      break;
    default:
      break;
  }

  nodes.push(node);

  for (const [index, child] of element.children.entries()) {
    if (typeof child === "string") {
      nodes.push({
        nodeType: "text",
        path: [...path, index],
        content: child,
        tokens: tokenizer(child),
      });
      continue;
    }
    collectNodes(child, [...path, index], tokenizer, renderer, nodes);
  }
}

function hashSnapshot(nodes: SnapshotNode[]): string {
  const serialized = stableStringify(nodes);
  const hash = createHash("sha256");
  hash.update(serialized);
  return hash.digest("hex");
}

function mapByKey(nodes: SnapshotNode[]): Map<string, SnapshotNode> {
  const map = new Map<string, SnapshotNode>();
  for (const node of nodes) {
    const key = node.id ? `id:${node.id}` : `path:${node.path.join(".")}`;
    map.set(key, node);
  }
  return map;
}

function nodesEqual(a: SnapshotNode, b: SnapshotNode): boolean {
  return stableStringify(a) === stableStringify(b);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>).sort(
    ([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)
  );
  const serializedEntries = entries.map(
    ([key, val]) => `${JSON.stringify(key)}:${stableStringify(val)}`
  );
  return `{${serializedEntries.join(",")}}`;
}

function safeStringify(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value) ?? "null";
  } catch {
    return String(value);
  }
}
