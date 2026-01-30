<h1 align="center">Cria</h1>

<p align="center">
  <b>Swap any component when something better drops.</b>
</p>

<p align="center">
  Built for fast-moving teams on a stack that changes weekly.
</p>

<p align="center">
  No lock-in, no rewrites — swap providers, memory, retrieval, and summarization/compaction strategies.
</p>

<p align="center">
  Your LLM app started simple. Then you added conversation history. Then RAG. Then tool outputs. Then summaries.
  Now you have a 400-line function that builds a prompt and nobody knows what's actually getting sent to the model.
</p>

<p align="center">
  <b>Cria is the prompt construction layer.</b>
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

Designed for fast-moving teams that need to swap components without rewriting their prompt code.

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

## The usual prompt spaghetti in production

Every production LLM app eventually ends up with a function like this. You know the one.
It started as 10 lines, and now it's the scariest file in your codebase. You poke at it and you need to run your entire eval suite and pray.

<details>
<summary><strong>The function you've definitely written before</strong></summary>

```ts
async function buildPrompt(user, query, tools) {
  const messages = [];

  messages.push({ role: "system", content: SYSTEM_PROMPT });

  // Get conversation history, but not too much
  const history = await getHistory(user.id);
  const truncatedHistory = history.slice(-20); // magic number, hope it fits
  messages.push(...truncatedHistory);

  // Maybe add a summary if history is long?
  if (history.length > 50) {
    const summary = await getSummary(user.id);
    if (summary) {
      messages.splice(1, 0, { role: "system", content: `Previous context: ${summary}` });
    }
  }

  // RAG results, if we have them
  const docs = await vectorSearch(query);
  if (docs.length > 0) {
    let context = docs.map((d) => d.content).join("\n\n");

    // but wait, is this too long? let's check tokens maybe?
    const tokens = countTokens(context);
    if (tokens > 4000) {
      // truncate somehow???
      context = context.slice(0, 12000); // characters aren't tokens but whatever
    }

    messages.push({ role: "system", content: `Relevant information:\n${context}` });
  }

  messages.push({ role: "user", content: query });

  // Did we blow the context window? Who knows!
  return messages;
}
```

</details>

You've written this function. You've debugged it at 2am. You've wondered what actually got sent to the model when a user reported weird behavior.

## The fix

With Cria, the same intent becomes:

```ts
const messages = await cria
  .prompt(provider)
  .system(SYSTEM_PROMPT)
  .summary(conversation, { id: "history", store: memory, priority: 2 })
  .vectorSearch({ store, query, limit: 10 })
  .last(conversation, { n: 20 })
  .user(query)
  .render({ budget: 128_000 });
```

Explicit structure. You can inspect what's in the prompt and why — which is exactly what you want at 2am.

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
