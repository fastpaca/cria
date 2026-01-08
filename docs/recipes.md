# Recipes

Short patterns you can adapt to your app.

## Budgeted history + optional examples

```tsx
<Region priority={0}>
  <Message messageRole="system">System rules</Message>
  <Truncate budget={6000} priority={2}>{history}</Truncate>
  <Omit priority={3}>{examples}</Omit>
  <Message messageRole="user">{question}</Message>
</Region>
```

## Progressive summarization

```tsx
import { InMemoryStore, Summary, type StoredSummary } from "@fastpaca/cria";

const store = new InMemoryStore<StoredSummary>();

<Summary id="history" store={store} priority={2}>
  {conversationHistory}
</Summary>
```

## RAG at render time

```tsx
<VectorSearch store={vectorStore} limit={5}>
  {query}
</VectorSearch>
```

## Tool calls and results

```tsx
<Message messageRole="assistant">
  <ToolCall toolCallId="weather" toolName="getWeather" input={{ city: "Paris" }} />
</Message>
<Message messageRole="tool">
  <ToolResult toolCallId="weather" toolName="getWeather" output={{ temp: 72 }} />
</Message>
```

## Reasoning replay for OpenAI Responses

```tsx
<Reasoning text={previousReasoning} />
```

## Related

- [Summarization example](../examples/summary)
- [RAG example](../examples/rag)
