# Quickstart

Cria lets you build prompts with a fluent DSL. Define your structure once, render it to any provider. JSX is optional via `@fastpaca/cria/jsx` if you prefer TSX syntax.

## Install

```bash
npm install @fastpaca/cria
```

## Build your first prompt

```ts
import { cria } from "@fastpaca/cria";

const markdown = await cria
  .prompt()
  .system("You are a helpful assistant.")
  .user(userQuestion)
  .render({ tokenizer });
```

That's it. `.render()` returns a markdown string by default (it uses the markdown renderer if you don't pass one).

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

```ts
import { cria } from "@fastpaca/cria";
import { chatCompletions } from "@fastpaca/cria/openai";
import { anthropic } from "@fastpaca/cria/anthropic";
import { renderer as aiSdk } from "@fastpaca/cria/ai-sdk";

const prompt = cria.prompt().system("You are helpful.").user(userQuestion);

// OpenAI
const messages = await prompt.render({ renderer: chatCompletions, tokenizer });

// Anthropic
const { system, messages: anthropicMessages } = await prompt.render({
  renderer: anthropic,
  tokenizer,
});

// AI SDK
const aiSdkMessages = await prompt.render({ renderer: aiSdk, tokenizer });
```

No changes to your prompt structure. The renderer handles the format.

## Budget fitting (optional)

Because your prompt is a tree, you can assign priorities and let Cria trim low-priority content when you hit a token limit:

```ts
import { cria } from "@fastpaca/cria";

const output = await cria
  .prompt()
  .system("You are a helpful assistant.")
  .truncate(conversationHistory, { budget: 4000, priority: 2 })
  .omit(optionalExamples, { priority: 3 })
  .user(userQuestion)
  .render({ tokenizer, budget: 8000 });
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

## Optional JSX

If you prefer TSX, install the same package and point your JSX runtime at `@fastpaca/cria/jsx`:

```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "@fastpaca/cria/jsx"
  }
}
```

The JSX entry is sugar over the same IR; the DSL remains the primary API.
