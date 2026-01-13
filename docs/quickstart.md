# Quickstart

Cria lets you build prompts with a fluent DSL. Define your structure once, render it to different providers. Token budgets are optional.

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

A clear structure makes prompts easier to maintain:

```
System rules
History / retrieved context
Examples / optional context
Current user request
```

Keep the user's current request last so the model sees it right before responding.

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

## Fit & compaction (optional)

Cria only needs token counts when you set a `budget`. Provide a tokenizer (exact or approximate), set priorities, and let Cria shrink lower-priority content first.

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

- A structured prompt tree you can render to multiple providers.
- Optional budgets (“fit & compaction”) so prompts stay predictable as they grow.
- Building blocks like summarization and retrieval that plug into the same structure.

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
