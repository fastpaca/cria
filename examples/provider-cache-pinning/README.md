# Provider Cache Pinning Example

This example **verifies that provider cache pinning is actually wired through**.

It calls the real OpenAI API and runs an A/B test by comparing pinned vs.
unpinned request metadata. The assertions are deterministic (metadata wiring),
and the script logs `cached_tokens` for visibility.

The script checks that:

- OpenAI requests include a stable `prompt_cache_key` when the pinned prefix is unchanged
- That key changes when the pinned prefix changes
- Anthropic system blocks receive `cache_control` when the pin is in the prefix
- Pins must be the prompt prefix; invalid placements throw early

## Run It

```bash
cd examples/provider-cache-pinning
npm install
OPENAI_API_KEY=... npm run start
```

If everything is working, the script will print a short verification summary and exit successfully.
Note: `cached_tokens` can be `0` depending on cache availability; the assertions focus on deterministic metadata wiring. If the API provides cost fields, they will be logged too. The example also uses `@pydantic/genai-prices` to estimate costs from token usage, including cumulative savings across the 5 runs. The system prompt is inflated to target a larger prefix so cache hits are more visible, and the unpinned run uses a per-run nonce to discourage cache reuse.
