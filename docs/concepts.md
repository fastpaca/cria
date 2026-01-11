# Concepts

Cria treats prompts like code: composable, reusable, and provider-agnostic. This page explains how, using the fluent DSL as the primary surface. JSX remains optional via `@fastpaca/cria/jsx` if you prefer TSX syntax.

## Prompts as builders

Just like UI components, prompt sections encapsulate structure and can be composed. The DSL makes this explicit:

```ts
import { cria } from "@fastpaca/cria";

const systemRules = () =>
  cria.prompt().system("You are a helpful assistant.");

const chatPrompt = (history: string, question: string) =>
  cria
    .prompt()
    .merge(systemRules())
    .region((r) => r.last(history, { N: 10, priority: 2 }))
    .user(question);

Build once, reuse everywhere by reusing builder snippets.
```

## Prompt tree

Your builder produces a tree of nodes. Each node has semantic meaning:

```
Region
  Message(system)
  Message(user)
  Region
    ...history...
```

This structure is the foundation. It enables everything else: rendering to different providers, budget fitting, validation, and observability.

## Renderers: one structure, any provider

Renderers convert your prompt tree to provider-specific formats:

- Markdown string (default)
- OpenAI Chat Completions / Responses
- Anthropic Messages
- Vercel AI SDK ModelMessage[]

Semantic nodes like `Message`, `ToolCall`, and `ToolResult` map automatically to each provider's format. Write your prompt once, render it anywhere.

## Budget fitting (optional)

Because your prompt is a tree, you can assign priorities and let Cria manage token limits for you:

- **Priority**: lower number = more important
- **Strategy**: how to shrink when over budget (truncate, omit, summarize)

| Priority | Typical use |
| --- | --- |
| 0 | System rules, safety requirements |
| 1 | Current user request, tool outputs |
| 2 | History, retrieved context |
| 3 | Examples, optional context |

Cria includes strategies like `Truncate`, `Omit`, `Summary`, and `VectorSearch`, or you can write your own.

## Tokenization

Budget fitting needs token counts. Pass a tokenizer to `render()`, or let a provider handle it—built-in providers ship with tiktoken defaults. No tokenizer and no provider? Cria throws so you notice before it matters.

See [Tokenization](tokenization.md) for setup options and examples.

## Providers and context

Provider helpers (`Provider` classes in openai/anthropic/ai-sdk) attach model context to the tree via `.provider(...)`. Components like `Summary` use this to call a model without you passing a custom function.

```ts
import OpenAI from "openai";
import { Provider as OpenAIProvider } from "@fastpaca/cria/openai";
import { cria } from "@fastpaca/cria";

const provider = new OpenAIProvider(new OpenAI(), "gpt-4o");

const prompt = cria
  .prompt()
  .provider(provider, (p) =>
    p.summary(history, { id: "conv", store, priority: 2 })
  )
  .user(question);
```

## Works everywhere

Cria does not depend on the DOM or React. It runs in Node, Deno, Bun, and Edge runtimes. Prefer TSX? Use the optional JSX entry at `@fastpaca/cria/jsx`; the DSL remains the primary API.
