# feat: Fluent Prompt Builder DSL

> A single fluent builder API for constructing prompts without JSX - chainable methods, scoped sections, async components.

## Target API

### 1. Minimal prompt

```typescript
const prompt = cria
  .prompt()
  .system("You are a helpful assistant.")
  .user("Summarize the meeting notes.")
  .build();

const messages = await render(prompt, { tokenizer, renderer: openaiRenderer });
```

### 2. Priorities + strategies (truncate/omit)

```typescript
const prompt = cria
  .prompt()
  .system("You are a helpful assistant.")
  .section((s) =>
    s
      .truncate(conversationHistory, { budget: 20_000, from: "start", priority: 2 })
      .omit(optionalExamples, { priority: 3 })
  )
  .user(userQuestion)
  .build();

const messages = await render(prompt, { tokenizer, budget: 8_000, renderer: openaiRenderer });
```

### 3. Async component: vector search

```typescript
const prompt = cria
  .prompt()
  .system("You are a helpful assistant.")
  .vectorSearch({
    store: vectorStores.docs,
    query: "retrieval augmented generation best practices",
    limit: 5,
    formatter: formatResults,
    priority: 2,
  })
  .user(userQuestion)
  .build();

const messages = await render(prompt, { tokenizer, budget: 12_000, renderer: openaiRenderer });
```

### 4. Provider/context + summary

```typescript
import { createAISDKProvider } from "@fastpaca/cria/ai-sdk";

const prompt = cria
  .prompt()
  .provider(createAISDKProvider(openai("gpt-4o")), (p) =>
    p
      .summary(conversationHistory, { id: "conv-history", store: summaryStore, priority: 2 })
      .user(userQuestion)
  )
  .build();

const messages = await render(prompt, { tokenizer, budget: 6_000, renderer: openaiRenderer });
```

### 5. Named sections (ax-like)

```typescript
const prompt = cria
  .prompt()
  .section("system", (s) => s.system("You are a helpful assistant."))
  .section("context", (s) =>
    s
      .examples("Examples:", exampleList, { priority: 2 })
      .truncate(historyText, { budget: 10_000, priority: 2 })
  )
  .section("ask", (s) => s.user(userQuestion))
  .build();
```

## Design Principles

1. **Single builder class** - One `PromptBuilder` that accumulates children
2. **Fluent chaining** - Every method returns `this` (new instance for immutability)
3. **Scoped callbacks** - `.section()`, `.provider()` take callbacks for nested composition
4. **Proper generics** - VectorSearch preserves type parameter T
5. **No `as any`** - All types are sound
6. **Async-ready** - Promises are stored and resolved at render time

## Technical Design

### Core Builder Class

