# Quickstart

Cria lets you build prompts as a small JSX tree and then fit them to a token budget.

## Install

```bash
npm install @fastpaca/cria
```

## Configure the JSX runtime

Add this to `tsconfig.json`:

```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "@fastpaca/cria"
  }
}
```

## Build your first prompt

```tsx
import { Message, Omit, Region, Truncate, render } from "@fastpaca/cria";

const tokenizer = (text: string): number => Math.ceil(text.length / 4);

const prompt = (
  <Region priority={0}>
    <Message messageRole="system">You are a helpful assistant.</Message>
    <Truncate budget={4000} priority={2}>
      {conversationHistory}
    </Truncate>
    <Omit priority={3}>{optionalExamples}</Omit>
    <Message messageRole="user">{userQuestion}</Message>
  </Region>
);

const output = await render(prompt, { tokenizer, budget: 8000 });
```

Use a real tokenizer (for example, `tiktoken`) for accurate counts.

## Renderers

By default `render()` returns a markdown string. Use a renderer to output
OpenAI, Anthropic, or AI SDK message formats.

- OpenAI: `@fastpaca/cria/openai`
- Anthropic: `@fastpaca/cria/anthropic`
- Vercel AI SDK: `@fastpaca/cria/ai-sdk`

## Next steps

- [Prompt structure](prompt-structure.md)
- [Components](components.md)
- [Integrations](integrations.md)

## What's included

- **Components**: Region, Message, Truncate, Omit, Last, Summary, VectorSearch, ToolCall, ToolResult, Reasoning, Examples, CodeBlock, Separator
- **Renderers**: markdown, OpenAI Chat Completions, OpenAI Responses, Anthropic, AI SDK
- **Providers**: OpenAIProvider, AnthropicProvider, AISDKProvider
- **Memory**: InMemoryStore, Redis/Postgres adapters, Chroma/Qdrant vector stores
- **Observability**: Render hooks, validation schemas, snapshots, OpenTelemetry
