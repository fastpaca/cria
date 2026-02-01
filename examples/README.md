# Examples

Start with the numbered examples in order:

1. **01-hello-world** - Minimal example (~20 lines)
2. **02-priorities** - See how `omit` drops content when budget is tight
3. **03-conversation** - Truncate history from the start

Then explore integrations:

- **rag-qdrant** - Vector search with real Qdrant (requires Docker)
- **summary-redis** - Progressive summarization with real Redis (requires Docker)
- **provider-cache-pinning** - OpenAI A/B test with pinned metadata

## Running

Each example is self-contained:

```bash
cd examples/01-hello-world
pnpm install
pnpm start
```

Set `OPENAI_API_KEY` in your environment.
