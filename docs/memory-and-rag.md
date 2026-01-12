# Memory and RAG

Cria provides memory interfaces and adapters for summaries and retrieval.

## Key-value memory

`KVMemory` stores structured entries for components like `Summary`.

```ts
import { cria, InMemoryStore, type StoredSummary } from "@fastpaca/cria";

const store = new InMemoryStore<StoredSummary>();

const prompt = await cria
  .prompt()
  .summary(conversationHistory, { id: "history", store, priority: 2 })
  .render({ tokenizer, budget: 8000 });
```

Adapters (subpath imports):

```ts
import { RedisStore } from "@fastpaca/cria/memory/redis";
import { PostgresStore } from "@fastpaca/cria/memory/postgres";
```

## Vector memory and RAG

`VectorMemory` extends `KVMemory` with semantic search. Cria ships adapters for Chroma and Qdrant.

```ts
import { ChromaClient } from "chromadb";
import { ChromaStore } from "@fastpaca/cria/memory/chroma";
import { cria } from "@fastpaca/cria";

const chroma = new ChromaClient({ path: "http://localhost:8000" });
const collection = await chroma.getOrCreateCollection({ name: "docs" });

const store = new ChromaStore({ collection, embed: async (text) => embed(text) });

const prompt = await cria
  .prompt()
  .vectorSearch({ store, query, limit: 5, threshold: 0.2 })
  .render({ tokenizer, budget: 8000 });
```

Notes:
- `VectorSearch` resolves queries at render time.
- If no results are found, the default formatter throws. Provide `formatResults` to handle empty results.

## Related

- [RAG example](../examples/rag)
