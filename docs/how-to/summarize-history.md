# Summarize long history

Use `Summary` as a drop-in component for chat history: keep recent turns verbatim, and compress older turns into a cached summary. When you render with a budget, `Summary` helps compaction stay predictable without losing all long-term context.

Runnable example: [summary](../../examples/summary)

```bash
cd examples/summary
pnpm install
pnpm start
```

This example calls a model to summarize, so it requires `OPENAI_API_KEY`. See `../../examples/summary/README.md`.

## Install

```bash
npm install openai
export OPENAI_API_KEY="sk-..."
```

## Minimal pattern

```ts
import OpenAI from "openai";
import { Provider } from "@fastpaca/cria/openai";
import { cria, InMemoryStore, type StoredSummary } from "@fastpaca/cria";

const store = new InMemoryStore<StoredSummary>();
const provider = new Provider(new OpenAI(), "gpt-4o-mini");

const prompt = cria
  .prompt()
  .provider(provider, (p) =>
    p.summary(history, { id: "history", store, priority: 2 })
  )
  .user(question);
```

Note: `InMemoryStore` is meant for demos/tests. For production, use `RedisStore` (`@fastpaca/cria/memory/redis`) or `PostgresStore` (`@fastpaca/cria/memory/postgres`).

## When to use Summary vs Last/Truncate

- Use `Last` to keep the last N turns verbatim.
- Use `Truncate` to keep as much as possible up to a token cap.
- Use `Summary` to keep older context “alive” in fewer tokens.

Next: [Fit & compaction](fit-and-compaction.md)
