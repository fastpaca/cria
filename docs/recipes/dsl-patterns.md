# DSL Recipes: Common Patterns

Quick builder patterns for common prompt layouts.

## System → Context → Ask

```ts
import { cria } from "@fastpaca/cria";

export function systemContextAsk({
  system,
  context,
  question,
}: {
  system: string;
  context: string;
  question: string;
}) {
  return cria
    .prompt()
    .system(system)
    .region((r) => r.message("assistant", context, { priority: 2 }))
    .user(question);
}
```

## RAG with budget fitting

```ts
import { cria } from "@fastpaca/cria";
import type { VectorMemory } from "@fastpaca/cria";

export function ragPrompt({
  store,
  query,
  history,
}: {
  store: VectorMemory<string>;
  query: string;
  history: string[];
}) {
  return cria
    .prompt()
    .system(
      [
        "You are a helpful assistant.",
        "Answer using the retrieved context. If missing, say you don't know.",
      ].join(" ")
    )
    .vectorSearch({ store, query, limit: 5, priority: 2 })
    .truncate(history.join("\n"), { budget: 4000, priority: 2 })
    .user(query);
}
```

## Budgeted chat history with summary + last

```ts
import { cria, InMemoryStore, type StoredSummary } from "@fastpaca/cria";

const summaryStore = new InMemoryStore<StoredSummary>();

export function chatWithSummary({
  history,
  question,
}: {
  history: { role: "user" | "assistant"; content: string }[];
  question: string;
}) {
  const historyBuilder = history.reduce(
    (acc, msg, i) =>
      acc.merge(
        cria.prompt().message(msg.role, msg.content, {
          priority: 2,
          id: `history-${i}`,
        })
      ),
    cria.prompt()
  );

  return cria
    .prompt()
    .summary(historyBuilder, { id: "history", store: summaryStore, priority: 2 })
    .last(
      history.reduce(
        (acc, msg, i) =>
          acc.merge(
            cria.prompt().message(msg.role, msg.content, {
              priority: 1,
              id: `recent-${i}`,
            })
          ),
        cria.prompt()
      ),
      { N: 6, priority: 1 }
    )
    .user(question);
}
```

## Tool call scaffolding

```ts
import { cria, ToolCall, ToolResult } from "@fastpaca/cria";

export function toolCallPrompt({
  system,
  toolName,
  input,
  output,
  question,
}: {
  system: string;
  toolName: string;
  input: unknown;
  output?: unknown;
  question: string;
}) {
  const toolCall = ToolCall({
    toolCallId: "call_1",
    toolName,
    input,
    priority: 1,
  });

  const toolResult =
    output === undefined
      ? null
      : ToolResult({
          toolCallId: "call_1",
          toolName,
          output,
          priority: 1,
        });

  return cria
    .prompt()
    .system(system)
    .user(question)
    .raw(toolCall)
    .raw(toolResult ?? []);
}
```

Use these snippets as starting points; chain `.render({ tokenizer, budget, renderer })` where you need output.
