import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";
import type { RenderHooks } from "./render";
import { markdownRenderer } from "./renderers/markdown";
import type {
  MaybePromise,
  PromptElement,
  PromptRenderer,
  PromptRole,
  Tokenizer,
} from "./types";

export type SnapshotChild = string | SnapshotElement;

export interface SnapshotElement
  extends Omit<PromptElement, "children" | "strategy" | "context"> {
  children: SnapshotChild[];
  tokens: number;
  hash: string;
}

export interface Snapshot {
  root: SnapshotElement;
  totalTokens: number;
  hash: string;
}

export interface SnapshotOptions {
  tokenizer: Tokenizer;
  renderer?: PromptRenderer<unknown>;
}

export interface SnapshotHooksOptions {
  tokenizer: Tokenizer;
  renderer?: PromptRenderer<unknown>;
  onSnapshot: (snapshot: Snapshot) => MaybePromise<void>;
}

/**
 * Create a deterministic snapshot of a fitted prompt tree.
 *
 * - Keeps the tree structure (no flattening) and mirrors PromptElement shape.
 * - Adds per-node token counts (using renderer.tokenString) and stable hashes.
 * - Excludes strategy/context from the snapshot; this is for observability only.
 */
export function createSnapshot(
  element: PromptElement,
  { tokenizer, renderer = markdownRenderer }: SnapshotOptions
): Snapshot {
  const root = snapshotElement(element, tokenizer, renderer);
  return {
    root,
    totalTokens: root.tokens,
    hash: root.hash,
  };
}

export function createSnapshotHooks({
  tokenizer,
  renderer,
  onSnapshot,
}: SnapshotHooksOptions): RenderHooks {
  return {
    onFitComplete: async (event) => {
      if (!event.result) {
        return;
      }
      const snapshot = createSnapshot(event.result, {
        tokenizer,
        renderer,
      });
      await onSnapshot(snapshot);
    },
  };
}

export interface DiffEntry {
  path: readonly number[];
  node: SnapshotChild;
}

export interface DiffChange {
  path: readonly number[];
  before: SnapshotChild;
  after: SnapshotChild;
}

export interface SnapshotDiff {
  added: DiffEntry[];
  removed: DiffEntry[];
  changed: DiffChange[];
}

export function diffSnapshots(before: Snapshot, after: Snapshot): SnapshotDiff {
  const added: DiffEntry[] = [];
  const removed: DiffEntry[] = [];
  const changed: DiffChange[] = [];

  compareNodes(before.root, after.root, [], added, removed, changed);

  return { added, removed, changed };
}

function compareNodes(
  before: SnapshotChild,
  after: SnapshotChild,
  path: number[],
  added: DiffEntry[],
  removed: DiffEntry[],
  changed: DiffChange[]
): void {
  if (handlePrimitives(before, after, path, added, removed, changed)) {
    return;
  }

  const beforeElement = before as SnapshotElement;
  const afterElement = after as SnapshotElement;

  recordElementChange(beforeElement, afterElement, path, changed);
  compareChildren(beforeElement, afterElement, path, added, removed, changed);
}

function handlePrimitives(
  before: SnapshotChild,
  after: SnapshotChild,
  path: readonly number[],
  added: DiffEntry[],
  removed: DiffEntry[],
  changed: DiffChange[]
): boolean {
  if (typeof before === "string" && typeof after === "string") {
    if (before !== after) {
      changed.push({ path, before, after });
    }
    return true;
  }

  if (typeof before === "string") {
    removed.push({ path, node: before });
    added.push({ path, node: after });
    return true;
  }

  if (typeof after === "string") {
    removed.push({ path, node: before });
    added.push({ path, node: after });
    return true;
  }

  return false;
}

function recordElementChange(
  before: SnapshotElement,
  after: SnapshotElement,
  path: readonly number[],
  changed: DiffChange[]
): void {
  const identityChanged = elementIdentity(before) !== elementIdentity(after);
  const contentChanged =
    before.hash !== after.hash || before.tokens !== after.tokens;
  if (identityChanged || contentChanged) {
    changed.push({ path, before, after });
  }
}

function compareChildren(
  before: SnapshotElement,
  after: SnapshotElement,
  path: number[],
  added: DiffEntry[],
  removed: DiffEntry[],
  changed: DiffChange[]
): void {
  const maxChildren = Math.max(before.children.length, after.children.length);
  for (let i = 0; i < maxChildren; i++) {
    const beforeChild = before.children[i];
    const afterChild = after.children[i];
    const childPath = [...path, i];

    if (beforeChild === undefined && afterChild !== undefined) {
      added.push({ path: childPath, node: afterChild });
      continue;
    }
    if (beforeChild !== undefined && afterChild === undefined) {
      removed.push({ path: childPath, node: beforeChild });
      continue;
    }
    if (beforeChild !== undefined && afterChild !== undefined) {
      compareNodes(beforeChild, afterChild, childPath, added, removed, changed);
    }
  }
}

function elementIdentity(element: SnapshotElement): string {
  return element.id ?? `${element.kind ?? "region"}:${element.priority}`;
}

function snapshotElement(
  element: PromptElement,
  tokenizer: Tokenizer,
  renderer: PromptRenderer<unknown>
): SnapshotElement {
  const childSnapshots = element.children.map(
    (child): SnapshotChild =>
      typeof child === "string"
        ? child
        : snapshotElement(child, tokenizer, renderer)
  );

  const contentProjection = renderer.tokenString(element);
  const tokens = tokenizer(contentProjection);
  const childHashes = childSnapshots.map((child): string =>
    typeof child === "string" ? hashString(child) : child.hash
  );

  const hash = hashElement({
    kind: element.kind,
    priority: element.priority,
    role: element.kind === "message" ? element.role : undefined,
    text: element.kind === "reasoning" ? element.text : undefined,
    toolCallId:
      element.kind === "tool-call" || element.kind === "tool-result"
        ? element.toolCallId
        : undefined,
    toolName:
      element.kind === "tool-call" || element.kind === "tool-result"
        ? element.toolName
        : undefined,
    id: element.id,
    tokens,
    childHashes,
  });

  return {
    ...element,
    children: childSnapshots,
    tokens,
    hash,
  };
}

function hashElement(input: {
  kind: PromptElement["kind"];
  priority: number;
  role?: PromptRole;
  text?: string;
  toolCallId?: string;
  toolName?: string;
  id?: string;
  tokens: number;
  childHashes: string[];
}): string {
  const payload = {
    kind: input.kind ?? "region",
    priority: input.priority,
    role: input.role,
    text: input.text,
    toolCallId: input.toolCallId,
    toolName: input.toolName,
    id: input.id,
    tokens: input.tokens,
    children: input.childHashes,
  };
  return hashString(JSON.stringify(payload));
}

function hashString(value: string): string {
  return bytesToHex(sha256(utf8ToBytes(value)));
}
