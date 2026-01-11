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

<p align="center">
  <a href="https://github.com/fastpaca/cria/stargazers">
    <img src="https://img.shields.io/badge/Give%20a%20Star-Support%20the%20project-orange?style=for-the-badge" alt="Give a Star">
  </a>
</p>

Cria is a lightweight JSX prompt composition library for structured prompt engineering. Build prompts as components, keep behavior predictable, and reuse the same structure across providers. Runs on Node, Deno, Bun, and Edge; adapters require their SDKs.

## Example

```tsx
import { Message, Omit, Region, Truncate, render } from "@fastpaca/cria";

const prompt = (
  <Region priority={0}>
    <Message messageRole="system">You are a helpful assistant.</Message>
    <Last N={12} priority={2}>{historyMessages}</Last>
    <Omit priority={3}>{optionalExamples}</Omit>
    <Message messageRole="user">{userQuestion}</Message>
  </Region>
);

const output = await render(prompt, { budget: 8_000 });
```

See all **[-> Documentation](docs/README.md)** for more comprehensive overviews.

## Use Cria when you need...

- **Need RAG?** Add `<VectorSearch>`!
- **Need a summary for long conversations?** Add `<Summary>`!
- **Need to cap history but keep structure?** Use `<Last>`.
- **Need to drop optional context when the context window is full?** Add `<Omit>`.
- **Need granular tool calling structure?** Add `<ToolCall>` and `<ToolResult>`.
- **Using AI SDK?** Plug and play with `@fastpaca/cria/ai-sdk`!

## Integrations

<details>
<summary><strong>OpenAI Chat Completions</strong></summary>

```tsx
import OpenAI from "openai";
import { chatCompletions } from "@fastpaca/cria/openai";
import { render } from "@fastpaca/cria";

const client = new OpenAI();
const messages = await render(prompt, { budget, renderer: chatCompletions });
const response = await client.chat.completions.create({ model: "gpt-4o", messages });
```
</details>

<details>
<summary><strong>OpenAI Responses</strong></summary>

```tsx
import OpenAI from "openai";
import { responses } from "@fastpaca/cria/openai";
import { render } from "@fastpaca/cria";

const client = new OpenAI();
const input = await render(prompt, { budget, renderer: responses });
const response = await client.responses.create({ model: "o3", input });
```
</details>

<details>
<summary><strong>Anthropic</strong></summary>

```tsx
import Anthropic from "@anthropic-ai/sdk";
import { anthropic } from "@fastpaca/cria/anthropic";
import { render } from "@fastpaca/cria";

const client = new Anthropic();
const { system, messages } = await render(prompt, {
  budget,
  renderer: anthropic,
});
const response = await client.messages.create({ model: "claude-sonnet-4-20250514", system, messages });
```
</details>

<details>
<summary><strong>Vercel AI SDK</strong></summary>

```tsx
import { renderer } from "@fastpaca/cria/ai-sdk";
import { render } from "@fastpaca/cria";
import { generateText } from "ai";

const messages = await render(prompt, { budget, renderer });
const { text } = await generateText({ model, messages });
```
</details>

## Roadmap

**Done**

- [x] JSX runtime and priority-based eviction
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

## Support

- Open a GitHub issue for bugs or feature requests.
- For quick questions, include a minimal repro or snippet.

## FAQ

- **Does this replace my LLM SDK?** No - Cria builds prompt structures. You still use your SDK to call the model.
- **How do I tune token budgets?** Pass `budget` to `render()` and set priorities on regions. Providers include tiktoken defaults; see [docs/tokenization.md](docs/tokenization.md) to bring your own.
- **Is this production-ready?** The core features are stable; see the docs for what's in progress.

## License

MIT
