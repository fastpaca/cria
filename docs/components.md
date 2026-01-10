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

Content without a priority is never trimmed. It stays in the prompt no matter what.

## Semantic components

- `ToolCall`: represents a tool invocation.
- `ToolResult`: represents tool output.
- `Reasoning`: stores reasoning text for models that support it (like OpenAI's o-series).

These map cleanly to OpenAI and Anthropic tool formats via renderers.

## Smart components

### Summary

Summarizes its children when the prompt needs to shrink. Requires a store to cache summaries.

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

## Utility components

### Separator

Inserts a separator between children.

```tsx
<Separator value="\n\n">
  {paragraphs}
</Separator>
```

### Examples

Wraps example content with an optional title and separators between items.

```tsx
<Examples title="Examples:" separator="\n\n" priority={2}>
  {exampleList}
</Examples>
```

### CodeBlock

Wraps code in a fenced code block.

```tsx
<CodeBlock code={sourceCode} language="typescript" />
```
