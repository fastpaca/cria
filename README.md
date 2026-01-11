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
  <a href="https://www.npmjs.com/package/@fastpaca/cria"><img src="https://img.shields.io/npm/dm/@fastpaca/cria" alt="Downloads"></a>
  <a href="https://opensource.org/license/mit"><img src="https://img.shields.io/badge/license-MIT-blue" alt="License"></a>
</p>

Cria is a fluent DSL for structured prompt engineering. Compose prompts as regions with priorities and strategies, then render to OpenAI, Anthropic, or AI SDK formats. Runs on Node, Deno, Bun, and Edge; adapters require their SDKs. JSX is optional via `@fastpaca/cria/jsx` if you prefer TSX syntax.

## Example

```ts
import { cria } from "@fastpaca/cria";

const messages = await cria
  .prompt()
  .system("You are a helpful assistant.")
  .last(historyMessages, { N: 12, priority: 2 })
  .omit(optionalExamples, { priority: 3 })
  .user(userQuestion)
  .render({ tokenizer, budget: 8_000, renderer: chatCompletions });
```

See all **[-> Documentation](docs/README.md)** for more comprehensive overviews.

## Use Cria when you need...

- **Need RAG?** Call `.vectorSearch({ store, query })`.
- **Need a summary for long conversations?** Use `.summary(...)`.
- **Need to cap history but keep structure?** Use `.last(...)`.
- **Need to drop optional context when the context window is full?** Use `.omit(...)`.
- **Need granular tool calling structure?** Use `.toolCall(...)` + `.toolResult(...)`.
- **Using AI SDK?** Plug and play with `@fastpaca/cria/ai-sdk`!
- **Prefer TSX?** Import the optional JSX surface from `@fastpaca/cria/jsx`.

## Integrations

<details>
<summary><strong>OpenAI Chat Completions</strong></summary>

```ts
import OpenAI from "openai";
import { chatCompletions } from "@fastpaca/cria/openai";
import { cria } from "@fastpaca/cria";

const client = new OpenAI();
const messages = await cria
  .prompt()
  .system("You are helpful.")
  .user(userQuestion)
  .render({ budget, tokenizer, renderer: chatCompletions });
const response = await client.chat.completions.create({ model: "gpt-4o", messages });
```
</details>

<details>
<summary><strong>OpenAI Responses</strong></summary>

```ts
import OpenAI from "openai";
import { responses } from "@fastpaca/cria/openai";
import { cria } from "@fastpaca/cria";

const client = new OpenAI();
const input = await cria
  .prompt()
  .system("You are helpful.")
  .user(userQuestion)
  .render({ budget, tokenizer, renderer: responses });
const response = await client.responses.create({ model: "o3", input });
```
</details>

<details>
<summary><strong>Anthropic</strong></summary>

```ts
import Anthropic from "@anthropic-ai/sdk";
import { anthropic } from "@fastpaca/cria/anthropic";
import { cria } from "@fastpaca/cria";

const client = new Anthropic();
const { system, messages } = await cria
  .prompt()
  .system("You are helpful.")
  .user(userQuestion)
  .render({ budget, tokenizer, renderer: anthropic });
const response = await client.messages.create({ model: "claude-sonnet-4-20250514", system, messages });
```
</details>

<details>
<summary><strong>Vercel AI SDK</strong></summary>

```ts
import { renderer } from "@fastpaca/cria/ai-sdk";
import { cria } from "@fastpaca/cria";
import { generateText } from "ai";

const messages = await cria
  .prompt()
  .system("You are helpful.")
  .user(userQuestion)
  .render({ budget, tokenizer, renderer });
const { text } = await generateText({ model, messages });
```
</details>

## Roadmap

**Done**

- [x] Fluent DSL and priority-based eviction
- [x] Components: Region, Message, Truncate, Omit, Last, Summary, VectorSearch, ToolCall, ToolResult, Reasoning, Examples, CodeBlock, Separator
- [x] Renderers: OpenAI (Chat Completions + Responses), Anthropic, AI SDK
- [x] AI SDK helpers: Messages component, DEFAULT_PRIORITIES
- [x] Memory: InMemoryStore, Redis, Postgres, Chroma, Qdrant
- [x] Observability: render hooks, validation schemas, snapshots, OpenTelemetry

**Planned**

- [ ] Message storage (conversation history management)
- [ ] Tokenizer helpers
- [ ] Next.js adapter
- [ ] GenAI semantic conventions for OpenTelemetry
- [ ] Visualization tool

## Contributing

- Issues and PRs are welcome.
- Keep changes small and focused.
- If you add a feature, include a short example or doc note.
- Prefer DSL-based examples in contributions; JSX lives under `@fastpaca/cria/jsx` as optional sugar.

## Support

- Open a GitHub issue for bugs or feature requests.
- For quick questions, include a minimal repro or snippet.

## FAQ

- **Does this replace my LLM SDK?** No - Cria builds prompt structures. You still use your SDK to call the model.
- **How do I tune token budgets?** Pass `budget` to `render()` and set priorities on regions. Providers include tiktoken defaults; see [docs/tokenization.md](docs/tokenization.md) to bring your own.
- **Is this production-ready?** The core features are stable; see the docs for what's in progress.

## License

MIT
