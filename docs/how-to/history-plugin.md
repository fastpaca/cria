# Use history plugin

Use the history plugin when you want to insert prior turns into a prompt with `.use(...)`.

## Minimal pattern

```ts
import { cria } from "@fastpaca/cria";

const conversation = cria.history({ history: storedHistory });

const prompt = cria
  .prompt(provider)
  .system("You are a helpful assistant.")
  .use(conversation)
  .user(question);
```

`history` can be:

- a `PromptLayout` array
- a prompt builder (`cria.prompt()...`)
- prompt nodes/scopes

## Pair with compaction

The history plugin only inserts content. Apply compaction in the builder where you compose the final prompt.

```ts
const conversation = cria.history({ history: storedHistory });

const prompt = cria
  .prompt(provider)
  .truncate(cria.prompt().use(conversation), { budget: 4000, priority: 2 })
  .user(question);
```

## Pair with summarizer

```ts
const conversation = cria.history({ history: storedHistory });
const summary = summarizer.plugin({ history: storedHistory });

const prompt = cria
  .prompt(provider)
  .use(summary)
  .use(conversation)
  .user(question);
```
