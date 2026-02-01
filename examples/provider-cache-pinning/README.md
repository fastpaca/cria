# Provider Cache Pinning Example

This example shows **how to pin a stable prefix** for OpenAI chat completions
using Cria’s prompt builder. It calls the real OpenAI API, pins a large system
prefix once, then reuses it across requests.

The script is intentionally small and opinionated. OpenAI only caches when you
pass `prompt_cache_key`, so it shows how to forward the rendered `cache_id`
explicitly.

## Run It

```bash
cd examples/provider-cache-pinning
pnpm install
OPENAI_API_KEY=... pnpm start
```
