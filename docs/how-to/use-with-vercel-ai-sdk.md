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
import { createProvider } from "@fastpaca/cria/ai-sdk";

const model = openai("gpt-4o-mini");
const provider = createProvider(model);

const messages = await cria
  .prompt()
  .system("You are helpful.")
  .user(userQuestion)
  .render({ provider, budget: 8000 });

const { text } = await generateText({ model, messages });
```

Runnable example: [ai-sdk](../../examples/ai-sdk)

```bash
cd examples/ai-sdk
pnpm install
pnpm start
```

See `../../examples/ai-sdk/README.md` for full setup details.

## Budgets and compaction

If you pass a `budget` to `render()`, you must supply a provider. The provider owns token counting via tiktoken.

Next: [Fit & compaction](fit-and-compaction.md)
