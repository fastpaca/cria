# RAG (Retrieval Augmented Generation) Example

This example shows how **ridiculously easy** it is to add semantic search to your AI prompts with Cria.

## The Magic

```tsx
// That's it. VectorSearch automatically retrieves relevant context at render time.
<Message messageRole="system">
  Here's the relevant context:
  <VectorSearch store={knowledgeBase} limit={3} query={userQuestion} />
</Message>
```

No manual embedding. No async orchestration. No context window juggling. Just declare what you want and Cria handles the rest.

## What This Example Does

1. **Creates a vector store** with OpenAI embeddings
2. **Loads documents** into the knowledge base (imagine these are from your DB, PDFs, etc.)
3. **Uses VectorSearch** in a prompt to automatically retrieve relevant context
4. **Renders** the prompt with retrieved context baked in
5. **Calls OpenAI** with the enriched prompt

## Running the Example

```bash
# Install dependencies
pnpm install

# Set your OpenAI API key
export OPENAI_API_KEY="sk-..."

# Run it
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

### InMemoryVectorStore

A simple in-memory vector store for development and testing:

```typescript
const store = new InMemoryVectorStore<string>({
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

### Production Vector Stores

For production, use a real vector database:

```typescript
// Chroma
import { ChromaVectorStore } from "@fastpaca/cria/memory/chroma";

// Qdrant
import { QdrantVectorStore } from "@fastpaca/cria/memory/qdrant";
```

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

