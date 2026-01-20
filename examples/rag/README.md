# RAG Example

Retrieval-Augmented Generation with Cria's fluent DSL.

## Setup

```bash
pnpm install
export OPENAI_API_KEY="sk-..."
pnpm start
```

## Usage

`.vectorSearch()` retrieves context at render time:

```typescript
const prompt = cria
  .prompt(provider)
  .system("Answer using the provided context.")
  .vectorSearch({ store, query: "password reset", limit: 5 })
  .user(userQuestion);
```

## Production Stores

The example uses a simple in-memory store. For production, use:

```typescript
// ChromaDB
import { ChromaStore } from "@fastpaca/cria/memory/chroma";

const store = new ChromaStore<string>({
  collection,
  embed: async (text) => {
    const response = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: text,
    });
    return response.data[0].embedding;
  },
});

// Or Qdrant
import { QdrantStore } from "@fastpaca/cria/memory/qdrant";
```

Or implement the `VectorMemory` interface for other vector DBs.