```typescript
// src/dsl.ts

import {
  Region,
  Message,
  Truncate,
  Omit,
  Summary,
  VectorSearch,
  Examples,
  type StoredSummary,
  type Summarizer,
  type ResultFormatter,
} from "./components";
import type { KVMemory, VectorMemory } from "./memory";
import type {
  ModelProvider,
  PromptElement,
  PromptChildren,
  PromptRole,
  CriaContext,
} from "./types";

// Children can include promises (async components) - resolved at render time
type BuilderChild = PromptElement | string | Promise<PromptElement>;

export class PromptBuilder {
  private readonly children: BuilderChild[];
  private readonly context?: CriaContext;

  private constructor(children: BuilderChild[] = [], context?: CriaContext) {
    this.children = children;
    this.context = context;
  }

  static create(): PromptBuilder {
    return new PromptBuilder();
  }

  // ─── Messages ───────────────────────────────────────────────

  system(text: string, opts?: { priority?: number }): PromptBuilder {
    return this.addChild(
      Message({ messageRole: "system", children: [text], priority: opts?.priority })
    );
  }

  user(text: string, opts?: { priority?: number }): PromptBuilder {
    return this.addChild(
      Message({ messageRole: "user", children: [text], priority: opts?.priority })
    );
  }

  assistant(text: string, opts?: { priority?: number }): PromptBuilder {
    return this.addChild(
      Message({ messageRole: "assistant", children: [text], priority: opts?.priority })
    );
  }

  message(role: PromptRole, text: string, opts?: { priority?: number }): PromptBuilder {
    return this.addChild(
      Message({ messageRole: role, children: [text], priority: opts?.priority })
    );
  }

  // ─── Strategies ─────────────────────────────────────────────

  truncate(
    content: string | PromptElement | PromptBuilder,
    opts: { budget: number; from?: "start" | "end"; priority?: number }
  ): PromptBuilder {
    const children = this.resolveContent(content);
    return this.addChild(
      Truncate({ children, budget: opts.budget, from: opts.from, priority: opts.priority })
    );
  }

  omit(
    content: string | PromptElement | PromptBuilder,
    opts?: { priority?: number }
  ): PromptBuilder {
    const children = this.resolveContent(content);
    return this.addChild(
      Omit({ children, priority: opts?.priority })
    );
  }

  // ─── Sections ───────────────────────────────────────────────

  section(fn: (builder: PromptBuilder) => PromptBuilder): PromptBuilder;
  section(name: string, fn: (builder: PromptBuilder) => PromptBuilder): PromptBuilder;
  section(
    nameOrFn: string | ((builder: PromptBuilder) => PromptBuilder),
    maybeFn?: (builder: PromptBuilder) => PromptBuilder
  ): PromptBuilder {
    const [name, fn] = typeof nameOrFn === "string"
      ? [nameOrFn, maybeFn!]
      : [undefined, nameOrFn];

    const inner = fn(new PromptBuilder([], this.context));

    // Note: inner.children may contain promises - that's OK
    // They'll be resolved when render() processes the tree
    const element = Region({
      children: inner.children as PromptChildren,
      ...(name && { id: name }),
    });

    return this.addChild(element);
  }

  // ─── Provider/Context ───────────────────────────────────────

  provider(
    modelProvider: ModelProvider,
    fn: (builder: PromptBuilder) => PromptBuilder
  ): PromptBuilder {
    const context: CriaContext = { provider: modelProvider };
    const inner = fn(new PromptBuilder([], context));

    const element: PromptElement = {
      priority: 0,
      children: inner.children as PromptChildren,
      context,
    };

    return this.addChild(element);
  }

  // ─── Async Components ───────────────────────────────────────

  vectorSearch<T = unknown>(opts: {
    store: VectorMemory<T>;
    query: string;
    limit?: number;
    threshold?: number;
    formatter?: ResultFormatter<T>;
    priority?: number;
    id?: string;
  }): PromptBuilder {
    // VectorSearch returns Promise<PromptElement>
    const asyncElement = VectorSearch<T>({
      store: opts.store,
      query: opts.query,
      limit: opts.limit,
      threshold: opts.threshold,
      formatResults: opts.formatter,
      priority: opts.priority,
      id: opts.id,
    });
    return this.addChild(asyncElement);
  }

  summary(
    content: string | PromptElement | PromptBuilder,
    opts: {
      id: string;
      store: KVMemory<StoredSummary>;
      summarize?: Summarizer;
      priority?: number;
    }
  ): PromptBuilder {
    const children = this.resolveContent(content);
    const element = Summary({
      id: opts.id,
      store: opts.store,
      summarize: opts.summarize,
      children,
      priority: opts.priority,
    });
    return this.addChild(element);
  }

  // ─── Utilities ──────────────────────────────────────────────

  examples(
    title: string,
    items: (string | PromptElement)[],
    opts?: { priority?: number }
  ): PromptBuilder {
    return this.addChild(
      Examples({ title, children: items, priority: opts?.priority })
    );
  }

  raw(element: PromptElement | Promise<PromptElement>): PromptBuilder {
    return this.addChild(element);
  }

  // ─── Terminal ───────────────────────────────────────────────

  build(): PromptElement {
    return Region({
      priority: 0,
      children: this.children as PromptChildren,
      ...(this.context && { context: this.context }),
    });
  }

  // ─── Private ────────────────────────────────────────────────

  private addChild(child: BuilderChild): PromptBuilder {
    return new PromptBuilder([...this.children, child], this.context);
  }

  private resolveContent(content: string | PromptElement | PromptBuilder): PromptChildren {
    if (typeof content === "string") {
      return [content];
    }
    if (content instanceof PromptBuilder) {
      return content.children as PromptChildren;
    }
    return [content];
  }
}

// ─── Entry Point ──────────────────────────────────────────────

export const cria = {
  prompt: () => PromptBuilder.create(),
} as const;

// Also export standalone for convenience
export const prompt = () => PromptBuilder.create();
```

### Changes to ai-sdk/index.tsx

Export the provider factory function:

