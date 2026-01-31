<h1 align="center">Cria</h1>

<p align="center">
  TypeScript prompt architecture for fast-moving teams and engineers.
</p>

<p align="center">
  <a href="https://github.com/fastpaca/cria/actions/workflows/ci.yml"><img src="https://github.com/fastpaca/cria/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://www.npmjs.com/package/@fastpaca/cria"><img src="https://img.shields.io/npm/v/@fastpaca/cria?logo=npm&logoColor=white" alt="npm"></a>
  <a href="https://opensource.org/license/mit"><img src="https://img.shields.io/badge/license-MIT-blue" alt="License"></a>
</p>

<p align="center">
  <a href="https://github.com/fastpaca/cria/stargazers">
    <img src="https://img.shields.io/badge/Give%20a%20Star-Support%20the%20project-orange?style=for-the-badge" alt="Give a Star">
  </a>
</p>

The LLM space moves fast. New models drop often. Providers change APIs. Better vector stores emerge. New memory systems drop. **Your prompts shouldn't break every time the stack evolves.**

Cria is prompt architecture as code. Same prompt logic, swap the building blocks underneath when you need to upgrade.

```ts
import { cria } from "@fastpaca/cria";
import { createProvider } from "@fastpaca/cria/openai";
import OpenAI from "openai";

const client = new OpenAI();
const model = "gpt-5-nano";
const provider = createProvider(client, model);

const messages = await cria
    .prompt(provider)
    .system("You are a research assistant.")
    .summary(conversation, { id: "history", store: memory })
    .vectorSearch({ store, query, limit: 8 })
    .user(query)
    .render({ budget: 128_000 });

const response = await client.chat.completions.create({ model, messages });
```

## Why Cria?

When you run LLM features in production, you need to:

1. **Build prompts that last** — Swap providers, models, memory, or retrieval without rewriting prompt logic. A/B test components as the stack evolves.
2. **Test like code** — Evaluate prompts with LLM-as-a-judge. Run tests in CI. Catch drift when you swap building blocks.
3. **Inspect what runs** — See exactly what gets sent to the model. Debug token budgets. See when your RAG input messes up the context. *(Local DevTools-style inspector: planned)*

Cria gives you composable prompt blocks, explicit token budgets, and building blocks you can easily customise and adapt so you move fast without breaking prompts.

## What you get

| Capability | Status |
| --- | --- |
| Component swapping via adapters | ✅ |
| Memory + vector search adapters | ✅ |
| Token budgeting | ✅ |
| Fit & compaction controls | ✅ |
| Conversation summaries | ✅ |
| OpenTelemetry integration | ✅ |
| Prompt eval/test helpers | ✅ |
| Local prompt inspector (DevTools-style) | planned |

## Quick start

```bash
npm install @fastpaca/cria
```

```ts
import { cria } from "@fastpaca/cria";
import { createProvider } from "@fastpaca/cria/openai";
import OpenAI from "openai";

const client = new OpenAI();
const model = "gpt-5-nano";
const provider = createProvider(client, model);

const messages = await cria
  .prompt(provider)
  .system("You are a helpful assistant.")
  .user("What is the capital of France?")
  .render({ budget: 128_000 });

const response = await client.chat.completions.create({ model, messages });
```

## Core patterns

<details>
<summary><strong>RAG with vector search</strong></summary>

```ts
const messages = await cria
  .prompt(provider)
  .system("You are a research assistant.")
  .vectorSearch({ store: qdrant, query, limit: 10 })
  .user(query)
  .render({ budget: 128_000 });
```

</details>

<details>
<summary><strong>Summarize long conversation history</strong></summary>

```ts
const messages = await cria
  .prompt(provider)
  .system("You are a helpful assistant.")
  .summary(conversation, { id: "conv", store: redis, priority: 2 })
  .last(conversation, { n: 20 })
  .user(query)
  .render({ budget: 128_000 });
```

</details>

<details>
<summary><strong>Token budgeting and compaction</strong></summary>

```ts
const messages = await cria
  .prompt(provider)
  .system(SYSTEM_PROMPT)
  // Dropped first when budget is tight
  .omit(examples, { priority: 3 })
  // Summaries are run ad-hoc once we hit budget limits
  .summary(conversation, { id: "conv", store: redis, priority: 2 })
  // Sacred, need to retain but limit to only 10 entries
  .vectorSearch({ store: qdrant, query, limit: 10 })
  .user(query)
  // 128k token budget, once we hit the budget strategies
  // will run based on priority & usage (e.g. summaries will
  // trigger).
  .render({ budget: 128_000 });
```

</details>

<details>
<summary><strong>Evaluate prompts like code</strong></summary>

```ts
import { c, cria } from "@fastpaca/cria";
import { createProvider } from "@fastpaca/cria/ai-sdk";
import { createJudge } from "@fastpaca/cria/eval";
import { openai } from "@ai-sdk/openai";

const judge = createJudge({
  target: createProvider(openai("gpt-4o")),
  evaluator: createProvider(openai("gpt-4o-mini")),
});

const prompt = await cria
  .prompt()
  .system("You are a helpful customer support agent.")
  .user("How do I update my payment method?")
  .build();

await judge(prompt).toPass(c`Provides clear, actionable steps`);
```

</details>

## Works with

<details>
<summary><strong>OpenAI (Chat Completions)</strong></summary>

