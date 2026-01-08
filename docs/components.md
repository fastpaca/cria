# Components

Cria ships a small set of composable components. All are available from `@fastpaca/cria` unless noted.

## Core building blocks

- `Region`: groups children and sets priority for that subtree.
- `Message`: semantic message with `messageRole` (system, user, assistant, tool).
- `Truncate`: trims content to a token budget.
- `Omit`: drops content entirely when shrinking.
- `Last`: keeps only the last N children.

```tsx
<Region priority={0}>
  <Message messageRole="system">System rules</Message>
  <Truncate budget={8000} priority={2}>{history}</Truncate>
  <Omit priority={3}>{examples}</Omit>
</Region>
```

Anything without a priority won't get truncated or managed in case you hit your budget, it will remain by default.

## Semantic components

- `ToolCall`: represents a tool invocation.
- `ToolResult`: represents tool output.
- `Reasoning`: stores reasoning text (mapped to supported outputs).

These map cleanly to OpenAI and Anthropic tool formats via renderers.

## Smart components

### Summary

Summarizes content when it is selected for reduction. Requires a store.

```tsx
import { InMemoryStore, Summary, type StoredSummary } from "@fastpaca/cria";

const store = new InMemoryStore<StoredSummary>();

<Summary id="history" store={store} priority={2}>
  {conversationHistory}
</Summary>
```

If you do not pass `summarize`, the nearest provider (`OpenAIProvider`, `AnthropicProvider`, or `AISDKProvider`) is used with a default prompt.

### VectorSearch

Injects vector search results at render time.

```tsx
<VectorSearch store={vectorStore} limit={5}>
  {query}
</VectorSearch>
```

Query sources, in order:
1. Children text
2. `query` prop
3. `messages` prop (defaults to last user message)

If no results are found, the default formatter throws. Provide a custom `formatResults` to handle empty results.
