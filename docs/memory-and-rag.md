# Memory and RAG

Cria provides memory interfaces and adapters for summaries and retrieval.

## Key-value memory

`KVMemory` stores structured entries for components like `Summary`.

```tsx
import { InMemoryStore, Summary, type StoredSummary } from "@fastpaca/cria";

const store = new InMemoryStore<StoredSummary>();

<Summary id="history" store={store} priority={2}>
  {conversationHistory}
</Summary>
```

Adapters (subpath imports):

```tsx
import { RedisStore } from "@fastpaca/cria/memory/redis";
import { PostgresStore } from "@fastpaca/cria/memory/postgres";
```

## Vector memory and RAG

`VectorMemory` extends `KVMemory` with semantic search. Cria ships adapters for Chroma and Qdrant.

```tsx
import { ChromaClient } from "chromadb";
import { ChromaStore } from "@fastpaca/cria/memory/chroma";
import { VectorSearch } from "@fastpaca/cria";

const chroma = new ChromaClient({ path: "http://localhost:8000" });
const collection = await chroma.getOrCreateCollection({ name: "docs" });

const store = new ChromaStore({ collection, embed: async (text) => embed(text) });

const prompt = (
  <VectorSearch store={store} limit={5} threshold={0.2}>
    {query}
  </VectorSearch>
);
```

Notes:
- `VectorSearch` resolves queries at render time.
- If no results are found, the default formatter throws. Provide `formatResults` to handle empty results.

## Related

- [RAG example](../examples/rag)
