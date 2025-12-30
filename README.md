<p align="center">
  <img src="https://raw.githubusercontent.com/fastpaca/cria/main/docs/logo.svg" alt="Cria" width="200">
</p>

<h1 align="center">Cria</h1>

<p align="center">
  Composable prompt components for LLMs
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/cria"><img src="https://img.shields.io/npm/v/cria?logo=npm&logoColor=white" alt="npm"></a>
  <a href="https://opensource.org/license/mit"><img src="https://img.shields.io/badge/license-MIT-blue" alt="License"></a>
  <a href="https://github.com/fastpaca/cria"><img src="https://img.shields.io/github/stars/fastpaca/cria?style=social" alt="GitHub stars"></a>
</p>

<p align="center">
  <a href="https://fastpaca.com/blog/failure-case-memory-layout/">Blog Post</a> ·
  <a href="#getting-started">Getting Started</a> ·
  <a href="#documentation">Documentation</a>
</p>

---

Cria is a tiny library for building LLM prompts as component trees. Each region declares a priority—when your prompt exceeds the token budget, Cria trims low-priority content first.

```tsx
const prompt = (
  <Region priority={0}>
    You are a helpful assistant.
    <Truncate budget={20000} from="start" priority={2}>
      {conversationHistory}
    </Truncate>
    <Omit priority={3}>{examples}</Omit>
    <Region priority={1}>{userMessage}</Region>
  </Region>
);

render(prompt, { tokenizer, budget: 128000 });
```

## Features

- **Composable** — Build prompts from reusable components. Test and optimize each part independently.
- **Priority-based** — Declare what's sacred (priority 0) and what's expendable (priority 3). No more guessing what gets cut.
- **Flexible strategies** — Truncate content progressively, omit entire sections, or write custom eviction logic.
- **Bring your own tokenizer** — Works with tiktoken, gpt-tokenizer, or any counting function.
- **Tiny** — Zero dependencies. ~2kb minified.

## Getting Started

```bash
npm install cria
```

Add to your `tsconfig.json`:

```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "cria"
  }
}
```

## Documentation

### Components

**`<Region>`** — The basic building block. Groups content with a priority level.

```tsx
<Region priority={0}>System instructions</Region>
<Region priority={2}>Retrieved context</Region>
```

**`<Truncate>`** — Progressively shortens content when over budget.

```tsx
<Truncate budget={10000} from="start" priority={2}>
  {longConversation}
</Truncate>
```

**`<Omit>`** — Drops entirely when space is needed.

```tsx
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
import type { Strategy } from "cria";

const summarize: Strategy = ({ target, tokenizer }) => {
  const summary = createSummary(target.content);
  return [{ ...target, content: summary, tokens: tokenizer(summary) }];
};

<Region priority={2} strategy={summarize}>{document}</Region>
```

### Error Handling

```tsx
import { FitError } from "cria";

try {
  render(prompt, { tokenizer, budget: 1000 });
} catch (e) {
  if (e instanceof FitError) {
    console.log(`Over budget by ${e.overBudgetBy} tokens`);
  }
}
```

## Why Cria?

Most prompt construction is string concatenation—append everything to a buffer and hope the important parts survive context limits.

Cria treats memory layout as a first-class concern. You declare priorities upfront, and the library handles eviction when needed. Components let you test retrieval logic separately from system prompts, swap implementations without rewrites, and debug exactly which content got cut when quality degrades.

Read more: [Failure-First Memory Layout](https://fastpaca.com/blog/failure-case-memory-layout/)

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT © [Fastpaca](https://fastpaca.com)
