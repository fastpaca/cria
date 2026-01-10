# Strategies

Strategies control how a region shrinks when the prompt exceeds a token budget. You only need strategies if you use budget fitting.

## When strategies run

During `render()`, Cria computes total tokens and applies strategies starting with the highest priority numbers (least important content). A strategy can:
- Replace a node
- Rewrite its children
- Return `null` to remove it entirely

## Strategy API

```ts
import type { Strategy } from "@fastpaca/cria";

const myStrategy: Strategy = async ({
  target,
  tokenizer,
  tokenString,
  budget,
  totalTokens,
  iteration,
  context,
}) => {
  // return a new PromptElement, the same one, or null
  return target;
};
```

Key inputs:
- `target`: the node being reduced
- `tokenizer`: counts tokens in a string
- `tokenString`: converts the node to a string for token counting
- `budget`, `totalTokens`, `iteration`: current fit state
- `context`: provider context injected by ancestor providers

## Example: drop a region

```ts
import type { Strategy } from "@fastpaca/cria";

const drop: Strategy = () => null;
```

## Example: simple truncation

```ts
import type { Strategy } from "@fastpaca/cria";

const truncateToChars = (maxChars: number): Strategy => ({ target }) => {
  const content = target.children
    .map((child) => (typeof child === "string" ? child : ""))
    .join("");

  const trimmed = content.slice(0, maxChars);
  return { ...target, children: [trimmed] };
};
```

## Example: summarize with a model

```ts
import type { Strategy } from "@fastpaca/cria";

const summarize: Strategy = async ({ target, tokenizer }) => {
  const content = target.children
    .map((child) => (typeof child === "string" ? child : ""))
    .join("");

  const summary = await callModel(`Summarize: ${content}`);
  return { ...target, children: [summary], tokens: tokenizer(summary) };
};
```

## Best practices

- Keep strategies **deterministic** and **idempotent**.
- Always reduce tokens (or return `null`) to avoid infinite loops.
- Avoid heavy side effects; use context providers if you need model calls.
- Use `Summary` when possible; it already handles persistence and providers.
