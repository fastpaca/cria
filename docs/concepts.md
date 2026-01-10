# Concepts

This page covers the core ideas behind Cria: how prompts become a tree, how
priorities and strategies work, and how rendering fits a budget.

## Prompt tree

Cria turns a prompt into a tree of components. Each node can have:
- **Children** (nested content)
- **Priority** (lower number = more important)
- **Strategy** (how to shrink when over budget)

Think of it as a structured prompt tree:

```
Region (priority 0)
  Message(system)
  Message(user)
  Region (priority 2)
    ...history...
```

## Priorities

Priorities are how Cria decides what to reduce first.

| Priority | Typical use |
| --- | --- |
| 0 | System rules, safety requirements |
| 1 | Current user request, tool outputs |
| 2 | History, retrieved context |
| 3 | Examples, optional context |

## Strategies

Strategies are functions that rewrite part of the tree when a budget is exceeded.

Cria includes built-ins like `Truncate`, `Omit`, `Summary`, and `VectorSearch`, but
you can attach your own strategy to any `Region` or custom component.

## Renderers

Renderers convert the prompt tree into the final output format:

- Markdown string (default)
- OpenAI Chat Completions / Responses
- Anthropic Messages
- Vercel AI SDK ModelMessage[]

Renderers decide how semantic nodes like `Message`, `ToolCall`, and `ToolResult`
map to provider formats.

## Tokenizers and budgets

`render()` takes a tokenizer and a token budget. If the prompt exceeds the
budget, Cria applies strategies starting with the highest priority numbers (least important content) until it fits.

## Providers and context

Provider components (`OpenAIProvider`, `AnthropicProvider`, `AISDKProvider`)
attach model context to the tree so components like `Summary` can call a model
without a custom summarize function.

## Works everywhere

JSX here is just syntax. Cria does not depend on the DOM or React, and runs in
Node, Deno, Bun, and Edge runtimes. Adapters require their SDKs and supported
runtimes.
