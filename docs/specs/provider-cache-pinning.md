# Provider Cache Pinning Spec (KV Cache / Prompt Prefix Caching)

## Status

- Draft
- Owner: Cria core
- Scope: provider-side prompt/KV cache pinning hints

## Clarification: “KV pinning” here means provider KV cache

This spec is about pinning stable prompt regions so providers can reuse their
internal KV/prompt caches across requests (i.e., “prompt prefix caching”).

Provider capabilities differ:

- Anthropic supports explicit cache pinning per content block via
  `cache_control`.
- OpenAI supports prompt caching with `prompt_cache_key` and retention hints,
  but does not expose per-block cache-control in the same way.

So Cria should expose a single “cache pinning hint” and let providers map it to
their best available feature.

## Goals

- Provide an opinionated, minimal API for provider cache pinning.
- Stay provider-agnostic at the DSL/IR layer.
- Preserve existing compaction semantics and priorities.
- Degrade gracefully when a provider has no explicit pinning feature.

## Non-goals

- A general caching layer or cache invalidation system.
- Perfectly identical behavior across providers.
- Automatic prompt reordering (pinning should not silently change semantics).

## Design Overview

Add cache pinning hints at the prompt-tree level and map them at render time.
Make the prefix constraint explicit in the API shape:

1. A new cache hint type (`CacheHint`) on scopes.
2. A component-level `.pin(...)` helper to mark stable regions.
3. A `.prefix(...)` helper to guarantee pinned content is first.
4. Provider-specific mappings.
- Anthropic: emit `cache_control` on the corresponding content blocks.
- OpenAI: compute a stable `prompt_cache_key` from the pinned prefix.

## Proposed API Sketch

These are type sketches, not final signatures.

```ts
export interface CacheHint {
  mode: "pin";
  /**
   * Stable identifier for this pinned region.
   * Used to derive provider cache keys and for observability.
   */
  id: string;
  /**
   * Optional grouping key so multiple regions share a cache domain
   * (e.g., tenant + model + policy version).
   */
  scopeKey?: string;
  /**
   * Optional TTL hint in seconds. Providers may ignore it.
   */
  ttlSeconds?: number;
}

// DSL: mark a builder (or scoped region) as pinned.
pin(opts: { id: string; scopeKey?: string; ttlSeconds?: number }): PromptBuilder<P>;

// DSL: explicitly place content in the prompt prefix.
prefix(content: ScopeContent<P>): PromptBuilder<P>;

// DSL: explicit wrapper remains available for clarity.
cachePin(
  content: ScopeContent<P>,
  opts: { id: string; scopeKey?: string; ttlSeconds?: number; priority?: number }
): PromptBuilder<P>;
```

Notes:

- `pin(...)` and `cachePin(...)` should wrap the subtree in a scope so they
  compose with priorities and strategies.
- `prefix(...)` is the safe way to satisfy the provider constraint that caching
  only benefits a shared prompt prefix.

## Component-Level Shapes (Recommended + Alternatives)

### Recommended: `.pin(...)` + `.prefix(...)`

This keeps pinning local to components while making the prefix rule explicit:

```ts
const system = cria.prompt().system("...static rules...").pin({
  id: "system:v1",
  scopeKey: "tenant:acme",
});

const prompt = cria
  .prompt(provider)
  .prefix(system)
  .user("What's next?")
  .render();
```

Key behavior:

- `.pin(...)` marks the region as pin-eligible.
- `.prefix(...)` guarantees placement at the start of the prompt.
- If pinned content is not in the contiguous prefix after fitting, it should be
  ignored for cache derivation and reported via hooks/warnings.

### Alternative: wrapper-only (`cachePin(...)`)

```ts
const prompt = cria
  .prompt(provider)
  .cachePin(systemRules, { id: "system:v1" })
  .user(input)
  .render();
```

This is explicit but easier to misuse because it does not force prefix
placement.

### Alternative: render-time control