```ts
import OpenAI from "openai";
import { createProvider } from "@fastpaca/cria/openai";
import { cria } from "@fastpaca/cria";

const client = new OpenAI();
const model = "gpt-5-nano";
const provider = createProvider(client, model);

const messages = await cria
  .prompt(provider)
  .system("You are helpful.")
  .user(userQuestion)
  .render({ budget: 128_000 });

const response = await client.chat.completions.create({ model, messages });
```

</details>

<details>
<summary><strong>OpenAI (Responses)</strong></summary>

```ts
import OpenAI from "openai";
import { createResponsesProvider } from "@fastpaca/cria/openai";
import { cria } from "@fastpaca/cria";

const client = new OpenAI();
const model = "gpt-5-nano";
const provider = createResponsesProvider(client, model);

const input = await cria
  .prompt(provider)
  .system("You are helpful.")
  .user(userQuestion)
  .render({ budget: 128_000 });

const response = await client.responses.create({ model, input });
```

</details>

<details>
<summary><strong>Anthropic</strong></summary>

```ts
import Anthropic from "@anthropic-ai/sdk";
import { createProvider } from "@fastpaca/cria/anthropic";
import { cria } from "@fastpaca/cria";

const client = new Anthropic();
const model = "claude-sonnet-4";
const provider = createProvider(client, model);

const { system, messages } = await cria
  .prompt(provider)
  .system("You are helpful.")
  .user(userQuestion)
  .render({ budget: 128_000 });

const response = await client.messages.create({ model, system, messages });
```

</details>

<details>
<summary><strong>Vercel AI SDK</strong></summary>

```ts
import { createProvider } from "@fastpaca/cria/ai-sdk";
import { cria } from "@fastpaca/cria";
import { generateText } from "ai";

const provider = createProvider(model);

const messages = await cria
  .prompt(provider)
  .system("You are helpful.")
  .user(userQuestion)
  .render({ budget: 128_000 });

const { text } = await generateText({ model, messages });
```

</details>

<details>
<summary><strong>Redis (conversation summaries)</strong></summary>

```ts
import { RedisStore } from "@fastpaca/cria/memory/redis";
import type { StoredSummary } from "@fastpaca/cria";

const store = new RedisStore<StoredSummary>({
  host: "localhost",
  port: 6379,
});

const messages = await cria
  .prompt(provider)
  .system("You are a helpful assistant.")
  .summary(conversation, { id: "conv-123", store, priority: 2 })
  .last(conversation, { n: 20 })
  .user(query)
  .render({ budget: 128_000 });
```

</details>

<details>
<summary><strong>Postgres (conversation summaries)</strong></summary>

```ts
import { PostgresStore } from "@fastpaca/cria/memory/postgres";
import type { StoredSummary } from "@fastpaca/cria";

const store = new PostgresStore<StoredSummary>({
  connectionString: "postgres://user:pass@localhost/mydb",
});

const messages = await cria
  .prompt(provider)
  .system("You are a helpful assistant.")
  .summary(conversation, { id: "conv-123", store, priority: 2 })
  .last(conversation, { n: 20 })
  .user(query)
  .render({ budget: 128_000 });
```

</details>

<details>
<summary><strong>Chroma (vector search)</strong></summary>

```ts
import { ChromaClient } from "chromadb";
import { ChromaStore } from "@fastpaca/cria/memory/chroma";

const client = new ChromaClient({ path: "http://localhost:8000" });
const collection = await client.getOrCreateCollection({ name: "my-docs" });

const store = new ChromaStore({
  collection,
  embed: async (text) => await getEmbedding(text),
});

const messages = await cria
  .prompt(provider)
  .system("You are a research assistant.")
  .vectorSearch({ store, query, limit: 10 })
  .user(query)
  .render({ budget: 128_000 });
```

</details>

<details>
<summary><strong>Qdrant (vector search)</strong></summary>

```ts
import { QdrantClient } from "@qdrant/js-client-rest";
import { QdrantStore } from "@fastpaca/cria/memory/qdrant";

const client = new QdrantClient({ url: "http://localhost:6333" });

const store = new QdrantStore({
  client,
  collectionName: "my-docs",
  embed: async (text) => await getEmbedding(text),
});

const messages = await cria
  .prompt(provider)
  .system("You are a research assistant.")
  .vectorSearch({ store, query, limit: 10 })
  .user(query)
  .render({ budget: 128_000 });
```

</details>

## Documentation

- [Quickstart](docs/quickstart.md)
- [RAG / vector search](docs/how-to/rag.md)
- [Summarize long history](docs/how-to/summarize-history.md)
- [Fit & compaction](docs/how-to/fit-and-compaction.md)
- [Prompt evaluation](docs/how-to/prompt-evaluation.md)
- [Full documentation](docs/README.md)

## FAQ

**What does Cria output?**
Prompt structures/messages (via a provider adapter). You pass the rendered output into your existing LLM SDK call.

**What works out of the box?**
Provider adapters for OpenAI (Chat Completions + Responses), Anthropic, and Vercel AI SDK; store adapters for Redis, Postgres, Chroma, and Qdrant.

**How do I validate component swaps?**
Swap via adapters, diff the rendered prompt output, and run prompt eval/tests to catch drift.

**What's the API stability?**
We use Cria in production, but the API may change before 2.0. Pin versions and follow the changelog.

## Contributing

Issues and PRs welcome. Keep changes small and focused.

## License

MIT
