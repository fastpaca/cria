# Use with Anthropic

Cria renders your prompt tree into the shape Anthropic expects (`system` string + `messages[]`). You still call the Anthropic SDK yourself.

## Install

```bash
npm install @anthropic-ai/sdk
```

Assumes `ANTHROPIC_API_KEY` is set.

```bash
export ANTHROPIC_API_KEY="sk-..."
```

```ts
import Anthropic from "@anthropic-ai/sdk";
import { cria } from "@fastpaca/cria";
import { createProvider } from "@fastpaca/cria/anthropic";

const client = new Anthropic();
const provider = createProvider(client, "claude-sonnet-4-20250514");

const { system, messages } = await cria
  .prompt(provider)
  .system("You are helpful.")
  .user(userQuestion)
  .render({ budget: 8000 });

const response = await client.messages.create({
  model: "claude-sonnet-4-20250514",
  system,
  messages,
});
```

Runnable example: [anthropic](../../examples/anthropic)

```bash
cd examples/anthropic
pnpm install
pnpm start
```

See `../../examples/anthropic/README.md` for full setup details.

## Budgets and compaction

If you pass a `budget` to `render()`, you must supply a provider or bind one with `cria.prompt(provider)`. The provider owns token counting via tiktoken.

Next: [Fit & compaction](fit-and-compaction.md)
