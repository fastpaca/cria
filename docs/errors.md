# Errors

## FitError

When budget fitting is enabled and the prompt cannot be reduced further, `render()` throws `FitError`.

```tsx
import { FitError } from "@fastpaca/cria";

try {
  await render(prompt, { tokenizer, budget: 2000 });
} catch (error) {
  if (error instanceof FitError) {
    console.error(`Over budget by ${error.overBudgetBy} tokens`);
  }
}
```

Handle this by reporting the gap to the user or adjusting priorities.
