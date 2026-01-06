# RAG Example

Vector search with Cria and ChromaDB.

## Setup

```bash
# Start ChromaDB
docker run -p 8000:8000 chromadb/chroma

# Install and run
pnpm install
export OPENAI_API_KEY="sk-..."
pnpm start
```

## Usage

`VectorSearch` retrieves context at render time:

```tsx
<Message messageRole="system">
  Relevant context:
  <VectorSearch store={knowledgeBase} limit={3}>
    {userQuestion}
  </VectorSearch>
</Message>
```

Query options:

```tsx
// Explicit query
<VectorSearch store={store} query="password reset" limit={5} />

// Query from children
<VectorSearch store={store} limit={5}>
  {userQuestion}
</VectorSearch>

// Query from last user message
<VectorSearch store={store} messages={conversationHistory} />
```

## ChromaStore

```typescript
import { ChromaClient } from "chromadb";
import { ChromaStore } from "@fastpaca/cria/memory/chroma";

const chroma = new ChromaClient({ path: "http://localhost:8000" });
const collection = await chroma.getOrCreateCollection({ name: "docs" });

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

await store.set("doc-1", "Document content");
const results = await store.search("query", { limit: 5 });
```

## Other Stores

```typescript
import { QdrantStore } from "@fastpaca/cria/memory/qdrant";
```

Or implement the `VectorMemory` interface.
