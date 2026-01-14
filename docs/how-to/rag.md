# RAG with VectorSearch

`VectorSearch` injects retrieval results at render time. You bring your own vector store (or use one of the adapters).

Runnable example: [rag](../../examples/rag)

```bash
cd examples/rag
pnpm install
pnpm start
```

This example requires a running vector DB (Chroma) and an embedding provider key. See `../../examples/rag/README.md`.

## Chroma adapter (example)

```ts
import { ChromaClient } from "chromadb";
import { ChromaStore } from "@fastpaca/cria/memory/chroma";
import { cria } from "@fastpaca/cria";

const chroma = new ChromaClient({ path: "http://localhost:8000" });
const collection = await chroma.getOrCreateCollection({ name: "docs" });

const store = new ChromaStore<string>({
  collection,
  embed: async (text) => embed(text), // supply your embedding function
});

const prompt = cria
  .prompt()
  .system("Answer using the retrieved context. If missing, say you don't know.")
  .vectorSearch({ store, query: userQuestion, limit: 5, priority: 2 })
  .user(userQuestion);
```

## Notes

- `VectorSearch` resolves its query at render time (children text, explicit `query`, or last user message depending on options).
- If no results are found, the default formatter throws. Provide a custom `formatResults` if you want empty results to be allowed.
