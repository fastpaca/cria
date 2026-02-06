# Summarize long history

Use the summarizer component as a drop-in for chat history: keep recent turns verbatim, and compress older turns into a cached summary. When you render with a budget, the summarizer helps compaction stay predictable without losing all long-term context.

Runnable example: [summary-sqlite](../../examples/summary-sqlite)

```bash
cd examples/summary-sqlite
pnpm install
pnpm start
```

This example calls a model to summarize, so it requires `OPENAI_API_KEY`. See `../../examples/summary-sqlite/README.md`.

## Install

```bash
npm install openai
export OPENAI_API_KEY="sk-..."
```

## Minimal pattern

```ts
import OpenAI from "openai";
import { createProvider } from "@fastpaca/cria/openai";
import { cria, InMemoryStore, type StoredSummary } from "@fastpaca/cria";

const store = new InMemoryStore<StoredSummary>();
const provider = createProvider(new OpenAI(), "gpt-4o-mini");

const summarizer = cria.summarizer({
  id: "history",
  store,
  priority: 2,
  provider,
});
const conversation = cria.history({ history });
const summary = summarizer.plugin({ history });

const prompt = cria
  .prompt(provider)
  .use(summary)
  .use(conversation)
  .user(question);
```

Tip: `cria.history({ history })` is the easiest way to insert prior turns with `.use(...)`.

Tip: `history` can be a prompt builder, prompt nodes, or a `PromptLayout`.

Tip: for per-user or per-session isolation, use an id convention like `history:${userId}:${sessionId}` and attach metadata via `summarizer({ metadata: { userId, sessionId }, ... })`.

Note: `InMemoryStore` is meant for demos/tests. For production, use `RedisStore` (`@fastpaca/cria/memory/redis`), `SqliteStore` (`@fastpaca/cria/memory/sqlite`), or `PostgresStore` (`@fastpaca/cria/memory/postgres`).

## When to use summary vs last/truncate

- Use `Last` to keep the last N turns verbatim.
- Use `Truncate` to keep as much as possible up to a token cap.
- Use the summarizer to keep older context “alive” in fewer tokens.

Next: [Fit & compaction](fit-and-compaction.md)
