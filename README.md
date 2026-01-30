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

## Performance (benchmarks)

Benchmarks run via `npm run bench:compare` (Vitest bench) using `bench/baseline.json` as the baseline. Numbers below are from a single run on a dev machine and are hardware-dependent.

### Golden render loop (standard summary-first)

| Scenario | Current (hz / mean ms) | Baseline (hz / mean ms) |
| --- | --- | --- |
| build + render baseline (no fit loop) | 187.62 / 5.3300 | 477.14 / 2.0958 |
| render prebuilt baseline (no fit loop) | 377.59 / 2.6483 | 481.99 / 2.0747 |
| render prebuilt fit budget (cold summary store) | 960.43 / 1.0412 | 279.66 / 3.5757 |
| render prebuilt tight budget (warm summary store) | 1,696.44 / 0.5895 | 280.63 / 3.5634 |

### Golden render loop (multi-strategy stress)

| Scenario | Current (hz / mean ms) | Baseline (hz / mean ms) |
| --- | --- | --- |
| render prebuilt fit budget (cold summary store) | 4,812.49 / 0.2078 | 99.2313 / 10.0775 |

### Golden render loop (huge trees)

| Scenario | Current (hz / mean ms) | Baseline (hz / mean ms) |
| --- | --- | --- |
| build + render baseline (huge, no fit loop) | 33.2765 / 30.0512 | 83.6938 / 11.9483 |
| render prebuilt baseline (huge, no fit loop) | 66.7235 / 14.9872 | 84.5006 / 11.8342 |
| render prebuilt fit budget (huge, cold summary store) | 209.92 / 4.7637 | 53.0007 / 18.8677 |
| render prebuilt tight budget (huge, warm summary store) | 398.96 / 2.5065 | 53.7445 / 18.6066 |

### Golden render loop (20k messages)

| Scenario | Current (hz / mean ms) | Baseline (hz / mean ms) |
| --- | --- | --- |
| render prebuilt baseline (20k, no fit loop) | 8.2062 / 121.86 | 16.0650 / 62.2472 |
| render prebuilt fit budget (20k, cold summary store) | 227.72 / 4.3913 | 15.4644 / 64.6648 |
| render prebuilt tight budget (20k, warm summary store) | 231.83 / 4.3136 | 15.4918 / 64.5501 |

### Provider codec render loop (OpenAI chat)

| Scenario | Current (hz / mean ms) | Baseline (hz / mean ms) |
| --- | --- | --- |
| render baseline (chat codec) | 184.41 / 5.4228 | 183.78 / 5.4413 |
| render fit budget (chat codec) | 958.28 / 1.0435 | 138.01 / 7.2460 |
| render tight budget (chat codec) | 955.80 / 1.0462 | 135.68 / 7.3703 |
| render multi-strategy stress (chat codec) | 3,821.01 / 0.2617 | 50.2415 / 19.9039 |

### Provider codec render loop (OpenAI responses)

| Scenario | Current (hz / mean ms) | Baseline (hz / mean ms) |
| --- | --- | --- |
| render baseline (responses codec) | 185.54 / 5.3898 | 186.19 / 5.3710 |
| render fit budget (responses codec) | 965.21 / 1.0360 | 137.91 / 7.2511 |
| render tight budget (responses codec) | 967.18 / 1.0339 | 139.05 / 7.1918 |
| render multi-strategy stress (responses codec) | 3,786.00 / 0.2641 | 50.5045 / 19.8002 |

### Provider codec render loop (AI SDK)

| Scenario | Current (hz / mean ms) | Baseline (hz / mean ms) |
| --- | --- | --- |
| render baseline (ai-sdk codec) | 167.97 / 5.9533 | 170.25 / 5.8737 |
| render fit budget (ai-sdk codec) | 960.08 / 1.0416 | 129.35 / 7.7308 |
| render tight budget (ai-sdk codec) | 964.75 / 1.0365 | 128.15 / 7.8036 |
| render multi-strategy stress (ai-sdk codec) | 3,659.61 / 0.2733 | 46.2523 / 21.6206 |

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
