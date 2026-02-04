# Prompt Plugins (Use-Only) Spec

## Summary

Cria becomes plugin-first. Prompt composition stays fluent, but specialized DSL
methods are replaced by renderable plugins. `.use(plugin)` inserts a plugin's
rendered prompt content at that exact location in the builder chain.

Plugins own both read and write behavior (optional write helpers), fixing the
current boilerplate and drift between summary text, vector indexing, and prompt
rendering.

## Goals

- `.use(plugin)` is the single explicit insertion point.
- Plugins are prompt component producers (render to `ScopeContent`).
- Configuration happens outside `.use` (no `use(plugin, opts)`).
- Reduce DSL surface by removing specialized summary/vector-search methods.
- Fix write-path gaps by letting plugins own the write path.

## Non-goals

- No separate "MemoryPlugin" interface.
- No implicit context propagation from builder into plugins.
- No change to core prompt tree or render pipeline semantics.

## Core Contract

```ts
interface PromptPlugin<P = unknown> {
  render(): ScopeContent<P> | Promise<ScopeContent<P>>;
}
```

### Builder API

```ts
prompt.use(plugin: PromptPlugin): PromptBuilder
```

`.use` merges `plugin.render()` into the builder at the call site. No
configuration or overrides are accepted in `.use`.

## DSL Changes

### Keep

- `.system`, `.user`, `.assistant`, `.developer`, `.message`
- `.scope`, `.merge`, `.prefix`, `.pin`, `.providerScope` (if still needed)
- `.truncate`, `.omit`, `.last` (for now)

### Add

- `.use(plugin)`

### Remove / Deprecate (migrate to plugins)

- `.summary(...)`
- `.vectorSearch(...)`

## Built-in Plugins

### Summary plugin

Class:

```ts
import { Summary } from "@fastpaca/cria";

const summary = new Summary({
  id,
  store,
  metadata?,   // optional metadata for stored summaries (user/session ids)
  summarize?,  // optional custom summarizer
  provider?,   // explicit provider for default summarizer
  role?,       // message role to emit
  priority?,   // compaction priority
}).extend(messages);
```

Usage:

```ts
prompt.use(summary);
```

Behavior:

- `render()` returns a scope with a compaction strategy, identical to current
  Summary behavior.
- The strategy reads and writes the summary store only when compaction triggers.

Optional write helper:

```ts
await summary.writeNow(); // explicit summary write path, same config
```

### Vector retrieval plugin

Class:

```ts
import { VectorDB } from "@fastpaca/cria";

const vectors = new VectorDB({ store, format? });

const retrieval = vectors.search({ query, limit });
prompt.use(retrieval);

await vectors.index({ id, data, metadata });
```

This keeps indexed content and rendered content aligned via a shared formatter.

## `.use` Semantics

- `.use(plugin)` inserts exactly where called.
- The plugin must already be configured.
- Async plugins are supported (render returns a Promise).

## Write Path Principle

If a plugin renders content that also exists in storage, it owns the write path.

- Summary plugin owns `writeNow()` (no budget hacks).
- Vector index plugin owns `index()` (no manual formatting drift).

This removes duplicated formatting logic and storage calls from app code.

## Implementation Plan (Phased)

### Phase 1: Introduce `.use` and plugin classes

- Add `PromptPlugin` type and `.use` to the builder.
- Add `Summary` and `VectorDB` classes.
- Internally, reuse existing components for initial implementation.

### Phase 2: Remove specialized DSL methods

- Remove `.summary` and `.vectorSearch` from the DSL.
- Update docs and examples to use plugins.

### Phase 3: Re-evaluate compaction helpers

- Decide whether `truncate`, `omit`, and `last` should migrate to plugins.

## Open Questions (for later)

- Should plugins be allowed to return `PromptBuilder` directly, or only
  `ScopeContent`?
- Do we want a standard optional interface for write helpers (`writeNow`,
  `index`), or keep them ad-hoc per plugin?
