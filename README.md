<h1 align="center">Cria</h1>

<p align="center">
  <i>Your prompts deserve the same structure as your code.</i>
</p>

<p align="center">
  <b><i>Cria turns prompts into composable components with explicit roles and strategies, and works with your existing environment & frameworks.</i></b>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@fastpaca/cria"><img src="https://img.shields.io/npm/v/@fastpaca/cria?logo=npm&logoColor=white" alt="npm"></a>
  <a href="https://opensource.org/license/mit"><img src="https://img.shields.io/badge/license-MIT-blue" alt="License"></a>
</p>

<p align="center">
  <a href="https://github.com/fastpaca/cria/stargazers">
    <img src="https://img.shields.io/badge/Give%20a%20Star-Support%20the%20project-orange?style=for-the-badge" alt="Give a Star">
  </a>
</p>

Cria is a lightweight JSX prompt composition library for structured prompt engineering. Build prompts as components, keep behavior predictable, and reuse the same structure across providers. Runs on Node, Deno, Bun, and Edge; adapters require their SDKs.

## Cria as an example

```tsx
import { Last, Message, Omit, Region, render } from "@fastpaca/cria";

const tokenizer = (text: string): number => Math.ceil(text.length / 4);
const historyMessages = conversationHistory.map((message) => (
  <Message messageRole={message.role}>{message.content}</Message>
));

const prompt = (
  <Region priority={0}>
    <Message messageRole="system">You are a helpful assistant.</Message>
    <Last N={12} priority={2}>{historyMessages}</Last>
    <Omit priority={3}>{optionalExamples}</Omit>
    <Message messageRole="user">{userQuestion}</Message>
  </Region>
);

const output = await render(prompt, { tokenizer, budget: 8_000 });
```

Docs: [docs/README.md](docs/README.md)

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
const messages = await render(prompt, { tokenizer, budget, renderer: chatCompletions });
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
const input = await render(prompt, { tokenizer, budget, renderer: responses });
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
  tokenizer,
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

const messages = await render(prompt, { tokenizer, budget, renderer });
const { text } = await generateText({ model, messages });
```
</details>

### Render Hooks

Cria provides lifecycle hooks to observe the fitting process without affecting render behavior. Hooks are **best-effort and non-blocking**: they never delay rendering and errors are silently swallowed.

```tsx
import type { RenderHooks } from "@fastpaca/cria";

const hooks: RenderHooks = {
  onFitStart: (event) => {
    console.log(`Starting fit: ${event.totalTokens} tokens`);
  },
  onFitIteration: (event) => {
    console.log(`Iteration ${event.iteration}: priority ${event.priority}`);
  },
  onStrategyApplied: (event) => {
    console.log(`Applied strategy to ${event.target.type}`);
  },
  onFitComplete: (event) => {
    console.log(`Fit complete in ${event.iterations} iterations`);
  },
  onFitError: (event) => {
    console.log(`Fit failed: ${event.error.message}`);
  },
};

render(prompt, { tokenizer, budget: 128000, hooks });
```

**Available Hooks:**

| Hook | Fires When | Event Properties |
|------|-----------|------------------|
| `onFitStart` | Fitting begins | `element`, `budget`, `totalTokens` |
| `onFitIteration` | Each fit iteration | `iteration`, `priority`, `totalTokens` |
| `onStrategyApplied` | Strategy executes | `target`, `result`, `priority`, `iteration` |
| `onFitComplete` | Fitting succeeds | `result`, `iterations`, `totalTokens` |
| `onFitError` | Before throwing FitError | `error`, `iteration`, `priority`, `totalTokens` |

**Hook Behavior:**

- **Non-blocking**: Hooks are fire-and-forget and never await results
- **Error-safe**: All errors (sync and async) are silently caught and swallowed
- **No side effects on render**: Hooks cannot affect the rendered output
- **Async-compatible**: Hooks can be sync or async, but are never awaited

Use hooks for observability (logging, metrics, debugging) but never for critical logic that affects rendering.

### Validation

Cria ships runtime schemas for prompt IR validation:

```tsx
import { PromptChildrenSchema, PromptElementSchema } from "@fastpaca/cria";

PromptElementSchema.parse(element);
PromptChildrenSchema.parse(element.children);
```

If you used legacy `ir-validate` helpers, replace them with
`PromptElementSchema.safeParse(...)` or `.parse(...)`.

Note: legacy `ir-serialize` helpers were removed; IR snapshot utilities are
still pending (see Roadmap).

## Roadmap

- [x] JSX
- [x] Priority-based eviction (lower number = higher importance)
- [x] Components
  - [x] Region
  - [x] Truncate
  - [x] Omit
  - [x] Last
  - [x] Message
- [x] Custom strategy support (pure, deterministic, idempotent)
- [x] Basic error handling

**Ergonomics & Adapters**

- [x] Pluggable renderers
  - [x] OpenAI
  - [x] Anthropic
  - [x] AI SDK
- [ ] Integrations
  - [ ] Message storage
  - [x] Vector storage / search index (Chroma, Qdrant)
- [ ] Components
  - [x] Summary
  - [x] Messages
  - [x] RAG/Vector-search
  - [x] Tools / Tool Calls / Tool Result
  - [x] Reasoning
  - [ ] Examples
  - [ ] Code
  - [ ] Separators
- [ ] Tokenizer helpers
- [ ] Next.js adapter (`@fastpaca/cria/nextjs`)

**Observability**

- [ ] Foundation
  - [x] Async render hooks (onFitStart/onFitIteration/onFitComplete/onStrategyApplied/onFitError)
  - [x] Runtime schemas for prompt IR validation
  - [ ] IR snapshot utilities (before/after fitting) for diffing
- [ ] OpenTelemetry instrumentation (`@fastpaca/cria/instrumentation`)
  - [ ] Span hierarchy matching prompt tree
  - [ ] Per-node decision metadata (kept/truncated/omitted)
  - [ ] GenAI semantic convention compatibility
- [ ] Snapshots/checkpointing
- [ ] Visualization tool (separate package, future)
  - [ ] Tree view with expand/collapse

## Deep dive

- Docs index: [docs/README.md](docs/README.md)
- Concepts: [docs/concepts.md](docs/concepts.md)
- Strategies: [docs/strategies.md](docs/strategies.md)
- Custom components: [docs/custom-components.md](docs/custom-components.md)
- Quickstart: [docs/quickstart.md](docs/quickstart.md)
- Prompt structure: [docs/prompt-structure.md](docs/prompt-structure.md)
- Components: [docs/components.md](docs/components.md)
- Integrations: [docs/integrations.md](docs/integrations.md)
- Memory and RAG: [docs/memory-and-rag.md](docs/memory-and-rag.md)
- Recipes: [docs/recipes.md](docs/recipes.md)
- Examples: [examples/](examples/)

## Contributing

- Issues and PRs are welcome.
- Keep changes small and focused.
- If you add a feature, include a short example or doc note.

## Support

- Open a GitHub issue for bugs or feature requests.
- For quick questions, include a minimal repro or snippet.

## FAQ

- **Does this replace my LLM SDK?** No - Cria builds prompt structures. You still use your SDK to call the model.
- **How do I tune token budgets?** Pass a `budget` plus a tokenizer to `render()` and adjust priorities on regions.
- **Is this production-ready?** The core features are stable; see the docs for what's in progress.

## License

MIT
