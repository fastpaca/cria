# Observability

Cria provides tools for debugging, monitoring, and validating prompts.

## Render Hooks

Lifecycle hooks observe the fitting process without affecting render behavior. Hooks are fire-and-forget: they never delay rendering and errors are silently swallowed.

```tsx
import type { RenderHooks } from "@fastpaca/cria";

const hooks: RenderHooks = {
  onFitStart: (event) => {
    console.log(`Starting fit: ${event.totalTokens} tokens`);
  },
  onFitIteration: (event) => {
    console.log(`Iteration ${event.iteration}: priority ${event.priority}`);
  },
  onStrategyApplied: (event) => {
    console.log(`Applied strategy to ${event.target.kind ?? "region"}`);
  },
  onFitComplete: (event) => {
    console.log(`Fit complete in ${event.iterations} iterations`);
  },
  onFitError: (event) => {
    console.log(`Fit failed: ${event.error.message}`);
  },
};

render(prompt, { tokenizer, budget: 128000, hooks });
```

| Hook | Fires When | Event Properties |
|------|-----------|------------------|
| `onFitStart` | Fitting begins | `element`, `budget`, `totalTokens` |
| `onFitIteration` | Each fit iteration | `iteration`, `priority`, `totalTokens` |
| `onStrategyApplied` | Strategy executes | `target`, `result`, `priority`, `iteration` |
| `onFitComplete` | Fitting succeeds | `result`, `iterations`, `totalTokens` |
| `onFitError` | Before throwing FitError | `error`, `iteration`, `priority`, `totalTokens` |

## Validation

Cria exports Zod schemas for runtime validation of prompt elements:

```tsx
import { PromptElementSchema, PromptChildrenSchema } from "@fastpaca/cria";

PromptElementSchema.parse(element);
PromptChildrenSchema.safeParse(children);
```

## Snapshots

Create deterministic snapshots of fitted prompts for diffing and debugging:

```tsx
import { createSnapshot, diffSnapshots, createSnapshotHooks } from "@fastpaca/cria";

// Manual snapshot
const snapshot = createSnapshot(fittedElement, { tokenizer });

// Compare snapshots
const diff = diffSnapshots(before, after);

// Automatic snapshots via hooks
const hooks = createSnapshotHooks({
  tokenizer,
  onSnapshot: (snapshot) => console.log(snapshot),
});
```

## OpenTelemetry

Emit spans for fit lifecycle events:

```tsx
import { createOtelRenderHooks } from "@fastpaca/cria";
import { trace } from "@opentelemetry/api";

const tracer = trace.getTracer("my-app");
const hooks = createOtelRenderHooks({ tracer });

render(prompt, { tokenizer, budget, hooks });
```

Spans include:
- `cria.fit` root span with budget and token counts
- `cria.fit.iteration` child spans for each fit iteration
- `cria.fit.strategy` child spans when strategies are applied
- Node attributes: kind, priority, id, role, tool info
