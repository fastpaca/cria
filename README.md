<h1 align="center">Cria</h1>

<p align="center">
  <i>Your prompts deserve the same structure as your code.</i>
</p>

<p align="center">
  <b><i>Cria turns prompts into composable components with explicit roles and strategies, and works with your existing environment & frameworks.</i></b>
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

Cria is a lightweight prompt composition library for structured prompt engineering. Build prompts as components, keep behavior predictable, and reuse the same structure across providers. Runs on Node, Deno, Bun, and Edge; adapters require their SDKs.

```ts
const messages = await cria
  .prompt()
  .system("You are a research assistant.")
  .vectorSearch({ store, query: question, limit: 10 })
  .providerScope(provider, (p) =>
    p.summary(conversation, { store: memory }).last(conversation, { N: 20 })
  )
  .user(question)
  .render({ budget: 200_000, provider });
```

Start with **[Quickstart](docs/quickstart.md)**, then use **[Docs](docs/README.md)** to jump to the right how-to.

## Use Cria when you need...

- **Need RAG?** Call `.vectorSearch({ store, query })`.
- **Need a summary for long conversations?** Use `.summary(...)`.
- **Need to cap history but keep structure?** Use `Last(...)`.
- **Need to drop optional context when the context window is full?** Use `.omit(...)`.
- **Using AI SDK?** Plug and play with `@fastpaca/cria/ai-sdk`!

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
  .prompt()
  .system("You are helpful.")
  .user(userQuestion)
  .render({ budget, provider });
const response = await client.chat.completions.create({ model: "gpt-4o-mini", messages });
```
</details>

<details>
<summary><strong>OpenAI Responses</strong></summary>

```ts
import OpenAI from "openai";
import { createResponsesProvider } from "@fastpaca/cria/openai";
import { cria } from "@fastpaca/cria";

const client = new OpenAI();
const provider = createResponsesProvider(client, "gpt-5-nano");
const input = await cria
  .prompt()
  .system("You are helpful.")
  .user(userQuestion)
  .render({ budget, provider });
const response = await client.responses.create({ model: "gpt-5-nano", input });
```
</details>

<details>
<summary><strong>Anthropic</strong></summary>

```ts
import Anthropic from "@anthropic-ai/sdk";
import { createProvider } from "@fastpaca/cria/anthropic";
import { cria } from "@fastpaca/cria";

const client = new Anthropic();
const provider = createProvider(client, "claude-haiku-4-5");
const { system, messages } = await cria
  .prompt()
  .system("You are helpful.")
  .user(userQuestion)
  .render({ budget, provider });
const response = await client.messages.create({ model: "claude-haiku-4-5", system, messages });
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
  .prompt()
  .system("You are helpful.")
  .user(userQuestion)
  .render({ budget, provider });
const { text } = await generateText({ model, messages });
```
</details>

## Evaluation (LLM-as-a-judge)

Use the `@fastpaca/cria/eval` entrypoint for judge-style evaluation helpers.

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

await judge(prompt).toPass(c`Helpfulness in addressing the user's question`);
```

## Roadmap

**Done**

- [x] Fluent DSL and priority-based eviction
- [x] Components: Region, Message, Truncate, Omit, Last, Summary, VectorSearch, ToolCall, ToolResult, Reasoning, Examples, CodeBlock, Separator
- [x] Providers: OpenAI (Chat Completions + Responses), Anthropic, AI SDK
- [x] AI SDK helpers: Messages component, DEFAULT_PRIORITIES
- [x] Memory: InMemoryStore, Redis, Postgres, Chroma, Qdrant
- [x] Observability: render hooks, validation schemas, OpenTelemetry
- [x] Prompt eval / testing functionality

**Planned**

- [ ] Next.js adapter
- [ ] GenAI semantic conventions for OpenTelemetry
- [ ] Visualization tool

## Contributing

- Issues and PRs are welcome.
- Keep changes small and focused.
- If you add a feature, include a short example or doc note.

## Support

- Open a GitHub issue for bugs or feature requests.
- For quick questions, include a minimal repro or snippet.

## FAQ

- **Does this replace my LLM SDK?** No - Cria builds prompt structures. You still use your SDK to call the model.
- **How do I tune token budgets?** Pass `budget` to `render()` and set priorities on regions; see [docs/how-to/fit-and-compaction.md](docs/how-to/fit-and-compaction.md).
- **Is this production-ready?** Not yet! It is a work in progress and you should test it out before you run this in production.

## License

MIT
