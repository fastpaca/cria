# Observability (debugging compaction)

When you're fitting prompts to budgets, you want to see what changed and why. Cria provides render hooks and OpenTelemetry helpers.

## Render hooks

```ts
import OpenAI from "openai";
import { cria, type RenderHooks } from "@fastpaca/cria";
import { createProvider } from "@fastpaca/cria/openai";

const hooks: RenderHooks = {
  onFitStart: (event) => console.log("fit start", event.totalTokens),
  onFitIteration: (event) => console.log("iteration", event.iteration, event.priority),
  onStrategyApplied: (event) => console.log("applied", event.target.kind ?? "region"),
  onFitComplete: (event) => console.log("fit complete", event.totalTokens),
  onFitError: (event) => console.log("fit error", event.error.overBudgetBy),
};

const provider = createProvider(new OpenAI(), "gpt-4o-mini");
await cria.prompt().user(userQuestion).render({ budget: 8000, provider, hooks });
```

## OpenTelemetry

```ts
import { createOtelRenderHooks } from "@fastpaca/cria";
import { trace } from "@opentelemetry/api";

const tracer = trace.getTracer("my-app");
const hooks = createOtelRenderHooks({ tracer });
```
