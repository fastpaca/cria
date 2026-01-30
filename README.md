<h1 align="center">Cria</h1>

<p align="center">
  <b>Swap any component when something better drops.</b>
</p>

<p align="center">
  TypeScript prompt architecture for fast-moving stacks.
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

Cria is a lightweight TypeScript prompt architecture layer.
Compose reusable prompt blocks, wire in memory + retrieval, and **inspect exactly what gets sent** — across OpenAI, Anthropic, or Vercel AI SDK.


<!-- -->

```ts
const messages = await cria
  .prompt(provider)
  .system("You are a research assistant.")
  .vectorSearch({ store, query, limit: 10 })
  .summary(conversation, { id: "history", store: memory })
  .user(query)
  .render({ budget: 128_000 });
```

Start with **[Quickstart](docs/quickstart.md)** or keep reading.

## Why Cria

Cria keeps prompt construction explicit and swappable, so you can evolve providers, memory, retrieval, and compaction strategies without rewriting your prompt layer.

## Three pillars

* **Build** — Compose prompts as explicit pipelines.
* **Swap** — Swap providers, memory, retrieval, or compaction without rewrites.
* **Inspect (planned)** — Local DevTools-style inspector to preview what you'll send.

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

## Use cases

* Fast-moving teams swapping providers, memory, or retrieval without touching prompt logic.
* Builders A/B testing summarization or compaction strategies.
* Apps that need to migrate components without rewrites as the stack evolves.
* Teams that want to inspect what gets sent (and later use the planned local inspector).

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

## Roadmap

**Done**

* [x] Fluent DSL and compaction controls
* [x] Providers: OpenAI (Chat Completions + Responses), Anthropic, AI SDK
* [x] Stores: Redis, Postgres, Chroma, Qdrant
* [x] Observability: render hooks, OpenTelemetry
* [x] Prompt eval / testing functionality

**Planned**

* [ ] Next.js adapter
* [ ] Local prompt inspector (DevTools-style)
* [ ] Seamless provider integration (type system, no hoops)

## Why we built Cria

We spent months [benchmarking memory systems](https://fastpaca.com/blog/memory-isnt-one-thing) for production LLM apps (Mem0, Zep, etc).
They were often dramatically more expensive than naive long-context and sometimes less accurate in recall.

The real problem wasn't "memory." It was the prompt construction layer everyone treats as an afterthought.
Cria is the architecture we needed: explicit structure for prompts, memory, and retrieval. Composable. Debuggable. Provider-agnostic.

— [fastpaca](https://fastpaca.com)

## FAQ

**Does this replace my LLM SDK?**
No — Cria builds prompt structures. You still use your SDK to call the model.

**Is this production-ready?**
We're using it in production, but the API may change before 2.0. Test thoroughly.

## Contributing

Issues and PRs welcome. Keep changes small and focused.

## License

MIT
