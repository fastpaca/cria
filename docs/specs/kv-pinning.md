# KV Pinning Spec (Automatic, Budget-Aware)

## Status

- Draft
- Owner: Cria core
- Scope: KV-backed “pinned context” that injects itself into prompts

## Problem

Cria has great compaction primitives (`summary`, `last`, `truncate`, `omit`) and
retrieval (`vectorSearch`), but KV memory is currently “manual wiring.” You can
store data, yet there is no opinionated way to:

- Mark some KV entries as “always include these.”
- Inject those entries automatically at render time.
- Keep pinning compatible with budgets and compaction.

We want KV pinning to feel as seamless as `Summary`: you wire it once and it
keeps working under pressure.

## Goals

- Make KV pinning a first-class, composable DSL feature.
- Work with the existing `KVMemory` interface (`get/set/delete`) without
  requiring store-wide scans.
- Be budget-aware by default.
- Keep the mental model crisp:
  1. “Pin” is a persistence concern.
  2. “Inject pinned” is a prompt concern.
  3. Budgets still decide what survives.

## Non-goals

- Full “memory system” design (importance scoring, embeddings, schema learning).
- Store-native indexing APIs or breaking the `KVMemory` contract.
- Perfect cross-process atomicity. We can improve this later if needed.

## Constraints From Today’s Architecture

- `KVMemory` has no `list()`/`scan()` capability.
- Compaction is scope-based and requires a strategy to shrink.
- Providers own token counting, so budget logic must stay in the render path.

## Proposed Design Overview

Introduce three small pieces that compose well:

1. A pin registry that stores an index of pinned keys inside KV.
2. An async DSL component that injects pinned entries into the tree.
3. Opinionated defaults for formatting, ordering, and compaction.

This mirrors the successful `Summary` + `VectorSearch` pattern.

## API Sketch (Type-Level)

These are sketches, not final types.

### Pin Registry Utilities

```ts
export interface PinMetadata {
  label?: string;
  role?: "system" | "developer" | "user";
  priority?: number;
  tags?: readonly string[];
  updatedAt?: number;
}

export interface PinRegistryOptions {
  namespace: string;
  indexKey?: string; // default: "__cria:pins:v1__"
}

export interface PinRegistry {
  pin(key: string, metadata?: PinMetadata): Promise<void>;
  unpin(key: string): Promise<void>;
  list(): Promise<readonly { key: string; metadata: PinMetadata }[]>;
}

export function createPinRegistry<T>(
  store: KVMemory<T>,
  options: PinRegistryOptions
): PinRegistry;
```

### Prompt Injection Component

```ts
export interface PinnedKVProps<T> {
  registry: PinRegistry;
  store: KVMemory<T>;
  format?: (entry: { key: string; data: T; metadata: PinMetadata }) => string;
  maxPins?: number; // default: 20
  strategy?: "omit" | { truncateTokens: number };
  priority?: number; // compaction priority for the pinned block
  role?: "system" | "developer"; // default: "developer"
}

// Async component like VectorSearch
export function PinnedKV<T>(
  props: PinnedKVProps<T>
): Promise<PromptScope>;
```

### Fluent DSL Ergonomics

```ts
// Pin/unpin helpers (persistence side)
await cria.pin(store, { namespace: "user:123" }).pin("profile", {
  label: "User profile",
});

// Injection side (prompt composition)
const prompt = cria
  .prompt(provider)
  .pinnedKV({
    store,
    namespace: "user:123",
    priority: 1,
    strategy: { truncateTokens: 1200 },
  })
  .summary(cria.input(history), { id: "history", store: summaryStore });
```

Notes:

- Pinning and injection can be used independently.
- Injection should also accept a raw `registry` so advanced users can bring
  their own registry implementation.

## Data Model: Pin Index Stored In KV

Because `KVMemory` cannot list keys, we store an explicit index entry.

### Reserved Index Entry

- Key: `__cria:pins:v1__:${namespace}`
- Value shape:

```ts
interface StoredPinIndex {
  version: 1;
  pins: Record<
    string,
    {
      label?: string;
      role?: "system" | "developer" | "user";
      priority?: number;
      tags?: readonly string[];
      updatedAt: number;
    }
  >;
  updatedAt: number;
}
```

Behavior:

- `pin(key, metadata)` upserts `pins[key]`.
- `unpin(key)` deletes `pins[key]`.
- `list()` reads the index and returns entries sorted by:
  1. Highest explicit `metadata.priority` first (more important pins earlier).
  2. Most recently updated first.

This is intentionally simple and works across in-memory, Redis, and Postgres.

## Injection Semantics (Budget-Aware Defaults)

Pinned KV should not become a “budget bypass.” The default behavior must be
predictable under budgets.

### Injection Shape

- The component renders a single scoped message that contains all formatted
  pins.
- That scope is shrinkable by default.

Suggested default strategy:

- `strategy: { truncateTokens: 1200 }` (token-capped pinned block)
- `priority: 1` (kept ahead of older history but below system rules)
- `role: "developer"` (keeps system channel clean by default)

This aligns with the priorities guidance in `fit-and-compaction.md`.

### Default Formatter

The built-in formatter should be explicit and easy to skim:

```text
Pinned context:
- profile (User profile)
  {"name":"Sam","timezone":"America/Los_Angeles"}
- preferences
  {"tone":"concise","units":"metric"}
```

Details:

- Non-string data is serialized with `JSON.stringify(data)`.
- Formatter must be overridable.

## Algorithm Sketch

At render time:

1. Load the pin index for the namespace.
2. Select pins:
   - Apply `maxPins`.
   - Skip pins whose KV entries are missing.
3. Fetch entries in parallel with `Promise.all`.
4. Order pins deterministically using the index metadata.
5. Format into one message.
6. Wrap in a shrinkable scope (truncate or omit).

Failure modes:

- Missing index: inject nothing.
- Missing KV entry for a pin: silently skip (optionally expose a hook later).
- Formatter throws: surface a descriptive `Error`.

## Similar Seamless Features (Follow-Ups)

These can share the same architecture (registry + async injection + shrinkable
default scope).

1. Auto-summary pinning:
   - Treat the `Summary` output as a pinned KV entry that is always injected.
   - This makes summaries survive even if the history scope is omitted.
2. “Pinned tools ledger”:
   - Persist a compact tool-results ledger in KV and inject it like a pin.
3. Policy pinning:
   - Pin safety or product policies per user/org/tenant namespace.
4. Pin budgets:
   - Reserve a sub-budget for pins (e.g., `pinBudget: 1200`) so they never
     starve the rest of the prompt.

## Rollout Plan (Incremental, Low Risk)

### Phase 1: Spec + internal helpers

- Add registry helpers and the stored index model.
- No DSL changes required yet.

### Phase 2: Injection component

- Add `PinnedKV` async component.
- Provide a small, opinionated default formatter.

### Phase 3: Fluent DSL ergonomics

- Add `.pinnedKV(...)` on `PromptBuilder`.
- Add `cria.pin(store, { namespace })` convenience helper.

### Phase 4: Observability + guardrails

- Hooks for “pins loaded / pins skipped / pins truncated.”
- Clear errors for invalid namespaces or overly large pin sets.

## Open Questions

- Should pin metadata live only in the index, or also be written to each entry’s
  `metadata` field?
- Do we want multi-message pin rendering (one message per pin) for finer
  compaction?
- Should `pinnedKV` default to `developer` or `system` role?
- Do we need a first-class “pin budget” in the fit loop, or is truncate good
  enough to start?

