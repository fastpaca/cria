# Provider Cache Pinning Example

This example shows **how to pin a stable prefix** for OpenAI chat completions
using Cria’s prompt builder. It calls the real OpenAI API, pins a large system
prefix once, then reuses it across requests.

The script is intentionally small and opinionated. It shows how to pass the
rendered `cache_id` through to OpenAI as `prompt_cache_key`.

## Run It

```bash
cd examples/provider-cache-pinning
pnpm install
OPENAI_API_KEY=... pnpm start
```
