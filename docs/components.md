# Components

Cria ships a small set of composable building blocks. The DSL is the primary surface (`cria.prompt()`), with an optional JSX entry at `@fastpaca/cria/jsx` if you prefer TSX.

## Structure

- `region()`: groups children into a logical block.
- `system/user/assistant/message()`: semantic messages with `role` (system, user, assistant, tool).

```ts
import { cria } from "@fastpaca/cria";

const prompt = cria
  .prompt()
  .system("System rules")
  .user("Current request");
```

These are your building blocks. Regions group related content; Messages carry semantic roles that renderers convert to provider formats.

## Budget fitting (optional)

When you need to fit prompts to token limits, add priorities and strategies:

- `truncate()`: trims content to a token budget.
- `omit()`: drops content entirely when shrinking.
- `last()`: keeps only the last N children.

```ts
import { cria } from "@fastpaca/cria";

const prompt = cria
  .prompt()
  .system("System rules")
  .truncate(history, { budget: 8000, priority: 2 })
  .omit(examples, { priority: 3 });
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

```ts
import { cria, InMemoryStore, type StoredSummary } from "@fastpaca/cria";

const store = new InMemoryStore<StoredSummary>();

const prompt = cria
  .prompt()
  .summary(conversationHistory, { id: "history", store, priority: 2 });
```

If you do not pass `summarize`, the nearest provider (`OpenAIProvider`, `AnthropicProvider`, or `AISDKProvider`) is used with a default prompt.

### VectorSearch

Injects vector search results at render time.

```ts
import { cria } from "@fastpaca/cria";

const prompt = cria
  .prompt()
  .vectorSearch({ store: vectorStore, query, limit: 5, threshold: 0.2 });
```

Query sources, in order:
1. Children text
2. `query` prop
3. `messages` prop (defaults to last user message)

If no results are found, the default formatter throws. Provide a custom `formatResults` to handle empty results.

## Utility components

### Separator

Inserts a separator between children.

```ts
import { cria } from "@fastpaca/cria";

const prompt = cria
  .prompt()
  .separator("\n\n")
  .raw(paragraphs);
```

### Examples

Wraps example content with an optional title and separators between items.

```ts
import { cria } from "@fastpaca/cria";

const prompt = cria
  .prompt()
  .examples("Examples:", exampleList, { separator: "\n\n", priority: 2 });
```

### CodeBlock

Wraps code in a fenced code block.

```ts
import { cria } from "@fastpaca/cria";

const prompt = cria.prompt().codeBlock(sourceCode, { language: "typescript" });
```
