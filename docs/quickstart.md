# Quickstart

Cria lets you build prompts as reusable JSX components. Write your prompt structure once, render it to any provider.

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
import { Message, Region, render } from "@fastpaca/cria";

const prompt = (
  <Region>
    <Message messageRole="system">You are a helpful assistant.</Message>
    <Message messageRole="user">{userQuestion}</Message>
  </Region>
);

const markdown = await render(prompt);
```

That's it. `render()` returns a markdown string by default.

## Recommended layout

A clear structure makes prompts easier to maintain:

```
System rules
History / retrieved context
Examples / optional context
Current user request
```

Keep the user's current request last so the model sees it right before responding.

## Render to any provider

The same prompt structure works with OpenAI, Anthropic, or Vercel AI SDK. Just swap the renderer:

```tsx
import { chatCompletions } from "@fastpaca/cria/openai";
import { anthropic } from "@fastpaca/cria/anthropic";
import { renderer } from "@fastpaca/cria/ai-sdk";

// OpenAI
const messages = await render(prompt, { renderer: chatCompletions });

// Anthropic
const { system, messages } = await render(prompt, { renderer: anthropic });

// AI SDK
const messages = await render(prompt, { renderer });
```

No changes to your prompt structure. The renderer handles the format.

## Budget fitting (optional)

Because your prompt is a tree, you can assign priorities and let Cria trim low-priority content when you hit a token limit:

```tsx
import { Message, Omit, Region, Truncate, render } from "@fastpaca/cria";

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

Lower priority number = more important. Cria shrinks priority 3 first, then 2, and so on.

Budget fitting needs token counts. Pass a tokenizer to `render()`, or use a provider—they ship with tiktoken defaults. See [Tokenization](tokenization.md).

## Renderers

- OpenAI: `@fastpaca/cria/openai`
- Anthropic: `@fastpaca/cria/anthropic`
- Vercel AI SDK: `@fastpaca/cria/ai-sdk`

## Next steps

- [Concepts](concepts.md)
- [Components](components.md)
- [Integrations](integrations.md)

## What's included

- **Components**: Region, Message, Truncate, Omit, Last, Summary, VectorSearch, ToolCall, ToolResult, Reasoning, Examples, CodeBlock, Separator
- **Renderers**: markdown, OpenAI Chat Completions, OpenAI Responses, Anthropic, AI SDK
- **Providers**: OpenAIProvider, AnthropicProvider, AISDKProvider
- **Memory**: InMemoryStore, Redis/Postgres adapters, Chroma/Qdrant vector stores
- **Observability**: Render hooks, validation schemas, snapshots, OpenTelemetry
