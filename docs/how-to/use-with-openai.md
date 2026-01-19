# Use with OpenAI

Cria renders your prompt tree into the payload OpenAI expects. You still call the OpenAI SDK yourself.

## Install

```bash
npm install openai
```

Assumes `OPENAI_API_KEY` is set.

```bash
export OPENAI_API_KEY="sk-..."
```

## Chat Completions

```ts
import OpenAI from "openai";
import { cria } from "@fastpaca/cria";
import { createProvider } from "@fastpaca/cria/openai";

const client = new OpenAI();
const provider = createProvider(client, "gpt-4o-mini");

const messages = await cria
  .prompt(provider)
  .system("You are helpful.")
  .user(userQuestion)
  .render({ budget: 8000 });

const response = await client.chat.completions.create({
  model: "gpt-4o-mini",
  messages,
});
```

Runnable example: [openai-chat-completions](../../examples/openai-chat-completions)

```bash
cd examples/openai-chat-completions
pnpm install
pnpm start
```

See `../../examples/openai-chat-completions/README.md` for full setup details.

## Responses API (reasoning models)

```ts
import OpenAI from "openai";
import { cria } from "@fastpaca/cria";
import { createResponsesProvider } from "@fastpaca/cria/openai";

const client = new OpenAI();
const provider = createResponsesProvider(client, "o3");

const input = await cria
  .prompt(provider)
  .system("You are helpful.")
  .user(userQuestion)
  .render({ budget: 8000 });

const response = await client.responses.create({ model: "o3", input });
```

Runnable example: [openai-responses](../../examples/openai-responses)

```bash
cd examples/openai-responses
pnpm install
pnpm start
```

See `../../examples/openai-responses/README.md` for full setup details.

## Budgets and compaction

If you pass a `budget` to `render()`, you must supply a provider or bind one with `cria.prompt(provider)`. The provider owns token counting via tiktoken.

Next: [Fit & compaction](fit-and-compaction.md)

## Tool messages and reasoning traces

Cria can represent tool I/O (`ToolCall`, `ToolResult`) and reasoning traces (`Reasoning`) as semantic nodes so OpenAI providers can map them into the right shape. Tool calls live in assistant messages, tool results live in tool messages. Treat these as compaction candidates when budgets are tight.