```ts
const prompt = cria.prompt(provider).merge(system).user(input);

await prompt.render({
  cache: { pinnedPrefix: system, scopeKey: "tenant:acme" },
});
```

This is operationally flexible but less discoverable inside component code.

## The Prefix Rule (Core Invariant)

Provider caching benefits a shared prompt prefix, not arbitrary pinned regions.
Pins must be interpreted after fitting:

1. Fit/compaction runs first and may remove or rewrite pinned scopes.
2. Cria computes the contiguous pinned prefix from the fitted tree.
3. Only that prefix is used to derive provider cache hints/keys.

This matches provider guidance on prefix caching behavior.

## Provider Mapping Strategy

### Anthropic (Explicit Cache Control)

Anthropic supports prompt caching via `cache_control` on content blocks.

Mapping:

- For pinned text blocks, emit Anthropic text content blocks with
  `cache_control` populated.
- Prefer applying cache control at the block level rather than merging all
  pinned content into one giant string, so large pins can still be chunked.

Implication for Cria:

- Anthropic’s render result likely needs to evolve from `system?: string` to a
  structured system content representation so cache control can be attached.

### OpenAI (Prompt Cache Key)

OpenAI exposes prompt caching via `prompt_cache_key` and retention controls.

Mapping:

1. Identify pinned regions that appear in the prompt prefix.
2. Derive a stable cache key, for example:
   - `scopeKey` (if provided)
   - model name
   - a stable hash of the pinned prefix text
3. Pass that key via provider-specific request options.

Important constraint:

- Because OpenAI caching is prefix-oriented, pins placed late in the prompt may
  not improve cache reuse even if they are marked as pinned.

## IR Integration Sketch

Two viable approaches:

### Option A: Scope-level cache hints (simpler)

Add an optional cache hint to `PromptScope`:

```ts
interface PromptScope<...> {
  kind: "scope";
  priority: number;
  strategy?: Strategy;
  cache?: CacheHint;
  ...
}
```

Pros:

- Minimal type surface.
- Composes naturally with DSL helpers.

Cons:

- Providers that want block-level hints will need to push the hint down to
  parts during render.

### Option B: Part-level cache hints (more precise)

Attach cache hints to text parts:

```ts
type PromptPart = { type: "text"; text: string; cache?: CacheHint } | ...
```

Pros:

- Maps cleanly to Anthropic’s block-level cache control.

Cons:

- More invasive across the codebase.

Recommendation: start with Option A and push hints down during render, then
promote to part-level hints only if needed.

## Render-Time Algorithm (Provider-Agnostic)

At render time:

1. Walk the tree and collect pinned scopes in traversal order.
2. Compute “pinned prefix” as the longest prefix region that is fully pinned.
3. Create a cache descriptor:
   - `pinIds`: pinned scope ids in prefix order
   - `prefixTextHash`: stable hash of prefix content
   - `scopeKey`: optional cache scope key
4. Pass this descriptor into provider codecs so they can map it to native
   caching features.

This keeps pinning a render concern without affecting fit/compaction.

## Similar Seamless Features To Add Later

Once cache pinning exists, these become straightforward:

1. Versioned pins:
   - Add `version` to the pin id or scope key so cache busting is explicit.
2. Cache-aware summaries:
   - Pin stable policies/instructions; keep volatile history out of the pinned
     prefix.
3. Observability hooks:
   - `onCachePinsCollected`, `onCacheKeyDerived`, and provider-specific
     “cache hit/miss” reporting when available.

## Rollout Plan (Incremental)

### Phase 1: Spec + cache descriptors

- Add `CacheHint` types.
- Collect cache pin descriptors during render.
- No provider changes yet.

### Phase 2: DSL helper

- Add `.cachePin(...)` on `PromptBuilder`.
- Document correct placement (early in prompt).

### Phase 3: Provider mappings

- Anthropic: structured system/content blocks + `cache_control`.
- OpenAI: prompt cache key derivation + request wiring.

### Phase 4: Guardrails + hooks

- Warnings when a pin is not in the prefix.
- Hooks for visibility into key derivation and pin coverage.