```typescript
// src/ai-sdk/index.tsx (add export)

/**
 * Creates a ModelProvider from an AI SDK LanguageModel.
 * Use this with the DSL's .provider() method.
 *
 * @example
 * ```typescript
 * import { cria } from "@fastpaca/cria";
 * import { createAISDKProvider } from "@fastpaca/cria/ai-sdk";
 * import { openai } from "@ai-sdk/openai";
 *
 * const prompt = cria
 *   .prompt()
 *   .provider(createAISDKProvider(openai("gpt-4o")), (p) =>
 *     p.summary(content, { id: "summary", store })
 *   )
 *   .build();
 * ```
 */
export function createAISDKProvider(model: LanguageModel): ModelProvider {
  return {
    name: "ai-sdk",
    async completion(request: CompletionRequest): Promise<CompletionResult> {
      const messages: ModelMessage[] = request.system
        ? [{ role: "system", content: request.system }]
        : [];

      for (const msg of request.messages) {
        messages.push({ role: msg.role as "user" | "assistant", content: msg.content });
      }

      const result = await generateText({ model, messages });
      return { text: result.text };
    },
  };
}
```

## File Structure

```
src/
├── dsl.ts              # New - the fluent builder (~180 lines)
├── ai-sdk/index.tsx    # Modified - add createAISDKProvider export
├── index.ts            # Add: export { cria, prompt, PromptBuilder } from "./dsl"
└── ... (existing files unchanged)
```

## Changes Summary

| File | Action | Lines |
|------|--------|-------|
| `src/dsl.ts` | New | ~180 |
| `src/ai-sdk/index.tsx` | Add export | +20 |
| `src/index.ts` | Add export | +1 |
| `tests/dsl.test.ts` | New | ~150 |

**Total: ~350 lines** (including tests)

## Key Fixes from Review

1. **No `as any` casts** - VectorSearch uses proper generics `<T>`
2. **Provider accepts ModelProvider** - No fake implementation, works with `createAISDKProvider()`
3. **Summary uses proper types** - `KVMemory<StoredSummary>`, `Summarizer`
4. **Message role uses PromptRole** - Not plain string
5. **Promise handling documented** - Children array stores promises, resolved at render

## Acceptance Criteria

### Functional

- [ ] `cria.prompt()` returns a new builder
- [ ] Message methods: `.system()`, `.user()`, `.assistant()`, `.message()`
- [ ] Strategy methods: `.truncate()`, `.omit()`
- [ ] Section methods: `.section()`, `.section(name, fn)`
- [ ] Context method: `.provider(modelProvider, fn)`
- [ ] Async components: `.vectorSearch()`, `.summary()`
- [ ] Utility methods: `.examples()`, `.raw()`
- [ ] Terminal: `.build()` returns `PromptElement`
- [ ] Immutable: each method returns new builder
- [ ] `createAISDKProvider()` exported from ai-sdk

### Type Safety

- [ ] VectorSearch generic `<T>` preserved
- [ ] Summary uses `KVMemory<StoredSummary>`
- [ ] No `as any` casts in implementation
- [ ] Provider accepts `ModelProvider` interface

### Compatibility

- [ ] Works with existing `render()` function
- [ ] Works with all existing renderers
- [ ] Async components resolved correctly

### Quality

- [ ] All tests pass
- [ ] Linting passes with `npm exec -- ultracite check`
- [ ] No breaking changes

## Comparison with JSX

| DSL | JSX |
|-----|-----|
| `cria.prompt().system("...").user("...").build()` | `<Region><Message messageRole="system">...</Message>...</Region>` |
| `.section((s) => s.truncate(...))` | `<Region><Truncate>...</Truncate></Region>` |
| `.provider(createAISDKProvider(model), (p) => ...)` | `<AISDKProvider model={...}>...</AISDKProvider>` |

Both produce the same `PromptElement` tree.

## Future Considerations

1. **Conditional methods**: `.when(condition, fn)` for conditional composition
2. **Iteration**: `.each(items, fn)` for mapping over arrays
3. **Type-safe sections**: Named sections with typed accessors
4. **Anthropic/OpenAI providers**: `createAnthropicProvider()`, `createOpenAIProvider()`

## References

### Internal

- Components: `src/components/index.ts`
- Types: `src/types.ts`
- AI SDK Provider: `src/ai-sdk/index.tsx:512-543`
- VectorSearch: `src/components/vector-search.ts:160-198`
- Summary: `src/components/summary.ts:187-199`

### External

- [ax-llm](https://github.com/ax-llm/ax) - Fluent signature builders

---

*Generated with Claude Code*
