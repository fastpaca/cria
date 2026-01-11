# Recipes

Short patterns you can adapt to your app.

## Chat

```ts
import { cria } from "@fastpaca/cria";

const prompt = cria
  .prompt()
  .system("System rules")
  .region((r) => r.raw(history))
  .user("Current request");
```

## Tool use

```ts
import { cria } from "@fastpaca/cria";

const prompt = cria
  .prompt()
  .system("Tool policy")
  .user("Task")
  .message("assistant", "", {
    priority: 0,
  })
  .toolCall({ q: "weather" }, { toolCallId: "1", toolName: "search" })
  .toolResult({ temp: 72 }, { toolCallId: "1", toolName: "search" });
```

## RAG

```ts
import { cria } from "@fastpaca/cria";

const prompt = cria
  .prompt()
  .system("Answer based on the retrieved context.")
  .vectorSearch({ store: vectorStore, query, limit: 5 })
  .user(question);
```

## Reasoning replay for OpenAI Responses

```ts
import { cria } from "@fastpaca/cria";

const prompt = cria.prompt().reasoning(previousReasoning);
```

## Budget fitting

### History with token limit

```ts
import { cria } from "@fastpaca/cria";

const prompt = cria
  .prompt()
  .system("System rules")
  .truncate(history, { budget: 6000, priority: 2 })
  .omit(examples, { priority: 3 })
  .user(question);
```

### Progressive summarization

```ts
import { cria, InMemoryStore, type StoredSummary } from "@fastpaca/cria";

const store = new InMemoryStore<StoredSummary>();

const prompt = cria
  .prompt()
  .summary(conversationHistory, { id: "history", store, priority: 2 });
```

## Related

- [Summarization example](../examples/summary)
- [RAG example](../examples/rag)
