# Observability (debugging compaction)

When you’re fitting prompts to budgets, you want to see what changed and why. Cria provides render hooks, validation schemas, snapshots, and OpenTelemetry helpers.

## Render hooks

```ts
import { cria, type RenderHooks } from "@fastpaca/cria";

const hooks: RenderHooks = {
  onFitStart: (event) => console.log("fit start", event.totalTokens),
  onFitIteration: (event) => console.log("iteration", event.iteration, event.priority),
  onStrategyApplied: (event) => console.log("applied", event.target.kind ?? "region"),
  onFitComplete: (event) => console.log("fit complete", event.totalTokens),
  onFitError: (event) => console.log("fit error", event.error.overBudgetBy),
};

await cria.prompt().user(userQuestion).render({ budget: 8000, tokenizer, hooks });
```

## Snapshots

Snapshots let you diff fitted prompts (useful for regression tests and debugging).

```ts
import { createSnapshot, diffSnapshots } from "@fastpaca/cria";

const before = createSnapshot(beforeElement, { tokenizer });
const after = createSnapshot(afterElement, { tokenizer });
const diff = diffSnapshots(before, after);
```

## OpenTelemetry

```ts
import { createOtelRenderHooks } from "@fastpaca/cria";
import { trace } from "@opentelemetry/api";

const tracer = trace.getTracer("my-app");
const hooks = createOtelRenderHooks({ tracer });
```
