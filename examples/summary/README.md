# Summary Component Example

Demonstrates using the `<Summary>` and `<Last>` components for progressive conversation summarization.

## What it shows

- `<Summary>` - Summarizes older messages when the prompt exceeds budget
- `<Last N={4}>` - Keeps the last 4 messages in full
- `memoryStore()` - In-memory storage for summaries
- Custom summarizer using OpenAI

## Running

```bash
pnpm install
OPENAI_API_KEY=your-key pnpm start
```
