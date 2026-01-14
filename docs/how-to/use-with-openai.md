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
import { chatCompletions } from "@fastpaca/cria/openai";

const client = new OpenAI();

const messages = await cria
  .prompt()
  .system("You are helpful.")
  .user(userQuestion)
  .render({ renderer: chatCompletions });

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
import { responses } from "@fastpaca/cria/openai";

const client = new OpenAI();

const input = await cria
  .prompt()
  .system("You are helpful.")
  .user(userQuestion)
  .render({ renderer: responses });

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

If you pass a `budget` to `render()`, you must also supply token counts (either a `tokenizer` option, or a provider context that supplies one).

Next: [Fit & compaction](fit-and-compaction.md)

## Tool messages and reasoning traces

Cria can represent tool I/O (`ToolCall`, `ToolResult`) and reasoning traces (`Reasoning`) as semantic nodes so OpenAI renderers can map them into the right shape. Treat these as compaction candidates when budgets are tight.
