# Concepts

Cria treats prompts like code: composable, reusable, and provider-agnostic. This page explains how.

## Prompts as components

Just like UI components, prompt components encapsulate structure and can be composed:

```tsx
function SystemRules() {
  return <Message messageRole="system">You are a helpful assistant.</Message>;
}

function ChatPrompt({ history, question }) {
  return (
    <Region>
      <SystemRules />
      {history}
      <Message messageRole="user">{question}</Message>
    </Region>
  );
}
```

Build once, reuse everywhere.

## Prompt tree

Your JSX compiles to a tree of nodes. Each node has semantic meaning:

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

Budget fitting needs a tokenizer to count tokens. You can:

- Pass `tokenizer` to `render()` for accurate, model-specific counts (e.g. tiktoken, `@anthropic-ai/tokenizer`).
- Rely on provider defaults: `OpenAIProvider`, `AnthropicProvider`, and `AISDKProvider` include a tiktoken-based tokenizer and accept a `tokenizer` prop to override with a custom one.

If you set a budget without either, Cria will throw so you know to configure token counting. See [Tokenization](tokenization.md) for details and examples.

## Providers and context

Provider components (`OpenAIProvider`, `AnthropicProvider`, `AISDKProvider`) attach model context to the tree. Components like `Summary` use this to call a model without you passing a custom function.

## Works everywhere

JSX here is just syntax. Cria does not depend on the DOM or React. It runs in Node, Deno, Bun, and Edge runtimes.
