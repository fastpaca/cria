<h1 align="center">Cria</h1>

<p align="center">
  <b>Swap any component when something better drops.</b>
</p>

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

Cria is a lightweight TypeScript prompt architecture layer for fast-moving teams.
Compose reusable prompt blocks, wire in memory + retrieval, and **inspect exactly what gets sent** — across OpenAI, Anthropic, or Vercel AI SDK.

```ts
const messages = await cria
  .prompt(provider)
  .system("You are a research assistant.")
  .vectorSearch({ store, query, limit: 10 })
  .summary(conversation, { id: "history", store: memory })
  .user(query)
  .render({ budget: 128_000 });
```

## Status

| Area | Status |
| --- | --- |
| Build | ✅ |
| Eval | ✅ |
| Inspect | ❌ |

**Build**: compose prompt pipelines (providers, memory, retrieval) as explicit steps.

**Eval**: prompt eval/test helpers to catch drift.

**Inspect**: planned local DevTools-style prompt inspector (preview final prompt, token counts per block, and diffs when swapping components).

## Works with

| Integration | Status |
| --- | --- |
| OpenAI (Chat Completions) | ✅ |
| OpenAI (Responses) | ✅ |
| Anthropic | ✅ |
| Vercel AI SDK | ✅ |
| Redis | ✅ |
| Postgres | ✅ |
| Chroma | ✅ |
| Qdrant | ✅ |

## Why Cria

Cria is prompt architecture for teams that need to swap providers, memory, and retrieval without rewrites.
It keeps prompt construction explicit and reviewable so you can move fast without breaking prompts.

## What you get

* Swap providers and stores without rewrites.
* Token budgeting + fit/compaction controls.
* Render hooks + OpenTelemetry integration.

## Swap, don't rewrite

Same prompt architecture, different components:

```ts
// Pseudocode identifiers; replace with your adapters.
const build = (provider, memory, store) =>
  cria
    .prompt(provider)
    .system(SYSTEM_PROMPT)
    .summary(conversation, { id: "history", store: memory })
    .vectorSearch({ store, query, limit: 8 })
    .user(query)
    .render({ budget: 128_000 });

const messages = await build(openaiProvider, redisMemory, qdrantStore);
const messages2 = await build(anthropicProvider, postgresMemory, chromaStore);
```

## Use Cria if...

* You need to swap providers, memory, or retrieval without touching prompt logic.
* You A/B test summarization or compaction strategies.
* You migrate components frequently as the stack evolves.
* You want to inspect what gets sent before it hits the model.

## Quick start

```bash
npm install @fastpaca/cria
```

```ts
import { cria } from "@fastpaca/cria";
import { createProvider } from "@fastpaca/cria/openai";
import OpenAI from "openai";

const client = new OpenAI();
const provider = createProvider(client, "gpt-4o-mini");

const messages = await cria
  .prompt(provider)
  .system("You are a helpful assistant.")
  .user("What is the capital of France?")
  .render({ budget: 128_000 });

const response = await client.chat.completions.create({
  model: "gpt-4o-mini",
  messages,
});
```

## Docs

* [Quickstart](docs/quickstart.md)
* [RAG / vector search](docs/how-to/rag.md)
* [Summarize long history](docs/how-to/summarize-history.md)
* [Fit & compaction](docs/how-to/fit-and-compaction.md)
* [Prompt evaluation](docs/how-to/prompt-evaluation.md)
* [Full documentation](docs/README.md)

## Providers

<details>
<summary><strong>OpenAI Chat Completions</strong></summary>

```ts
import OpenAI from "openai";
import { createProvider } from "@fastpaca/cria/openai";
import { cria } from "@fastpaca/cria";

const client = new OpenAI();
const provider = createProvider(client, "gpt-4o-mini");

const messages = await cria
  .prompt(provider)
  .system("You are helpful.")
  .user(userQuestion)
  .render({ budget });

const response = await client.chat.completions.create({
  model: "gpt-4o-mini",
  messages,
});
```

</details>

<details>
<summary><strong>OpenAI Responses</strong></summary>

