# Recipes

Short patterns you can adapt to your app.

## Chat

```tsx
<Region>
  <Message messageRole="system">System rules</Message>
  <Region>{history}</Region>
  <Message messageRole="user">Current request</Message>
</Region>
```

## Tool use

```tsx
<Region>
  <Message messageRole="system">Tool policy</Message>
  <Message messageRole="user">Task</Message>
  <Message messageRole="assistant">
    <ToolCall toolCallId="1" toolName="search" input={{ q: "weather" }} />
  </Message>
  <Message messageRole="tool">
    <ToolResult toolCallId="1" toolName="search" output={{ temp: 72 }} />
  </Message>
</Region>
```

## RAG

```tsx
<Region>
  <Message messageRole="system">Answer based on the retrieved context.</Message>
  <VectorSearch store={vectorStore} limit={5}>
    {query}
  </VectorSearch>
  <Message messageRole="user">{question}</Message>
</Region>
```

## Reasoning replay for OpenAI Responses

```tsx
<Reasoning text={previousReasoning} />
```

## Budget fitting

### History with token limit

```tsx
<Region priority={0}>
  <Message messageRole="system">System rules</Message>
  <Truncate budget={6000} priority={2}>{history}</Truncate>
  <Omit priority={3}>{examples}</Omit>
  <Message messageRole="user">{question}</Message>
</Region>
```

### Progressive summarization

```tsx
import { InMemoryStore, Summary, type StoredSummary } from "@fastpaca/cria";

const store = new InMemoryStore<StoredSummary>();

<Summary id="history" store={store} priority={2}>
  {conversationHistory}
</Summary>
```

## Related

- [Summarization example](../examples/summary)
- [RAG example](../examples/rag)
