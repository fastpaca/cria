<h1 align="center">Cria</h1>

<p align="center">
  Cria is a tiny library for building LLM prompts as reusable components.
</p>

<p align="center">
  <i>Debug, view, and save your prompts easily. Swap out components without major rewrites and test your prompts.</i>
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

Most prompt construction is string concatenation. Append everything to some buffer, hope the important parts survive when you hit limits or want to save cost.

Cria lets you declare what's expendable and what is not, and makes your prompts failure mode explicit.

Cria treats memory layout as a first-class concern. You declare priorities upfront, and the library handles eviction when needed. Components let you test retrieval logic separately from system prompts, swap implementations without rewrites, and debug exactly which content got cut when quality degrades.

```tsx
const prompt = (
  <Region priority={0}>
    You are a helpful assistant.

    {/* Only preserve 80k tokens of history */}
    <Truncate budget={80000} priority={2}>
      {conversationHistory}
    </Truncate>

    {/* Only preserve 20k tokens of tool calls. It gets dropped
        first in case we need to. */}
    <Truncate budget={20000} priority={3}>
      {toolCalls}
    </Truncate>

    {/* Skip examples in case we are bad on budget */}
    <Omit priority={3}>{examples}</Omit>

    {userMessage}
  </Region>
);

render(prompt, { tokenizer, budget: 128000 });
```

Cria will drop lower priority sections or truncate them in case it hits your prompt limits.
## Features

- **Composable** — Build prompts from reusable components. Test and optimize each part independently.
- **Priority-based** — Declare what's sacred (priority 0) and what's expendable (priority 3). No more guessing what gets cut.
- **Flexible strategies** — Truncate content progressively, omit entire sections, or write custom eviction logic.
- **Tiny** — Zero dependencies.

## Getting Started

```bash
npm install @fastpaca/cria
```

Add to your `tsconfig.json`:

```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "@fastpaca/cria"
  }
}
```

## Documentation

### Components

**`<Region>`** — The basic building block. Groups content with a priority level.

```jsx
<Region>
  <Region priority={0}>System instructions</Region>
  <Region priority={2}>Retrieved context</Region>
</Region>
```

**`<Truncate>`** — Progressively shortens content when over budget.

```jsx
<Truncate budget={10000} from="start" priority={2}>
  {longConversation}
</Truncate>
```

**`<Omit>`** — Drops entirely when space is needed.

```jsx
<Omit priority={3}>{optionalExamples}</Omit>
```

### Priority Levels

Lower number = higher importance.

| Priority | Use for |
|----------|---------|
| 0 | System prompt, safety rules |
| 1 | Current user message, tool outputs |
| 2 | Conversation history, retrieved docs |
| 3 | Examples, optional context |

### Tokenizer

Pass any function that counts tokens:

```tsx
import { encoding_for_model } from "tiktoken";

const enc = encoding_for_model("gpt-4");
const tokenizer = (text: string) => enc.encode(text).length;

render(prompt, { tokenizer, budget: 128000 });
```

### Custom Strategies

Write your own eviction logic:

```tsx
import type { Strategy } from "@fastpaca/cria";

const summarize: Strategy = ({ target, tokenizer }) => {
  const summary = createSummary(target.content);
  return [{ ...target, content: summary, tokens: tokenizer(summary) }];
};

<Region priority={2} strategy={summarize}>{document}</Region>
```

### Error Handling

```tsx
import { FitError } from "@fastpaca/cria";

try {
  render(prompt, { tokenizer, budget: 1000 });
} catch (e) {
  if (e instanceof FitError) {
    console.log(`Over budget by ${e.overBudgetBy} tokens`);
  }
}
```

## Roadmap

- [x] JSX
- [x] Priority-based eviction (lower number = higher importance)
- [x] Components 
   - [x] Region
   - [x] Truncate
   - [x] Omit
- [x] Custom strategy support (pure, deterministic, idempotent)
- [x] Basic error handling

**Ergonomics & Adapters**

- [ ] Pluggable renderers
  - [ ] OpenAI
  - [ ] Anthropic
  - [ ] AI SDK
- [ ] Integrations
  - [ ] Message storage
  - [ ] Vector storage / search index
- [ ] Components
  - [ ] Summary
  - [ ] Messages
  - [ ] RAG/Vector-search
  - [ ] Tools / Tool Calls 
  - [ ] Reasoning
  - [ ] Examples
  - [ ] Code
  - [ ] Seperators
- [ ] Tokenizer helpers
- [ ] Next.js adapter (`cria/nextjs`)

**Observability**

- [ ] Debug mode: trace callback + summary of dropped/truncated/kept
- [ ] Visual debug UI / demo UI
- [ ] Traces
  - [ ] diff viewer
  - [ ] exportable JSON
- [ ] Snapshots/checkpointing
- [ ] Rendering caches based on identifiers

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT © [Fastpaca](https://fastpaca.com)
