# Errors

## FitError

When budget fitting is enabled and the prompt cannot be reduced further, `render()` throws `FitError`.

```ts
import { FitError, cria } from "@fastpaca/cria";

try {
  await cria.prompt().user("hello").render({ tokenizer, budget: 2000 });
} catch (error) {
  if (error instanceof FitError) {
    console.error(`Over budget by ${error.overBudgetBy} tokens`);
  }
}
```

Handle this by reporting the gap to the user or adjusting priorities.
