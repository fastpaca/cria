# Summarize long history

Use the summary plugin as a drop-in component for chat history: keep recent turns verbatim, and compress older turns into a cached summary. When you render with a budget, the summary plugin helps compaction stay predictable without losing all long-term context.

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
import { createProvider } from "@fastpaca/cria/openai";
import { Summary, cria, InMemoryStore, type StoredSummary } from "@fastpaca/cria";

const store = new InMemoryStore<StoredSummary>();
const provider = createProvider(new OpenAI(), "gpt-4o-mini");

const summary = new Summary({
  id: "history",
  store,
  priority: 2,
  provider,
}).extend(cria.input(history));

const prompt = cria
  .prompt(provider)
  .use(summary)
  .user(question);
```

Tip: `history` can be provider-native message input (for example, AI SDK `ModelMessage[]`). Wrap it with `cria.input(history)` and pass a `provider` to the summary plugin so it can decode the input.

Tip: for per-user or per-session isolation, wrap your summary store with `UserScopedStore` (or scope the `id` with a user/session prefix).

Note: `InMemoryStore` is meant for demos/tests. For production, use `RedisStore` (`@fastpaca/cria/memory/redis`), `SqliteStore` (`@fastpaca/cria/memory/sqlite`), or `PostgresStore` (`@fastpaca/cria/memory/postgres`).

## When to use summary vs last/truncate

- Use `Last` to keep the last N turns verbatim.
- Use `Truncate` to keep as much as possible up to a token cap.
- Use the summary plugin to keep older context “alive” in fewer tokens.

Next: [Fit & compaction](fit-and-compaction.md)