```ts
import OpenAI from "openai";
import { createResponsesProvider } from "@fastpaca/cria/openai";
import { cria } from "@fastpaca/cria";

const client = new OpenAI();
const provider = createResponsesProvider(client, "gpt-4o");

const input = await cria
  .prompt(provider)
  .system("You are helpful.")
  .user(userQuestion)
  .render({ budget });

const response = await client.responses.create({
  model: "gpt-4o",
  input,
});
```

</details>

<details>
<summary><strong>Anthropic</strong></summary>

```ts
import Anthropic from "@anthropic-ai/sdk";
import { createProvider } from "@fastpaca/cria/anthropic";
import { cria } from "@fastpaca/cria";

const client = new Anthropic();
const provider = createProvider(client, "claude-sonnet-4-20250514");

const { system, messages } = await cria
  .prompt(provider)
  .system("You are helpful.")
  .user(userQuestion)
  .render({ budget });

const response = await client.messages.create({
  model: "claude-sonnet-4-20250514",
  system,
  messages,
});
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
  .render({ budget });

const { text } = await generateText({ model, messages });
```

</details>

## Memory & retrieval

Cria has built-in support for the patterns you actually need:

```ts
// Summarize old conversation, keep recent messages
.summary(conversation, { id: "conv", store: redis, priority: 2 })
.last(conversation, { n: 20 })

// Vector search with automatic context injection
.vectorSearch({ store: qdrant, query, limit: 10 })

// Drop optional context when budget is tight
.omit(examples, { priority: 3 })
```

Supported stores: Redis, Postgres, Chroma, Qdrant. Or bring your own.

## Evaluation

Test your prompts like you test your code:

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

Use it in your favorite test runner (we like vitest) and relax.

<details>
<summary><strong>Snippets (providers + common operations)</strong></summary>

```ts
// OpenAI Chat Completions
import OpenAI from "openai";
import { createProvider } from "@fastpaca/cria/openai";

const openai = new OpenAI();
const openaiProvider = createProvider(openai, "gpt-4o-mini");
```

```ts
// OpenAI Responses
import OpenAI from "openai";
import { createResponsesProvider } from "@fastpaca/cria/openai";

const openai = new OpenAI();
const openaiResponsesProvider = createResponsesProvider(openai, "gpt-4o");
```

```ts
// Anthropic
import Anthropic from "@anthropic-ai/sdk";
import { createProvider } from "@fastpaca/cria/anthropic";

const anthropic = new Anthropic();
const anthropicProvider = createProvider(anthropic, "claude-sonnet-4-20250514");
```

```ts
// Vercel AI SDK
import { createProvider } from "@fastpaca/cria/ai-sdk";

// `model` is an AI SDK model instance
const aiSdkProvider = createProvider(model);
```

```ts
// Common operations
// `redis`, `qdrant`, and `examples` are your own adapters/values
const messages = await cria
  .prompt(provider)
  .system(SYSTEM_PROMPT)
  .summary(conversation, { id: "conv", store: redis, priority: 2 })
  .last(conversation, { n: 20 })
  .vectorSearch({ store: qdrant, query, limit: 10 })
  .omit(examples, { priority: 3 })
  .render({ budget: 128_000 });
```

</details>

## FAQ

**What does Cria output?**
Prompt structures/messages (via a provider adapter). You pass the rendered output into your existing LLM SDK call.

**What works out of the box?**
Provider adapters for OpenAI (Chat Completions + Responses), Anthropic, and Vercel AI SDK; store adapters for Redis, Postgres, Chroma, and Qdrant.

**How do teams validate swaps?**
Swap via adapters, then diff rendered prompt output and run prompt eval/tests to catch drift.

**How do I handle context limits?**
Use token budgeting plus fit/compaction controls to stay within a budget.

**What hooks exist for tracing and testing?**
Render hooks + OpenTelemetry integration for tracing, plus prompt eval/test helpers.

**What’s the status of the local inspector and API stability?**
The DevTools-style local prompt inspector is planned (not shipped). We use Cria in production, but the API may change before 2.0 — pin versions and follow the changelog.

## Contributing

Issues and PRs welcome. Keep changes small and focused.

## License

MIT
