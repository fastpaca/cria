# Fit & compaction (budgets)

Use budgets when you want a composed prompt to be predictable under pressure (long chat history, retrieval bursts, tool traces). Cria shrinks lower-priority content first until the prompt fits.

## The two things you need

1. A `budget` passed to `render()`
2. A provider (it owns token counting via tiktoken)

```ts
import OpenAI from "openai";
import { cria } from "@fastpaca/cria";
import { createProvider } from "@fastpaca/cria/openai";

const provider = createProvider(new OpenAI(), "gpt-4o-mini");

const output = await cria
  .prompt()
  .system("You are a helpful assistant.")
  .truncate(history, { budget: 4000, priority: 2 })
  .omit(optionalExamples, { priority: 3 })
  .user(question)
  .render({ budget: 8000, provider });
```

## Where token counts come from

Token counting is provider-owned. Providers use tiktoken internally and map the rendered output into the strings that should be counted.

If you set a budget but don’t provide a provider, `render()` throws.

## Priorities: what stays vs what shrinks

Lower number = more important.

| Priority | Typical content |
| --- | --- |
| 0 | System rules, non-negotiable constraints |
| 1 | Current user request, recent turns, tool results you must keep |
| 2 | Older history, retrieved context |
| 3+ | Examples, “nice to have” background, verbose traces |

Priorities only matter for content that can actually shrink. If a node has no shrinking strategy, it can’t be reduced (and may lead to `FitError` if everything left is non-shrinkable).

These DSL methods create shrinkable regions:

- `truncate(...)`
- `omit(...)`
- `last(...)`
- `summary(...)`

Plain messages (`system/user/assistant/message`) are not shrinkable by default.

## Compaction patterns that tend to work

### Cap chat history

- `last(...)` for “keep last N turns”
- `truncate(...)` for “cap to N tokens”
- `summary(...)` for “replace older content with a cached summary”

### Drop optional context

Use `omit(...)` for anything you *want* to include, but can live without.

## Tool messages and reasoning traces

Cria can represent tool I/O as semantic nodes (`ToolCall`, `ToolResult`), and optional reasoning (`Reasoning`). Tool calls live in assistant messages, tool results live in tool messages. These are often some of the biggest token sources, so they’re good compaction candidates:

- Keep `ToolResult`, omit `ToolCall` (or the reverse) by assigning priorities.
- Summarize a long tool trace into a short ledger and keep only that.
- Drop reasoning early by giving it a low importance (higher priority number).

### Minimal pattern (DSL + `.raw()`)

```ts
import { cria, Reasoning, ToolCall, ToolResult } from "@fastpaca/cria";

const prompt = cria
  .prompt()
  .system("You are helpful.")
  .user("What's the weather in Oslo?")
  .assistant((m) =>
    m.raw(
      ToolCall({
        toolCallId: "call_1",
        toolName: "weather",
        input: { city: "Oslo" },
        priority: 3,
      })
    )
  )
  .tool(
    ToolResult({
      toolCallId: "call_1",
      toolName: "weather",
      output: { tempC: 6, conditions: "rain" },
      priority: 1,
    })
  )
  .assistant((m) => m.raw(Reasoning({ text: "...verbose trace...", priority: 4 })));
```

## Handling FitError

If the prompt cannot be reduced further, `render()` throws `FitError`. Treat that as a signal to either:

- Increase the budget
- Add/adjust strategies (truncate/omit/summary/last)
- Re-prioritize content so the right things can shrink first

```ts
import OpenAI from "openai";
import { FitError } from "@fastpaca/cria";
import { createProvider } from "@fastpaca/cria/openai";

const provider = createProvider(new OpenAI(), "gpt-4o-mini");

try {
  await cria.prompt().user(question).render({ budget: 8000, provider });
} catch (error) {
  if (error instanceof FitError) {
    console.error("over budget by", error.overBudgetBy);
  }
}
```

See [Observability](observability.md) for hooks that make fitting easier to debug.
