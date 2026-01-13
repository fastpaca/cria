# Quickstart

Your prompts deserve the same structure as your code. Cria turns prompts into composable components with explicit roles and strategies, and renders the same prompt tree to different providers. Budgets and compaction are optional.

## Install

```bash
npm install @fastpaca/cria
```

## Build your first prompt (markdown output)

```ts
import { cria } from "@fastpaca/cria";

const markdown = await cria
  .prompt()
  .system("You are a helpful assistant.")
  .user(userQuestion)
  .render();
```

That's it. `.render()` returns a markdown string by default.

## Recommended layout

A clear structure makes prompts easier to compose and maintain:

```
System rules
History / retrieved context
Examples / optional context
Current user request
```

Keep the user's current request last so the model sees it right before responding.

## Compose building blocks (optional)

As prompts grow, treat common patterns as components you can plug in or swap out:

- Retrieval: `.vectorSearch({ store, query })`
- Long history: `.summary(...)`, `.last(...)`
- Optional context: `.omit(...)`, `.truncate(...)`

Example shape (mix and match):

```ts
import { cria } from "@fastpaca/cria";

const prompt = cria
  .prompt()
  .system("You are a helpful assistant.")
  .vectorSearch({ store, query: userQuestion, limit: 5, priority: 2 })
  .provider(provider, (p) =>
    p
      .summary(history, { id: "history", store: summaryStore, priority: 2 })
      .last(history, { N: 20 })
  )
  .user(userQuestion);
```

This snippet is illustrative; see [RAG](how-to/rag.md), [Summarize long history](how-to/summarize-history.md), and the provider how-tos for runnable setups.

## Render to any provider

The same prompt structure works with OpenAI, Anthropic, or Vercel AI SDK. Just swap the renderer.

### OpenAI (Chat Completions)

Install the OpenAI SDK and set `OPENAI_API_KEY`:

```bash
npm install openai
export OPENAI_API_KEY="sk-..."
```

```ts
import { cria } from "@fastpaca/cria";
import { chatCompletions } from "@fastpaca/cria/openai";
import OpenAI from "openai";

const prompt = cria.prompt().system("You are helpful.").user(userQuestion);

const client = new OpenAI();
const messages = await prompt.render({ renderer: chatCompletions });
const response = await client.chat.completions.create({
  model: "gpt-4o-mini",
  messages,
});
console.log(response.choices[0]?.message?.content ?? "");
```

## Budgets & compaction (optional)

If you want prompts to stay predictable under pressure (long history, retrieval bursts, tool traces), pass a `budget` to `render()` and give shrinkable regions priorities. Cria shrinks lower-importance content first until it fits.

```ts
import { cria, type Tokenizer } from "@fastpaca/cria";

const tokenizer: Tokenizer = (text) => Math.ceil(text.length / 4); // rough estimate

const output = await cria
  .prompt()
  .system("You are a helpful assistant.")
  .truncate(conversationHistory, { budget: 4000, priority: 2 })
  .omit(optionalExamples, { priority: 3 })
  .user(userQuestion)
  .render({ budget: 8000, tokenizer });
```

Lower priority number = more important. Cria shrinks priority 3 first, then 2, and so on.

Next: [Fit & compaction](how-to/fit-and-compaction.md)

## Next steps

- [Use with OpenAI](how-to/use-with-openai.md)
- [Use with Anthropic](how-to/use-with-anthropic.md)
- [Use with Vercel AI SDK](how-to/use-with-vercel-ai-sdk.md)
- [Components (reference)](components.md)

## What Cria gives you

- A prompt tree with explicit roles (system/user/assistant/messages) you can render to multiple providers.
- Composable building blocks (retrieval, summarization, truncation) that plug into that same tree.
- Optional budgets and strategies so the tree stays predictable as it grows.

## Optional JSX

If you prefer TSX, point your JSX runtime at `@fastpaca/cria/jsx`:

```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "@fastpaca/cria/jsx"
  }
}
```

The JSX entry is sugar over the same IR; the DSL remains the primary API.
