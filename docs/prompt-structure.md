# Prompt structure

Cria prompts are trees. Each node can carry a priority and an optional strategy. When the prompt is over budget, Cria applies strategies at the lowest priority
until it fits.

## A minimal shape

```tsx
<Region priority={0}>
  <Message messageRole="system">System rules</Message>
  <Message messageRole="user">Current request</Message>
  <Truncate budget={8000} priority={2}>{history}</Truncate>
  <Omit priority={3}>{examples}</Omit>
</Region>
```

## Recommended layout

Keep the highest-priority content at the top and put reducible sections behind
clear boundaries.

```
[P0] System rules
[P1] Current user request
[P2] History / retrieval
[P3] Examples / optional context
```

This layout makes it obvious what can shrink first and keeps critical instructions
stable.

## Role-based templates

### Chat-first (balanced)

```tsx
<Region priority={0}>
  <Message messageRole="system">System rules</Message>
  <Message messageRole="user">Current request</Message>
  <Truncate budget={8000} priority={2}>{history}</Truncate>
  <Omit priority={3}>{examples}</Omit>
</Region>
```

### Tool-heavy (function calls)

```tsx
<Region priority={0}>
  <Message messageRole="system">Tool policy + safety</Message>
  <Message messageRole="user">Task</Message>
  <Truncate budget={6000} priority={2}>{toolHistory}</Truncate>
  <Omit priority={3}>{debugNotes}</Omit>
</Region>
```

### RAG-focused

```tsx
<Region priority={0}>
  <Message messageRole="system">Grounding rules</Message>
  <Message messageRole="user">Question</Message>
  <VectorSearch store={vectorStore} limit={5} priority={2}>
    {query}
  </VectorSearch>
  <Truncate budget={6000} priority={2}>{history}</Truncate>
</Region>
```

## Priorities

Lower number means higher importance.

| Priority | Use for |
| --- | --- |
| 0 | System rules, safety requirements |
| 1 | Current request, tool results |
| 2 | History, retrieved context |
| 3 | Examples, optional context |

## Strategies

Strategies are how a node shrinks:

- `Truncate` trims to a token budget.
- `Omit` removes content entirely.
- `Summary` replaces content with a summary.
- `VectorSearch` inserts retrieval results at render time.
- Custom strategy: pass a `strategy` function to any region.

## Budgeting patterns

- Keep system and current user messages at priority 0-1.
- Put history and RAG context at priority 2.
- Put examples or optional content at priority 3.
- Use `Truncate` for long histories and `Summary` for long running sessions.

## Fit errors

If the prompt cannot be reduced further, `render()` throws `FitError`.
Handle it and report the budget gap or adjust priorities.

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

## Async components

Cria supports async components. `VectorSearch` is async and resolves at render time.
