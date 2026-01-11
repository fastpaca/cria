# DSL Builder Plan

Goal: make a fluent, backend-friendly DSL the primary authoring surface, with JSX kept as an optional add-on. Preserve the existing IR (`PromptElement`) and render/fitting pipeline.

## Current Surface
- Primary entry is JSX components (`Region`, `Message`, `Truncate`, etc.) compiled via `jsx-runtime` to `PromptElement` trees.
- Strategies and async components are expressed as functions/props inside JSX.
- Renderers (`render`, provider adapters, snapshotting) consume `PromptElement` directly.

## Proposed Surface
- Introduce a fluent builder (zod/ax style) as the default API: `cria.prompt().system(...).section(...).truncate(...).omit(...).user(...).build()`.
- Builder produces the same `PromptElement` IR; `render()` remains unchanged.
- Dependencies are passed by value/context, not via string registries (e.g., `vectorSearch({ store, formatter })`, `provider({ model })`, `summary({ store, summarize })`).
- Keep JSX runtime/component exports, but position them as optional sugar on top of the IR/builder.

## Example Usage (intended shape)
```ts
const messages = await cria
  .prompt()
  .system("You are a helpful assistant.")
  .vectorSearch({ store: docsStore, query: "rag best practices", formatter: formatResults, priority: 2 })
  .region("history", (s) =>
    s
      .truncate(conversationHistory, { budget: 20_000, from: "start", priority: 2 })
      .omit(optionalExamples, { priority: 3 })
  )
  .user(userQuestion)
  .render({ tokenizer, budget: 8_000, renderer: openaiRenderer });
```

## API Sketch
- `cria.prompt(options?)` -> `PromptBuilder` with `.build(): PromptElement`.
- Core chain methods: `.system(text)`, `.user(text)`, `.assistant(text|parts)`, `.message(role, text|parts)`, `.section(name?, fn)`, `.truncate(content, { budget, from?, priority? })`, `.omit(content, { priority? })`, `.last(children, { N, priority? })`, `.examples(label?, items, opts?)`, `.codeBlock(code, { language?, priority? })`, `.separator(value, opts?)`.
- Async helpers: `.vectorSearch({ store, query?, messages?, extract?, limit?, threshold?, formatter?, priority?, id? })`, `.summary(content, { id, store, summarize?, priority? })`.
- Provider context: `.provider({ name: "ai-sdk", model }, fn)` sets `context.provider` for descendants.
- Sections accept nested builders to keep composition clear; methods return the builder for chaining.

## Exposure & Packaging Changes
- Default entry (`@fastpaca/cria`) exports the builder factory and types; builder is the primary surface.
- JSX components/runtime move to an optional entry (e.g., `@fastpaca/cria/jsx` or named export group) and are documented as sugar on top of the builder/IR.
- Keep backward compatibility for existing JSX users via the optional entry; README/docs lead with the builder and frame JSX as opt-in.
- Document interop: builder output and JSX output are both `PromptElement` and flow through the same `render()`/renderers.

## Implementation Phases
1) Define builder primitives on top of `PromptElement` (no behavioral changes to fitting/rendering).
2) Add registry support for external deps (vector stores, formatters, summarizers, providers) with clear error messages when refs are missing.
3) Re-export and document builder as preferred surface; keep JSX runtime as optional.
4) Update docs/README/examples to lead with builder; keep a JSX appendix for existing users.
5) Add tests for builder parity with JSX (snapshots, fitting scenarios, async components).

## Open Questions
- How to expose custom strategies? (plugin methods vs. raw function hooks to avoid losing expressiveness.)
- Should `.build()` return a frozen tree to discourage mutation? (likely yes.)
- Naming for the package split: `cria` default = builder, `cria/jsx` = JSX, or vice versa? Consider semver impact.
- Do we keep child arrays as strings only in builder, or allow nested elements/sections as arguments for flexibility?
- Do we provide a lightweight object spec loader alongside the builder for config-driven use cases?

## Migration Notes
- Existing JSX users: no breaking change; keep imports, or opt into builder for backend-friendly ergonomics.
- Internally: ensure renderers and strategies stay IR-based so both surfaces remain compatible.
