# Summary Example

Demonstrates progressive conversation summarization with the fluent DSL.

## What it shows

- `.summary()` - Summarizes older content when the prompt exceeds budget
- `InMemoryStore` - In-memory storage for cached summaries
- Priority-based compaction for long conversations

## Running

```bash
pnpm install
OPENAI_API_KEY=your-key pnpm start
```
