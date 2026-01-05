# RAG (Retrieval Augmented Generation) Example

This example shows how **ridiculously easy** it is to add semantic search to your AI prompts with Cria + ChromaDB.

## The Magic

```tsx
// That's it. VectorSearch automatically retrieves relevant context at render time.
<Message messageRole="system">
  Here's the relevant context:
  <VectorSearch store={knowledgeBase} limit={3}>
    {userQuestion}
  </VectorSearch>
</Message>
```

No manual embedding. No async orchestration. No context window juggling. Just declare what you want and Cria handles the rest.

## What This Example Does

1. **Connects to ChromaDB** and creates a collection
2. **Creates a ChromaStore** with OpenAI embeddings
3. **Loads documents** into the knowledge base
4. **Uses VectorSearch** in a prompt to automatically retrieve relevant context
5. **Renders** the prompt with retrieved context baked in
6. **Calls OpenAI** with the enriched prompt

## Prerequisites

- **Docker** - for running ChromaDB
- **OpenAI API Key** - for embeddings and chat completions

## Running the Example

```bash
# 1. Start ChromaDB (in a separate terminal)
docker run -p 8000:8000 chromadb/chroma

# 2. Install dependencies
pnpm install

# 3. Set your OpenAI API key
export OPENAI_API_KEY="sk-..."

# 4. Run it
pnpm start
```

## Key Concepts

### VectorSearch Component

The `VectorSearch` component does semantic search at render time:

```tsx
// Query from prop
<VectorSearch store={store} query="how do I reset my password?" limit={5} />

// Query from children (great for dynamic queries)
<VectorSearch store={store} limit={5}>
  {userQuestion}
</VectorSearch>

// Query from messages (uses last user message)
<VectorSearch store={store} messages={conversationHistory} />
```

### ChromaStore

A production-ready vector store backed by ChromaDB:

```typescript
import { ChromaClient } from "chromadb";
import { ChromaStore } from "@fastpaca/cria/memory/chroma";

const chroma = new ChromaClient({ path: "http://localhost:8000" });
const collection = await chroma.getOrCreateCollection({ name: "my-docs" });

const store = new ChromaStore<string>({
  collection,
  embed: async (text) => {
    // Use any embedding provider: OpenAI, Cohere, local models, etc.
    const response = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: text,
    });
    return response.data[0].embedding;
  },
});

// Add documents
await store.set("doc-1", "Your document content here");

// Search returns results sorted by similarity
const results = await store.search("query", { limit: 5 });
```

### Other Vector Stores

Cria also supports Qdrant:

```typescript
import { QdrantStore } from "@fastpaca/cria/memory/qdrant";
```

Or implement your own by satisfying the `VectorMemory` interface.

## Why This Matters

Traditional RAG implementations require:
- Manual embedding calls
- Async orchestration
- Context window math
- Token budget management

With Cria, you just declare `<VectorSearch>` in your prompt and it **just works**. The component:
- Executes the search at render time
- Formats results into the prompt
- Integrates with Cria's token budget management
- Uses priority-based reduction when context is too large

**Focus on your product, not infrastructure.**
