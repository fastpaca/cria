# Use with Vercel AI SDK

Cria renders your prompt tree into `ModelMessage[]` for the AI SDK. You still call the AI SDK yourself.

## Install

```bash
npm install ai @ai-sdk/openai
export OPENAI_API_KEY="sk-..."
```

```ts
import { openai } from "@ai-sdk/openai";
import { generateText } from "ai";
import { cria } from "@fastpaca/cria";
import { renderer } from "@fastpaca/cria/ai-sdk";

const messages = await cria
  .prompt()
  .system("You are helpful.")
  .user(userQuestion)
  .render({ renderer });

const { text } = await generateText({ model: openai("gpt-4o-mini"), messages });
```

Runnable example: [ai-sdk](../../examples/ai-sdk)

```bash
cd examples/ai-sdk
pnpm install
pnpm start
```

See `../../examples/ai-sdk/README.md` for full setup details.

## Budgets and compaction

If you pass a `budget` to `render()`, you must also supply token counts (either a `tokenizer` option, or a provider context that supplies one).

Next: [Fit & compaction](fit-and-compaction.md)
