# RAG with VectorDB

The VectorDB component injects retrieval results at render time. You bring your own vector store (or use one of the adapters).

Runnable example: [rag-qdrant](../../examples/rag-qdrant)

```bash
cd examples/rag-qdrant
pnpm install
pnpm start
```

This example requires a running vector DB (Qdrant) and an embedding provider key. See `../../examples/rag-qdrant/README.md`.

## Chroma adapter (example)

```ts
import { ChromaClient } from "chromadb";
import { cria } from "@fastpaca/cria";
import { ChromaStore } from "@fastpaca/cria/memory/chroma";

const chroma = new ChromaClient({ path: "http://localhost:8000" });
const collection = await chroma.getOrCreateCollection({ name: "docs" });

const store = new ChromaStore({
  collection,
  embed: async (text) => embed(text), // supply your embedding function
});

const vectors = cria.vectordb(store);
const retrieval = vectors.plugin({ query: userQuestion, limit: 5 });

const prompt = cria
  .prompt()
  .system("Answer using the retrieved context. If missing, say you don't know.")
  .use(retrieval)
  .user(userQuestion);
```

Tip: for per-user or per-session isolation, index with metadata and filter at retrieval:

```ts
await vectors.index({
  id: "doc-1",
  data: docText,
  metadata: { userId, sessionId },
});

const retrieval = vectors.plugin({
  query: userQuestion,
  limit: 5,
  filter: { userId, sessionId },
});
```

## SQLite adapter (libSQL)

```ts
import { z } from "zod";
import { cria } from "@fastpaca/cria";
import { SqliteVectorStore } from "@fastpaca/cria/memory/sqlite-vector";

const store = new SqliteVectorStore<string>({
  filename: "cria.sqlite",
  dimensions: 1536,
  embed: async (text) => embed(text), // supply your embedding function
  schema: z.string(),
});

const vectors = cria.vectordb(store);
const retrieval = vectors.plugin({ query: userQuestion, limit: 5 });

const prompt = cria
  .prompt()
  .system("Answer using the retrieved context. If missing, say you don't know.")
  .use(retrieval)
  .user(userQuestion);
```

## Notes

- The VectorDB component performs retrieval at render time using the provided query.
- If no results are found, the default formatter emits a placeholder message.
- `SqliteVectorStore` uses libSQL vector columns + indexes for DB-side similarity search.
- `SqliteVectorStore` requires the embedding dimensionality via `dimensions`.
- `SqliteVectorStore` validates stored data via the provided Zod `schema`.
