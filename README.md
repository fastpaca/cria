<h1 align="center">Cria</h1>

<p align="center">
  <b>Stop writing prompt spaghetti.</b>
</p>

<p align="center">
  Your LLM app started simple. Then you added conversation history. Then RAG. Then tool outputs. Then summaries.
  Now you have a 400-line function that builds a prompt and nobody knows what's actually getting sent to the model.
</p>

<p align="center">
  <b>Cria gives you prompt architecture.</b>
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

Cria is a lightweight TypeScript toolkit for building prompts as an explicit pipeline.
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

## What you get

* **Compose prompts like code** — Build reusable pieces (policies, tool instructions, retrieval blocks) that snap together predictably.
* **Real memory layouts** — Working context, summaries, and retrieval wired together intentionally, not duct-taped.
* **Provider-agnostic** — Render through adapters for OpenAI, Anthropic, or Vercel AI SDK. Switch without rewriting.
* **Debug what matters** — Inspect exactly what prompt you sent (and why each piece is there).
* **Regression-test prompts** — Eval helpers catch prompt drift before prod does.

## Performance (benchmarks)

Benchmarks run via `npm run bench:compare` (Vitest bench) using `bench/baseline.json` as the baseline. Numbers below are from a single run on a dev machine and are hardware-dependent.

### Golden render loop (standard summary-first)

| Scenario | Current (hz / mean ms) | Baseline (hz / mean ms) |
| --- | --- | --- |
| build + render baseline (no fit loop) | 370.08 / 2.7021 | 477.14 / 2.0958 |
| render prebuilt baseline (no fit loop) | 378.94 / 2.6389 | 481.99 / 2.0747 |
| render prebuilt fit budget (cold summary store) | 978.10 / 1.0224 | 279.66 / 3.5757 |
| render prebuilt tight budget (warm summary store) | 1,702.59 / 0.5873 | 280.63 / 3.5634 |

### Golden render loop (multi-strategy stress)

| Scenario | Current (hz / mean ms) | Baseline (hz / mean ms) |
| --- | --- | --- |
| render prebuilt fit budget (cold summary store) | 4,024.69 / 0.2485 | 99.2313 / 10.0775 |

### Golden render loop (huge trees)

| Scenario | Current (hz / mean ms) | Baseline (hz / mean ms) |
| --- | --- | --- |
| build + render baseline (huge, no fit loop) | 66.4878 / 15.0403 | 83.6938 / 11.9483 |
| render prebuilt baseline (huge, no fit loop) | 66.9531 / 14.9358 | 84.5006 / 11.8342 |
| render prebuilt fit budget (huge, cold summary store) | 213.49 / 4.6840 | 53.0007 / 18.8677 |
| render prebuilt tight budget (huge, warm summary store) | 399.99 / 2.5001 | 53.7445 / 18.6066 |

### Golden render loop (20k messages)

| Scenario | Current (hz / mean ms) | Baseline (hz / mean ms) |
| --- | --- | --- |
| render prebuilt baseline (20k, no fit loop) | 8.2415 / 121.34 | 16.0650 / 62.2472 |
| render prebuilt fit budget (20k, cold summary store) | 358.27 / 2.7912 | 15.4644 / 64.6648 |
| render prebuilt tight budget (20k, warm summary store) | 356.94 / 2.8016 | 15.4918 / 64.5501 |

### Provider codec render loop (OpenAI chat)

| Scenario | Current (hz / mean ms) | Baseline (hz / mean ms) |
| --- | --- | --- |
| render baseline (chat codec) | 185.40 / 5.3937 | 183.78 / 5.4413 |
| render fit budget (chat codec) | 976.15 / 1.0244 | 138.01 / 7.2460 |
| render tight budget (chat codec) | 982.81 / 1.0175 | 135.68 / 7.3703 |
| render multi-strategy stress (chat codec) | 2,997.66 / 0.3336 | 50.2415 / 19.9039 |

### Provider codec render loop (OpenAI responses)

| Scenario | Current (hz / mean ms) | Baseline (hz / mean ms) |
| --- | --- | --- |
| render baseline (responses codec) | 185.71 / 5.3847 | 186.19 / 5.3710 |
| render fit budget (responses codec) | 983.24 / 1.0170 | 137.91 / 7.2511 |
| render tight budget (responses codec) | 975.76 / 1.0248 | 139.05 / 7.1918 |
| render multi-strategy stress (responses codec) | 2,949.79 / 0.3390 | 50.5045 / 19.8002 |

### Provider codec render loop (AI SDK)

| Scenario | Current (hz / mean ms) | Baseline (hz / mean ms) |
| --- | --- | --- |
| render baseline (ai-sdk codec) | 168.16 / 5.9468 | 170.25 / 5.8737 |
| render fit budget (ai-sdk codec) | 984.52 / 1.0157 | 129.35 / 7.7308 |
| render tight budget (ai-sdk codec) | 949.51 / 1.0532 | 128.15 / 7.8036 |
| render multi-strategy stress (ai-sdk codec) | 2,898.78 / 0.3450 | 46.2523 / 21.6206 |

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

## Use cases

* **Tool-using agents** with stable policies that don't drift
* **RAG apps** that don't turn into unmaintainable prompt spaghetti
* **Long-running assistants** where memory needs actual structure
* **Multi-provider deployments** that want one prompt architecture

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
* [ ] Visualization tool
* [ ] Seamless provider integration (type system, no hoops)

## Why we built Cria

We spent months [benchmarking memory systems](https://fastpaca.com/blog/memory-isnt-one-thing) for production LLM apps (Mem0, Zep, etc).
What we found: they were often dramatically more expensive than naive long-context and sometimes less accurate in recall.

The problem wasn't "memory." It was everything underneath — the prompt construction layer everyone treats as an afterthought.
RAG gets bolted on. Summaries get hacked in. Token windows get enforced with magic numbers and hope.

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
